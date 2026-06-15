'use strict';

const virtualVariableRepository = require('../repositories/virtualVariableRepository');
const variableService            = require('./variableService');

// Late-require to avoid circular dependency with mqttService
function getMqttService() { return require('./mqttService'); }

// Track last published state value per variable id (change-detection)
const _lastPublishedState = new Map();

// ── HA entity type selection ──────────────────────────────────────────

function entityType(variable) {
  if (variable.dataType === 'bool') return 'binary_sensor';
  if (variable.writable) return 'number';
  return 'sensor';
}

// ── Infer HA device_class from unit string ────────────────────────────

function inferDeviceClass(unit) {
  const u = (unit || '').trim().toLowerCase();
  if (u === 'w' || u === 'kw' || u === 'mw') return 'power';
  if (u === 'wh' || u === 'kwh' || u === 'mwh') return 'energy';
  if (u === 'a') return 'current';
  if (u === 'v') return 'voltage';
  if (u === 'hz') return 'frequency';
  if (u === '°c' || u === 'c') return 'temperature';
  if (u === '°f' || u === 'f') return 'temperature';
  if (u === '%') return 'humidity';
  if (u === 'bar' || u === 'psi' || u === 'hpa' || u === 'mbar') return 'pressure';
  return null;
}

// ── Data-type-aware min/max ranges for HA number entities ─────────────

function dataTypeRange(dataType) {
  switch (dataType) {
    case 'uint16':  return { min: 0,           max: 65535 };
    case 'int16':   return { min: -32768,      max: 32767 };
    case 'uint32':  return { min: 0,           max: 4294967295 };
    case 'int32':   return { min: -2147483648, max: 2147483647 };
    case 'float32': return { min: -3.4e+38,    max: 3.4e+38 };
    default:        return { min: -2147483648, max: 2147483647 };
  }
}

// ── Topic helpers ─────────────────────────────────────────────────────

function stateTopic(baseTopic, variableId) {
  return `${baseTopic}/ha/${variableId}/state`;
}

function cmdTopic(baseTopic, variableId) {
  return `${baseTopic}/ha/${variableId}/set`;
}

function discConfigTopic(prefix, type, objectId) {
  return `${prefix}/${type}/${objectId}/config`;
}

// ── Build HA discovery payload for a variable ─────────────────────────

function buildDiscoveryPayload(config, variable) {
  const deviceId   = config.discoveryDeviceId   || 'modbus-bridge';
  const deviceName = config.discoveryDeviceName || 'Modbus Bridge';
  const prefix     = config.discoveryPrefix     || 'homeassistant';
  const baseTopic  = config.baseTopic           || 'modbus-bridge';
  const type       = entityType(variable);
  const objectId   = `${deviceId}_${variable.id}`;

  const device = {
    identifiers:  [deviceId],
    name:         deviceName,
    manufacturer: 'modbus-bridge',
    model:        'Modbus TCP Bridge',
  };

  const payload = {
    name:        variable.label || variable.name,
    unique_id:   objectId,
    object_id:   objectId,
    state_topic: stateTopic(baseTopic, variable.id),
    device,
  };

  if (variable.unit) payload.unit_of_measurement = variable.unit;

  const dc = inferDeviceClass(variable.unit);
  if (dc) payload.device_class = dc;

  if (type === 'sensor') {
    payload.state_class = 'measurement';
  }

  if (type === 'number') {
    payload.command_topic = cmdTopic(baseTopic, variable.id);
    const range = dataTypeRange(variable.dataType);
    payload.min  = range.min;
    payload.max  = range.max;
    payload.step = variable.dataType === 'float32' ? 0.01 : 1;
    payload.mode = 'box';
  }

  if (type === 'binary_sensor') {
    payload.payload_on  = '1';
    payload.payload_off = '0';
  }

  return { type, objectId, payload, discTopic: discConfigTopic(prefix, type, objectId) };
}

// ── Publish all discovery configs ─────────────────────────────────────

