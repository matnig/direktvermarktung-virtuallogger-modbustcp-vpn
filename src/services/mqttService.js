const mqtt = require('mqtt');
const { readCollection, writeCollection } = require('../persistence/jsonStore');
const mqttSubscriptionRepository = require('../repositories/mqttSubscriptionRepository');
const mqttPublishRuleRepository  = require('../repositories/mqttPublishRuleRepository');
const variableService             = require('./variableService');
const { applyTransforms }         = require('../modbus/encodeRegisterValue');

const COLLECTION     = 'mqtt_config';
const DEFAULT_CONFIG = Object.freeze({
  enabled: false, host: 'localhost', port: 1883, clientId: 'modbus-bridge',
  username: '', password: '', baseTopic: 'modbus-bridge',
  keepalive: 60, tls: false, reconnectMs: 5000,
});

let _client       = null;
let _configCache  = null;
// status: 'disabled' | 'connecting' | 'connected' | 'disconnected' | 'error'
let _state = { status: 'disabled', lastError: null, connectedAt: null, lastConnectedAt: null };

// Track last published value per rule id to avoid redundant publishes
const _lastPublished = new Map();

// ── Config ────────────────────────────────────────────────────────────

function getConfig() {
  if (_configCache) return { ..._configCache };
  const stored = readCollection(COLLECTION, { ...DEFAULT_CONFIG });
  _configCache = (stored && !Array.isArray(stored) && typeof stored === 'object')
    ? stored : { ...DEFAULT_CONFIG };
  return { ..._configCache };
}

function updateConfig(payload) {
  const current = getConfig();
  const next = { ...current };
  const fields = ['enabled', 'host', 'port', 'clientId', 'username', 'password',
                  'baseTopic', 'keepalive', 'tls', 'reconnectMs'];
  for (const f of fields) {
    if (payload[f] !== undefined) next[f] = payload[f];
  }
  next.baseTopic = String(next.baseTopic).replace(/\/$/, '');
  next.updatedAt = new Date().toISOString();
  writeCollection(COLLECTION, next);
  _configCache = next;
  return { ...next, password: next.password ? '***' : '' };
}

// ── Topic matching ────────────────────────────────────────────────────

function topicMatches(pattern, topic) {
  const pp = pattern.split('/');
  const tp = topic.split('/');
  function match(pi, ti) {
    if (pi === pp.length && ti === tp.length) return true;
    if (pi < pp.length && pp[pi] === '#') return true;
    if (pi >= pp.length || ti >= tp.length) return false;
    if (pp[pi] !== '+' && pp[pi] !== tp[ti]) return false;
    return match(pi + 1, ti + 1);
  }
  return match(0, 0);
}

// ── JSON path extraction ──────────────────────────────────────────────

// Segments that could traverse the prototype chain are blocked.
const _BLOCKED_PROPS = new Set(['__proto__', 'constructor', 'prototype']);

function extractFromPath(data, path) {
  if (!path) return data;
  const parts = path.split('.');
  let cur = data;
  for (const part of parts) {
    if (cur == null) return null;
    const arrMatch = part.match(/^(\w+)\[(\d+)\]$/);
    if (arrMatch) {
      if (_BLOCKED_PROPS.has(arrMatch[1])) return null;
      cur = cur[arrMatch[1]]?.[Number(arrMatch[2])];
    } else {
      if (_BLOCKED_PROPS.has(part)) return null;
      cur = cur[part];
    }
  }
  return cur;
}

// ── Message handling ──────────────────────────────────────────────────

function handleMessage(topic, buffer) {
  const raw = buffer.toString('utf8');
  const subs = mqttSubscriptionRepository.list().filter((s) => s.enabled);

  for (const sub of subs) {
    if (!topicMatches(sub.topic, topic)) continue;
    try {
      let parsed;
      try { parsed = JSON.parse(raw); } catch { parsed = raw; }

      let value = sub.jsonPath ? extractFromPath(parsed, sub.jsonPath) : parsed;

      // Coerce to numeric or boolean
      if (sub.dataType === 'bool') {
        value = value === true || value === 1 || value === 'true' || value === '1';
      } else if (sub.dataType === 'string') {
        value = String(value ?? '');
      } else {
        value = Number(value);
        if (!isFinite(value)) throw new Error(`Non-numeric payload: ${raw.slice(0, 100)}`);
      }

      value = applyTransforms(value, sub.transforms);

      const ok = variableService.setValue(sub.variableId, value, 'mqtt');
      if (!ok) throw new Error(`Variable ${sub.variableId} not found or disabled`);
    } catch (err) {
      variableService.setError(sub.variableId, err.message);
    }
  }
}

// ── Publish ───────────────────────────────────────────────────────────

function publish(topic, value, options = {}) {
  if (!_client || _state.status !== 'connected') return false;
  try {
    const payload = typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
    _client.publish(topic, payload, { qos: 0, retain: false, ...options });
    return true;
  } catch { return false; }
}

