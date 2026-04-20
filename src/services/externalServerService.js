const ModbusServer = require('../modbus/modbusServer');
const { readCollection, writeCollection } = require('../persistence/jsonStore');

const COLLECTION = 'external_server_settings';
const DEFAULT_SETTINGS = Object.freeze({ host: '0.0.0.0', port: 5020, enabled: false });

const modbusServer = new ModbusServer();

let _state = { running: false, startedAt: null, lastError: null };
let _settingsCache = null;

// ── Settings ─────────────────────────────────────────────────────────

function getSettings() {
  if (_settingsCache) return { ..._settingsCache };
  const stored = readCollection(COLLECTION, { ...DEFAULT_SETTINGS });
  _settingsCache = (stored && !Array.isArray(stored) && typeof stored === 'object')
    ? stored
    : { ...DEFAULT_SETTINGS };
  return { ..._settingsCache };
}

function updateSettings(payload) {
  const current = getSettings();
  const next = { ...current };

  if (payload.host !== undefined)    next.host    = String(payload.host);
  if (payload.port !== undefined)    next.port    = Number(payload.port);
  if (payload.enabled !== undefined) next.enabled = !!payload.enabled;

  writeCollection(COLLECTION, next);
  _settingsCache = next;
  return { ...next };
}

// ── Server lifecycle ──────────────────────────────────────────────────

async function startServer() {
  if (modbusServer.listening) return getStatus();

  const settings = getSettings();
  try {
    await modbusServer.listen(settings.host, settings.port);
    _state = { running: true, startedAt: new Date().toISOString(), lastError: null };
    console.log(`[ExternalServer] Modbus TCP server listening on ${settings.host}:${settings.port}`);
  } catch (err) {
    _state = { running: false, startedAt: null, lastError: err.message };
    throw err;
  }
  return getStatus();
}

async function stopServer() {
  await modbusServer.close();
  _state = { running: false, startedAt: _state.startedAt, lastError: null };
  console.log('[ExternalServer] stopped');
  return getStatus();
}

// ── Register space access ─────────────────────────────────────────────

function readWords(address, count) {
  return modbusServer.readWords(address, count);
}

function writeWords(address, words) {
  modbusServer.writeWords(address, words);
}

function onWrite(fn) {
  return modbusServer.onWrite(fn);
}

// ── Status ────────────────────────────────────────────────────────────

function getStatus() {
  const settings = getSettings();
  return {
    running:     modbusServer.listening,
    host:        settings.host,
    port:        settings.port,
    enabled:     settings.enabled,
    clientCount: modbusServer.clientCount,
    startedAt:   _state.startedAt,
    lastError:   _state.lastError,
  };
}

// Auto-start if enabled at boot
async function initServer() {
  const settings = getSettings();
  if (settings.enabled) {
    await startServer().catch((err) =>
      console.error('[ExternalServer] auto-start failed:', err.message)
    );
  }
}

module.exports = {
  COLLECTION,
  DEFAULT_SETTINGS,
  getSettings,
  updateSettings,
  startServer,
  stopServer,
  readWords,
  writeWords,
  onWrite,
  getStatus,
  initServer,
};