function publishDiscovery() {
  const svc    = getMqttService();
  const config = svc.getConfig();
  if (!config.discoveryEnabled) return 0;

  const vars = virtualVariableRepository.list().filter((v) => v.enabled && v.haEnabled);
  let count = 0;
  for (const variable of vars) {
    try {
      const { payload, discTopic } = buildDiscoveryPayload(config, variable);
      svc.publish(discTopic, JSON.stringify(payload), { retain: true, qos: 1 });
      count++;
    } catch (err) {
      console.warn(`[Discovery] failed to build/publish config for ${variable.id}: ${err.message}`);
    }
  }
  if (count > 0) console.log(`[Discovery] published ${count} entity config(s)`);
  return count;
}

// ── Publish discovery config for a single variable ────────────────────

function publishSingleDiscovery(variable) {
  const svc    = getMqttService();
  const config = svc.getConfig();
  if (!config.discoveryEnabled) return false;
  if (!variable || !variable.enabled || !variable.haEnabled) return false;

  try {
    const { payload, discTopic } = buildDiscoveryPayload(config, variable);
    svc.publish(discTopic, JSON.stringify(payload), { retain: true, qos: 1 });

    // Also subscribe to command topic if writable
    if (variable.writable) {
      const baseTopic = config.baseTopic || 'modbus-bridge';
      svc.subscribeRaw(cmdTopic(baseTopic, variable.id));
    }

    // Publish initial state if available
    const vs = variableService.getVariableState(variable.id);
    if (vs && vs.currentValue != null) {
      const baseTopic = config.baseTopic || 'modbus-bridge';
      const type  = entityType(variable);
      const statePayload = type === 'binary_sensor'
        ? (vs.currentValue ? '1' : '0')
        : String(vs.currentValue);
      svc.publish(stateTopic(baseTopic, variable.id), statePayload, { retain: true });
    }

    console.log(`[Discovery] published single entity config for "${variable.name}" (${variable.id})`);
    return true;
  } catch (err) {
    console.warn(`[Discovery] failed to publish single config for ${variable.id}: ${err.message}`);
    return false;
  }
}

// ── Remove discovery entry for a single variable ──────────────────────

function removeSingleDiscovery(variable) {
  const svc    = getMqttService();
  const config = svc.getConfig();

  try {
    const { discTopic } = buildDiscoveryPayload(config, variable);
    // Send empty retained payload to remove entity from HA
    svc.publish(discTopic, '', { retain: true, qos: 1 });

    // Clean up state topic
    const baseTopic = config.baseTopic || 'modbus-bridge';
    svc.publish(stateTopic(baseTopic, variable.id), '', { retain: true });

    // Clear change-detection cache
    _lastPublishedState.delete(variable.id);

    console.log(`[Discovery] removed entity for "${variable.name}" (${variable.id})`);
    return true;
  } catch (err) {
    console.warn(`[Discovery] failed to remove config for ${variable.id}: ${err.message}`);
    return false;
  }
}

// ── Handle variable changes — called from route handlers ──────────────

function onVariableChanged(variableId, oldVariable, newVariable) {
  const svc    = getMqttService();
  const config = svc.getConfig();
  if (!config.discoveryEnabled) return;

  const wasEnabled = oldVariable && oldVariable.haEnabled && oldVariable.enabled;
  const isEnabled  = newVariable && newVariable.haEnabled && newVariable.enabled;

  if (!wasEnabled && isEnabled) {
    // haEnabled turned ON → publish discovery + subscribe command topic
    publishSingleDiscovery(newVariable);
  } else if (wasEnabled && !isEnabled) {
    // haEnabled turned OFF → remove from HA
    removeSingleDiscovery(oldVariable);
  } else if (wasEnabled && isEnabled) {
    // Still enabled but properties may have changed (name, unit, dataType, writable)
    // Re-publish discovery config to update HA entity
    const propsChanged = oldVariable.name !== newVariable.name
      || oldVariable.label !== newVariable.label
      || oldVariable.unit !== newVariable.unit
      || oldVariable.dataType !== newVariable.dataType
      || oldVariable.writable !== newVariable.writable;

    if (propsChanged) {
      // If entity type changed (e.g. writable toggled), remove old and publish new
      const oldType = entityType(oldVariable);
      const newType = entityType(newVariable);
      if (oldType !== newType) {
        removeSingleDiscovery(oldVariable);
      }
      publishSingleDiscovery(newVariable);
    }
  }
}