function runPublishCycle(registerStates = {}, watchdogStates = {}) {
  if (_state.status !== 'connected') return;
  const config = getConfig();
  const rules  = mqttPublishRuleRepository.list().filter((r) => r.enabled);

  for (const rule of rules) {
    try {
      let value;
      switch (rule.sourceType) {
        case 'register': {
          const reg = registerStates[rule.sourceId];
          if (!reg) continue;
          value = reg.scaledValue ?? reg.rawValue;
          break;
        }
        case 'variable': {
          const vs = variableService.getVariableState(rule.sourceId);
          if (!vs) continue;
          value = vs.currentValue;
          break;
        }
        case 'external_register': {
          // External register address is stored in sourceId as address string; look up by id
          const externalServerService = require('./externalServerService');
          const externalRegisterRepository = require('../repositories/externalRegisterRepository');
          const extReg = externalRegisterRepository.getById(rule.sourceId);
          if (!extReg) continue;
          const { decodeWords } = require('../modbus/encodeRegisterValue');
          const words = externalServerService.readWords(extReg.address, extReg.length);
          value = decodeWords(words, extReg.dataType);
          break;
        }
        case 'watchdog': {
          const ws = watchdogStates[rule.sourceId];
          if (!ws) continue;
          value = ws.state;
          break;
        }
        default: continue;
      }

      value = applyTransforms(value, rule.transforms);

      const last = _lastPublished.get(rule.id);
      if (rule.publishOnChange && last === value) continue;

      const topic = rule.topic.startsWith('/')
        ? rule.topic.slice(1)
        : `${config.baseTopic}/${rule.topic}`;

      publish(topic, value, { qos: rule.qos, retain: rule.retain });
      _lastPublished.set(rule.id, value);
    } catch (err) {
      console.warn(`[MQTT] publish rule "${rule.id}" error: ${err.message}`);
    }
  }
}

// ── Subscribe all configured topics ──────────────────────────────────

function subscribeAll() {
  if (!_client || _state.status !== 'connected') return;
  const topics = [...new Set(
    mqttSubscriptionRepository.list()
      .filter((s) => s.enabled && s.topic)
      .map((s) => s.topic)
  )];
  for (const t of topics) {
    _client.subscribe(t, { qos: 0 }, (err) => {
      if (err) console.error(`[MQTT] subscribe error for ${t}:`, err.message);
    });
  }
}

// Called when a subscription is added/changed so we subscribe live
function resubscribe(topic) {
  if (!_client || _state.status !== 'connected' || !topic) return;
  _client.subscribe(topic, { qos: 0 });
}

function unsubscribeTopic(topic) {
  if (!_client || !topic) return;
  const remaining = mqttSubscriptionRepository.list()
    .filter((s) => s.enabled && s.topic === topic && s.id !== '__deleted__');
  if (remaining.length === 0 && _client) {
    try { _client.unsubscribe(topic); } catch { /* ignore */ }
  }
}

// ── Lifecycle ─────────────────────────────────────────────────────────

function connect() {
  const config = getConfig();
  if (!config.enabled) { _state.status = 'disabled'; return; }
  if (_client) return;

  const protocol = config.tls ? 'mqtts' : 'mqtt';
  const url = `${protocol}://${config.host}:${config.port}`;

  _state.status = 'connecting';

  const opts = {
    clientId:        config.clientId + '_' + Math.random().toString(16).slice(2, 6),
    keepalive:       config.keepalive,
    reconnectPeriod: config.reconnectMs,
    connectTimeout:  10000,
    clean:           true,
  };
  if (config.username) opts.username = config.username;
  if (config.password) opts.password = config.password;

  _client = mqtt.connect(url, opts);

  _client.on('connect', () => {
    _state.status        = 'connected';
    _state.connectedAt   = new Date().toISOString();
    _state.lastConnectedAt = _state.connectedAt;
    _state.lastError     = null;
    console.log(`[MQTT] connected to ${url}`);
    subscribeAll();
  });

  _client.on('message', handleMessage);

  _client.on('error', (err) => {
    _state.status    = 'error';
    _state.lastError = err.message;
    console.error('[MQTT] error:', err.message);
  });

  _client.on('close', () => {
    if (_state.status !== 'error') _state.status = 'disconnected';
    _state.connectedAt = null;
  });

  _client.on('reconnect', () => {
    _state.status = 'connecting';
  });
}

function disconnect() {
  if (!_client) { _state.status = 'disconnected'; return; }
  _client.end(true, () => {
    _client = null;
    _state  = { ..._state, status: 'disconnected', connectedAt: null };
  });
}

function reconnect() {
  disconnect();
  setTimeout(connect, 500);
}

// ── Public state ──────────────────────────────────────────────────────

function getStatus() {
  const config = getConfig();
  return {
    status:          _state.status,
    lastError:       _state.lastError,
    connectedAt:     _state.connectedAt,
    lastConnectedAt: _state.lastConnectedAt,
    host:            config.host,
    port:            config.port,
    baseTopic:       config.baseTopic,
    enabled:         config.enabled,
  };
}

module.exports = {
  COLLECTION,
  DEFAULT_CONFIG,
  getConfig,
  updateConfig,
  connect,
  disconnect,
  reconnect,
  publish,
  runPublishCycle,
  resubscribe,
  unsubscribeTopic,
  getStatus,
};
