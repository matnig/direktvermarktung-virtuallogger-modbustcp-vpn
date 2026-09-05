// calibrationSamplerService — protokolliert periodisch Werte für die Dargebot-Kalibrierung.
//
// Zweck: über den Tag (bes. Mittagsspitze, ungedrosselt) Strahlung + echte PV-Produktion sammeln,
// um pInstalliertKw so zu kalibrieren, dass Dargebot ≈ P_ist. Läuft im Bridge-Prozess auf dem
// Datenlogger (überlebt Neustarts via persistiertem enabled-Flag → init() beim Start).
//
// Samples werden im jsonStore ('calibrationSamples') gehalten (Ringpuffer). Reine Datensammlung,
// KEIN Eingriff in die Regelung.

const { readCollection, writeCollection } = require('../persistence/jsonStore');
const controlService             = require('./controlService');
const variableService            = require('./variableService');
const einspeisemanagementService = require('./einspeisemanagementService');

const CONFIG_COLLECTION  = 'calibrationSampler';
const SAMPLES_COLLECTION = 'calibrationSamples';
const MAX_SAMPLES        = 3000;
const DEFAULT_INTERVAL   = 300000; // 5 min

let _handle = null;

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function readVar(id) {
  if (!id) return null;
  const vs = variableService.getVariableState(id);
  if (!vs || vs.currentValue == null) return null;
  return num(Number(vs.currentValue));
}

function getConfig() {
  const [stored] = readCollection(CONFIG_COLLECTION, [{ enabled: false, intervalMs: DEFAULT_INTERVAL }]);
  return stored || { enabled: false, intervalMs: DEFAULT_INTERVAL };
}

function saveConfig(cfg) {
  writeCollection(CONFIG_COLLECTION, [cfg]);
}

function getSamples() {
  return readCollection(SAMPLES_COLLECTION, []);
}

function clearSamples() {
  writeCollection(SAMPLES_COLLECTION, []);
}

function sampleOnce() {
  const st = controlService.getControlState() || {};
  const b  = (einspeisemanagementService.getConfig().bindings) || {};
  const strOst  = readVar(b.strahlungOstVariableId);
  const strWest = readVar(b.strahlungWestVariableId);
  const vals    = [strOst, strWest].filter((v) => v != null);
  const mittel  = vals.length ? vals.reduce((a, c) => a + c, 0) / vals.length : null;

  const sample = {
    t: new Date().toISOString(),
    strOst,
    strWest,
    mittel,
    pIstKw: num(st.pIstKw),
    dargebotKw: num(st.dargebotKw),
    drosselAktiv: !!st.drosselAktiv,
    wrSollwertKw: num(st.wrSollwertKw),
    napEinspeisungKw: num(st.napEinspeisungKw),
    socProzent: st.akku ? num(st.akku.socProzent) : null,
  };

  const arr = getSamples();
  arr.push(sample);
  while (arr.length > MAX_SAMPLES) arr.shift();
  writeCollection(SAMPLES_COLLECTION, arr);
  return sample;
}

function start(intervalMs) {
  const ms = Math.max(10000, Number(intervalMs) || getConfig().intervalMs || DEFAULT_INTERVAL);
  if (_handle) { clearInterval(_handle); _handle = null; }
  saveConfig({ enabled: true, intervalMs: ms });
  _handle = setInterval(() => {
    try { sampleOnce(); } catch (e) { console.error('[calibrationSampler]', e.message); }
  }, ms);
  try { sampleOnce(); } catch (e) { console.error('[calibrationSampler]', e.message); }
  return status();
}

function stop() {
  if (_handle) { clearInterval(_handle); _handle = null; }
  const c = getConfig();
  saveConfig({ ...c, enabled: false });
  return status();
}

function isRunning() {
  return _handle != null;
}

function status() {
  const c = getConfig();
  return { running: isRunning(), enabled: !!c.enabled, intervalMs: c.intervalMs, count: getSamples().length };
}

// Beim Bridge-Start aufrufen: wenn zuvor aktiviert, automatisch fortsetzen.
function init() {
  const c = getConfig();
  if (c.enabled) start(c.intervalMs);
}

module.exports = { start, stop, isRunning, status, getSamples, clearSamples, sampleOnce, init };