// ── Publish current state values for all discovered variables ─────────

function publishStates() {
  const svc    = getMqttService();
  const config = svc.getConfig();
  if (!config.discoveryEnabled) return;

  const baseTopic = config.baseTopic || 'modbus-bridge';
  const vars = virtualVariableRepository.list().filter((v) => v.enabled && v.haEnabled);

  for (const variable of vars) {
    try {
      const vs = variableService.getVariableState(variable.id);
      if (!vs || vs.currentValue == null) continue;

      const type  = entityType(variable);
      const payload = type === 'binary_sensor'
        ? (vs.currentValue ? '1' : '0')
        : String(vs.currentValue);

      // Change-detection: only publish if value actually changed
      const lastValue = _lastPublishedState.get(variable.id);
      if (lastValue === payload) continue;

      const topic = stateTopic(baseTopic, variable.id);
      svc.publish(topic, payload, { retain: true });
      _lastPublishedState.set(variable.id, payload);
    } catch (err) {
      console.warn(`[Discovery] state publish error for ${variable.id}: ${err.message}`);
    }
  }
}

// ── Subscribe to command topics for writable variables ────────────────

function subscribeCommandTopics(rawSubscribeFn) {
  const svc    = getMqttService();
  const config = svc.getConfig();
  if (!config.discoveryEnabled) return;

  const baseTopic = config.baseTopic || 'modbus-bridge';
  const vars = virtualVariableRepository.list()
    .filter((v) => v.enabled && v.haEnabled && v.writable);

  for (const variable of vars) {
    rawSubscribeFn(cmdTopic(baseTopic, variable.id));
  }
}

// ── Handle an incoming MQTT message — return true if it was a command ─

function handleCommand(topic, buffer) {
  const svc    = getMqttService();
  const config = svc.getConfig();
  if (!config.discoveryEnabled) return false;

  const baseTopic = config.baseTopic || 'modbus-bridge';
  const cmdPrefix = `${baseTopic}/ha/`;
  const cmdSuffix = '/set';
  if (!topic.startsWith(cmdPrefix) || !topic.endsWith(cmdSuffix)) return false;

  const varId   = topic.slice(cmdPrefix.length, -cmdSuffix.length);
  const variable = virtualVariableRepository.getById(varId);
  if (!variable || !variable.enabled || !variable.writable || !variable.haEnabled) return false;

  const raw = buffer.toString('utf8').trim();
  try {
    let value;
    if (variable.dataType === 'bool') {
      value = raw === '1' || raw.toLowerCase() === 'true' || raw.toLowerCase() === 'on';
    } else {
      value = Number(raw);
      if (!Number.isFinite(value)) throw new Error(`non-numeric payload: "${raw}"`);
    }
    variableService.setValue(varId, value, 'ha_command');
  } catch (err) {
    console.warn(`[Discovery] command error for ${varId}: ${err.message}`);
  }
  return true; // topic was handled regardless
}

// ── Remove discovery entries from HA (send empty retained payloads) ───

function clearDiscovery() {
  const svc    = getMqttService();
  const config = svc.getConfig();
  const vars = virtualVariableRepository.list().filter((v) => v.haEnabled);
  for (const variable of vars) {
    try {
      const { discTopic } = buildDiscoveryPayload(config, variable);
      svc.publish(discTopic, '', { retain: true, qos: 1 });

      // Also clear state topic
      const baseTopic = config.baseTopic || 'modbus-bridge';
      svc.publish(stateTopic(baseTopic, variable.id), '', { retain: true });
    } catch { /* ignore */ }
  }
  // Clear change-detection cache
  _lastPublishedState.clear();
}

module.exports = {
  publishDiscovery,
  publishSingleDiscovery,
  removeSingleDiscovery,
  onVariableChanged,
  publishStates,
  subscribeCommandTopics,
  handleCommand,
  clearDiscovery,
};
