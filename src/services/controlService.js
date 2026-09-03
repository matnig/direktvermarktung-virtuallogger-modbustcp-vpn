// controlService — Einspeisemanagement-Regler im Datenlogger.
//
// Verdrahtet die reinen Funktionen aus einspeisemanagementLogic.js mit den Live-Werten
// (Register-/Variablen-Zustände) und exponiert den berechneten Zustand über getControlState().
//
// SICHERHEIT (v1): Dieser Service SCHREIBT NICHTS. Es gibt hier bewusst keinen Modbus-Write-
// Pfad zum Wechselrichter. Der WR-Sollwert wird nur berechnet und angezeigt. Das Scharfschalten
// (Schreiben auf LOGO AQ3) wird erst ergänzt, wenn der LOGO-Link steht und die Failsafes
// abgenommen sind. `aktuierungAktiv` in der Config ist dafür die spätere Freigabe, aktuiert aber
// in dieser Version noch nichts.

const runtimeService             = require('./runtimeService');
const variableService            = require('./variableService');
const einspeisemanagementService = require('./einspeisemanagementService');
const logic                      = require('./einspeisemanagementLogic');

let _handle = null;
let _wrSollwertKw = null;   // Integrator-Zustand des einseitigen Begrenzers
let _state = { zeit: null, aktiv: false };

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function regStates() {
  const rt = runtimeService.getRuntimeState() || {};
  return rt.registerStates || {};
}

function readRegister(id) {
  if (!id) return null;
  const r = regStates()[id];
  if (!r || r.error || r.scaledValue == null) return null;
  return num(Number(r.scaledValue));
}

function readBool(id) {
  const v = readRegister(id);
  if (v == null) return null;
  return v !== 0;
}

function sumRegisters(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return null;
  const rs = regStates();
  let sum = 0;
  for (const id of ids) {
    const r = rs[id];
    if (!r || r.error || r.scaledValue == null) return null; // fehlt einer -> ganze Summe ungültig
    sum += Number(r.scaledValue);
  }
  return sum;
}

function readVariable(id) {
  if (!id) return null;
  const vs = variableService.getVariableState(id);
  if (!vs || vs.currentValue == null) return null;
  return num(Number(vs.currentValue));
}

function computeOnce() {
  const cfg = einspeisemanagementService.getConfig();
  const b = cfg.bindings || {};
  const fehlt = [];

  // --- Direktvermarkter-Sollwert (Variable in W -> kW) ---
  const dvW = readVariable(b.direktvermarkterVariableId);
  const direktvermarkterKw = dvW == null ? null : dvW / 1000;
  if (direktvermarkterKw == null) fehlt.push('direktvermarkter');

  // --- Netzbetreiber-Stufe aus 3 Kontakten (LOGO I1/I2/I3) ---
  const i1 = readBool(b.kontaktI1RegisterId);
  const i2 = readBool(b.kontaktI2RegisterId);
  const i3 = readBool(b.kontaktI3RegisterId);
  const kontakteVerfuegbar = i1 != null && i2 != null && i3 != null;
  const stufe = kontakteVerfuegbar ? logic.netzbetreiberStufe({ i1, i2, i3 }, cfg) : null;
  const netzbetreiberKw = stufe ? stufe.kw : null;
  if (netzbetreiberKw == null) fehlt.push('netzbetreiber');

  // --- NAP-Einspeisung (Intilion-Summe kW, neg=Einspeisung -> Einspeisung positiv) ---
  const napSummeKw = sumRegisters(b.napRegisterIds);
  const napEinspeisungKw = napSummeKw == null ? null : -napSummeKw;
  if (napEinspeisungKw == null) fehlt.push('nap');

  // --- Akku-Telemetrie (5040 neg=laden -> ladeleistung positiv) ---
  const ladeReg = readRegister(b.akkuLadeleistungRegisterId);
  const akku = {
    verfuegbar: ladeReg != null,
    socProzent: readRegister(b.akkuSocRegisterId),
    ladeleistungKw: ladeReg == null ? null : Math.max(0, -ladeReg),
    maxLadeleistungKw: readRegister(b.akkuMaxLadeRegisterId),
  };

  // --- min-Select ---
  const pLimitKw = logic.pLimitKw({ direktvermarkterKw, netzbetreiberKw });

  // --- Regler (nur rechnen) ---
  let regler = null;
  if (napEinspeisungKw != null) {
    regler = logic.reglerSchritt(
      { napEinspeisungKw, pLimitKw, wrSollwertAktuellKw: _wrSollwertKw, akku },
      cfg,
    );
    if (regler.wrSollwertKw != null) _wrSollwertKw = regler.wrSollwertKw;
  }

  // --- Aktuierung: in v1 bewusst NICHT vorhanden (kein Schreibpfad). ---
  const aktuierungMoeglich = Boolean(cfg.aktuierungAktiv && b.logoSourceId && b.aq3TargetRegisterId);

  _state = {
    zeit: new Date().toISOString(),
    aktiv: true,
    direktvermarkterKw,
    netzbetreiberStufeProzent: stufe ? stufe.prozent : null,
    netzbetreiberKw,
    pLimitKw,
    napEinspeisungKw,
    akku,
    wrSollwertKw: _wrSollwertKw,
    regler,
    aktuierungAktiv: Boolean(cfg.aktuierungAktiv),
    aktuierungMoeglich,
    aktuiert: false, // v1: es wird nie geschrieben
    inputsFehlen: fehlt,
    pRef100Kw: cfg.pRef100Kw,
  };
  return _state;
}

function startControl() {
  if (_handle) return;
  const cfg = einspeisemanagementService.getConfig();
  const ms = Math.max(200, Number(cfg.reglerAbtastMs) || 1000);
  _wrSollwertKw = Number(cfg.wrSollwertMaxKw); // sicherer Start: volle Leistung, keine Drosselung
  _handle = setInterval(() => {
    try { computeOnce(); } catch (e) { console.error('[controlService]', e.message); }
  }, ms);
  try { computeOnce(); } catch (e) { console.error('[controlService]', e.message); }
}

function stopControl() {
  if (_handle) { clearInterval(_handle); _handle = null; }
}

function getControlState() {
  return { ..._state };
}

module.exports = { startControl, stopControl, getControlState, computeOnce };
