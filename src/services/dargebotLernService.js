'use strict';

// Mitlernende Dargebot-Kalibrierung: Zustandshaltung und Anbindung an den Regler.
//
// Der Zustand (aufsummierte Normalgleichungen) wird nur alle paar Minuten geschrieben,
// nicht bei jedem Regeltakt — sonst entstünde bei 1 Hz unnötige Schreiblast. Beim
// Beenden wird noch einmal gesichert.

const { readCollection, writeCollection } = require('../persistence/jsonStore');
const logik = require('./dargebotLernLogik');

const COLLECTION = 'dargebotLernen';
const SCHREIB_INTERVALL_MS = 300000;

let _zustand = null;
let _letztGeschrieben = 0;
let _letztesErgebnis = null;

function laden() {
  if (_zustand) return _zustand;
  const [gespeichert] = readCollection(COLLECTION, [{}]);
  _zustand = { ...logik.leererZustand(), ...(gespeichert || {}) };
  return _zustand;
}

function sichern(erzwingen = false) {
  const jetzt = Date.now();
  if (!erzwingen && jetzt - _letztGeschrieben < SCHREIB_INTERVALL_MS) return false;
  _letztGeschrieben = jetzt;
  writeCollection(COLLECTION, [_zustand || logik.leererZustand()]);
  return true;
}

// Einen Regeltakt beobachten. Wird aus dem controlService aufgerufen und darf
// niemals werfen — eine kaputte Kalibrierung darf den Regler nicht anhalten.
function beobachte({ strNw, strSo, pIstKw, drosselAktiv }, cfg) {
  if (!cfg || !cfg.lernenAktiv) return;
  try {
    const z = laden();
    const r = logik.beobachte(z, { strNw, strSo, pIstKw, drosselAktiv }, cfg);
    _zustand = r.zustand;
    if (r.uebernommen) sichern();
  } catch (e) {
    console.warn('[dargebotLernen]', e.message);
  }
}

// Die aktuell gültigen Koeffizienten: gelernt, sofern gültig und innerhalb der
// Grenzen — sonst die konfigurierten. Der konfigurierte Wert bleibt damit immer
// die Rückfallebene.
function koeffizienten(cfg) {
  const basis = {
    pInstalliertKw: Number(cfg.pInstalliertKw) || 0,
    pDiffusKw: Number(cfg.pDiffusKw) || 0,
    quelle: 'konfiguriert',
    beobachtungen: 0,
    begrenzt: false,
  };
  if (!cfg.lernenAktiv) return basis;
  try {
    const z = laden();
    const gel = logik.loese(z, cfg);
    if (!gel.gueltig) return { ...basis, grund: gel.grund, beobachtungen: Math.round(z.n || 0) };
    const b = logik.begrenze(gel, cfg);
    _letztesErgebnis = {
      pInstalliertKw: b.pInstalliertKw, pDiffusKw: b.pDiffusKw,
      rohInstalliertKw: gel.pInstalliertKw, rohDiffusKw: gel.pDiffusKw,
      begrenzt: b.begrenzt, beobachtungen: Math.round(z.n || 0),
      standAm: z.tMs ? new Date(z.tMs).toISOString() : null,
    };
    return { ...b, quelle: 'gelernt', beobachtungen: Math.round(z.n || 0) };
  } catch (e) {
    console.warn('[dargebotLernen]', e.message);
    return basis;
  }
}

function status(cfg) {
  const z = laden();
  const gel = logik.loese(z, cfg || {});
  return {
    aktiv: Boolean(cfg && cfg.lernenAktiv),
    beobachtungen: Math.round(z.n || 0),
    standAm: z.tMs ? new Date(z.tMs).toISOString() : null,
    gelernt: gel.gueltig ? { pInstalliertKw: gel.pInstalliertKw, pDiffusKw: gel.pDiffusKw } : null,
    grund: gel.gueltig ? null : gel.grund,
    wirksam: _letztesErgebnis,
  };
}

function zuruecksetzen() {
  _zustand = logik.leererZustand();
  _letztesErgebnis = null;
  sichern(true);
  return true;
}

module.exports = { COLLECTION, beobachte, koeffizienten, status, zuruecksetzen, sichern };
