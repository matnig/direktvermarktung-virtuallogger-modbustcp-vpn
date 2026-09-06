'use strict';

// Verlaufs-Logger für die in der Übersicht ausgewählten Live-Werte.
//
// Aufbau bewusst schlicht und für ein Dauerlauf-Gerät ausgelegt:
//   - je Reihe ein Ringpuffer im Speicher -> Abfragen kommen ohne Plattenzugriff aus
//   - neue Punkte werden gesammelt und nur alle flushMs ANGEHÄNGT (NDJSON, eine Zeile je Punkt)
//     statt die ganze Reihe neu zu schreiben; bei 20 Reihen sind das rund 80 Byte pro Sekunde
//   - die Datei wird nur dann komplett neu geschrieben, wenn der Ringpuffer wirklich überläuft
//
// Aufgezeichnet wird, was in dashboard.liveItems steht. Fällt ein Wert aus der Auswahl,
// bleibt seine Datei liegen (der Verlauf geht nicht verloren) und wird nur nicht weitergeführt.

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config/appConfig');
const { readCollection, writeCollection } = require('../persistence/jsonStore');
const HistoryConfig = require('../domain/HistoryConfig');

const COLLECTION = 'history';
const DIR = path.join(DATA_DIR, 'history');

const reihen = new Map();   // key -> { punkte: [[tsMs, wert], ...], neu: [], geladen: bool }
let _timer = null;
let _flushTimer = null;

// ── Konfiguration ────────────────────────────────────────────────────
function createDefaultConfig() {
  const ts = new Date().toISOString();
  return new HistoryConfig({ createdAt: ts, updatedAt: ts });
}

function getConfig() {
  const [stored] = readCollection(COLLECTION, [createDefaultConfig()]);
  return new HistoryConfig(stored);
}

function updateConfig(payload = {}) {
  const current = getConfig();
  const next = new HistoryConfig({
    ...current, ...payload, createdAt: current.createdAt, updatedAt: new Date().toISOString(),
  });
  writeCollection(COLLECTION, [next]);
  restart();
  return next;
}

// ── Schlüssel und Dateien ────────────────────────────────────────────
function schluessel(kind, id) { return `${kind}:${id}`; }

// Ids können Punkte und Sonderzeichen enthalten (z. B. "akku.socProzent") — für den
// Dateinamen alles ersetzen, was Pfade beeinflussen könnte.
function dateiname(key) {
  return path.join(DIR, key.replace(/[^A-Za-z0-9_.:-]/g, '_').replace(/:/g, '__') + '.ndjson');
}

function reihe(key) {
  if (!reihen.has(key)) reihen.set(key, { punkte: [], neu: [], geladen: false });
  const r = reihen.get(key);
  if (!r.geladen) {
    r.geladen = true;
    try {
      const roh = fs.readFileSync(dateiname(key), 'utf8');
      for (const zeile of roh.split('\n')) {
        if (!zeile) continue;
        try {
          const p = JSON.parse(zeile);
          if (Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0])) r.punkte.push([p[0], p[1]]);
        } catch { /* eine kaputte Zeile darf die Reihe nicht unbrauchbar machen */ }
      }
    } catch { /* noch keine Datei */ }
  }
  return r;
}

// ── Werte auflösen (dieselben Quellen wie die Übersicht) ─────────────
function pfad(obj, p) {
  return String(p).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function leseWert(kind, id) {
  try {
    if (kind === 'register') {
      const rt = require('./runtimeService').getRuntimeState() || {};
      const st = (rt.registerStates || {})[id];
      if (!st || st.error || st.scaledValue == null) return null;
      return Number(st.scaledValue);
    }
    if (kind === 'variable') {
      const vs = require('./variableService').getVariableState(id);
      if (!vs || vs.currentValue == null) return null;
      const n = Number(vs.currentValue);
      return Number.isFinite(n) ? n : (typeof vs.currentValue === 'boolean' ? (vs.currentValue ? 1 : 0) : null);
    }
    if (kind === 'external') {
      const externalRegisterValues = require('./externalRegisterValues');
      const eintrag = externalRegisterValues.listValues().find((r) => r.id === id);
      const v = externalRegisterValues.valueOf(eintrag);
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
    if (kind === 'em') {
      const state = require('./controlService').getControlState() || {};
      const v = pfad(state, id);
      if (typeof v === 'boolean') return v ? 1 : 0;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    }
  } catch { /* eine kaputte Quelle darf den Logger nicht anhalten */ }
  return null;
}

// ── Aufzeichnung ─────────────────────────────────────────────────────
function aktiveReihen() {
  try {
    const cfg = require('./dashboardService').getConfig();
    return (cfg.liveItems || []).map((i) => ({ kind: i.kind, id: i.id }));
  } catch { return []; }
}

function tick() {
  const cfg = getConfig();
  if (!cfg.enabled) return;
  const jetzt = Date.now();
  for (const { kind, id } of aktiveReihen()) {
    const wert = leseWert(kind, id);
    if (wert === null) continue;               // Lücke statt Falschwert
    const key = schluessel(kind, id);
    const r = reihe(key);
    const punkt = [jetzt, Number(wert.toFixed ? Number(wert.toFixed(4)) : wert)];
    r.punkte.push(punkt);
    r.neu.push(punkt);
  }
}

function flush() {
  const cfg = getConfig();
  try { fs.mkdirSync(DIR, { recursive: true }); } catch { /* egal */ }
  for (const [key, r] of reihen) {
    const ueberlauf = r.punkte.length > cfg.maxPunkteJeReihe;
    if (ueberlauf) {
      // Ringpuffer gekappt -> die Datei muss einmal komplett neu geschrieben werden.
      r.punkte = r.punkte.slice(r.punkte.length - cfg.maxPunkteJeReihe);
      r.neu = [];
      try {
        fs.writeFileSync(dateiname(key), r.punkte.map((p) => JSON.stringify(p)).join('\n') + '\n');
      } catch (e) { console.warn('[history] Neuschreiben fehlgeschlagen:', key, e.message); }
      continue;
    }
    if (!r.neu.length) continue;
    const zeilen = r.neu.map((p) => JSON.stringify(p)).join('\n') + '\n';
    r.neu = [];
    try { fs.appendFileSync(dateiname(key), zeilen); }
    catch (e) { console.warn('[history] Anhängen fehlgeschlagen:', key, e.message); }
  }
}

// ── Abfrage ──────────────────────────────────────────────────────────
// Fasst Rohpunkte auf höchstens `maxPunkte` Bündel zusammen. Je Bündel wird neben dem
// Mittelwert auch Minimum und Maximum geführt — ein reiner Mittelwert würde bei PV-Daten
// genau die Spitzen verschlucken, wegen derer man sich den Verlauf ansieht.
// Leere Zeitabschnitte erzeugen KEIN Bündel, damit im Diagramm eine Lücke sichtbar bleibt.
function buendeln(roh, von, bis, maxPunkte = 400) {
  const grenze = Math.max(10, Math.min(2000, Number(maxPunkte) || 400));
  if (roh.length <= grenze) return roh.map(([t, v]) => ({ t, v, min: v, max: v }));

  const spanne = bis - von;
  const breite = spanne > 0 ? spanne / grenze : 1;
  const buendel = new Map();
  for (const [t, v] of roh) {
    const idx = Math.min(grenze - 1, Math.max(0, Math.floor((t - von) / breite)));
    const b = buendel.get(idx) || { t: 0, summe: 0, n: 0, min: Infinity, max: -Infinity };
    b.t += t; b.summe += v; b.n += 1;
    if (v < b.min) b.min = v;
    if (v > b.max) b.max = v;
    buendel.set(idx, b);
  }
  return [...buendel.entries()].sort((a, b) => a[0] - b[0]).map(([, b]) => ({
    t: Math.round(b.t / b.n), v: b.summe / b.n, min: b.min, max: b.max,
  }));
}


// Liefert höchstens maxPunkte Bündel; je Bündel Mittelwert plus Minimum und Maximum,
// damit beim Zusammenfassen keine Spitzen verschwinden.
function query({ kind, id, vonMs, bisMs, maxPunkte = 400 }) {
  const key = schluessel(kind, id);
  const r = reihe(key);
  const bis = Number.isFinite(bisMs) ? bisMs : Date.now();
  const von = Number.isFinite(vonMs) ? vonMs : bis - 6 * 3600 * 1000;
  const roh = r.punkte.filter((p) => p[0] >= von && p[0] <= bis);
  if (!roh.length) return { kind, id, von, bis, punkte: [], anzahlRoh: 0 };

  const punkte = buendeln(roh, von, bis, maxPunkte);

  const werte = roh.map((p) => p[1]);
  return {
    kind, id, von, bis, punkte, anzahlRoh: roh.length,
    min: Math.min(...werte), max: Math.max(...werte),
    mittel: werte.reduce((a, b) => a + b, 0) / werte.length,
    letzter: roh[roh.length - 1][1],
  };
}

function listSeries() {
  const aktiv = aktiveReihen().map((i) => schluessel(i.kind, i.id));
  const bekannt = new Set(aktiv);
  try {
    for (const f of fs.readdirSync(DIR)) {
      if (f.endsWith('.ndjson')) bekannt.add(f.replace(/\.ndjson$/, '').replace(/__/g, ':'));
    }
  } catch { /* Verzeichnis gibt es noch nicht */ }
  return [...bekannt].map((key) => {
    const [kind, ...rest] = key.split(':');
    const id = rest.join(':');
    const r = reihen.has(key) ? reihen.get(key) : null;
    return {
      kind, id, key,
      aktiv: aktiv.includes(key),
      punkte: r ? r.punkte.length : null,
      von: r && r.punkte.length ? r.punkte[0][0] : null,
      bis: r && r.punkte.length ? r.punkte[r.punkte.length - 1][0] : null,
    };
  });
}

// ── Lebenszyklus ─────────────────────────────────────────────────────
function start() {
  const cfg = getConfig();
  stop();
  if (!cfg.enabled) return;
  for (const { kind, id } of aktiveReihen()) reihe(schluessel(kind, id)); // vorladen
  _timer = setInterval(() => { try { tick(); } catch (e) { console.error('[history]', e.message); } }, cfg.intervalMs);
  _flushTimer = setInterval(() => { try { flush(); } catch (e) { console.error('[history flush]', e.message); } }, cfg.flushMs);
  console.log(`[history] Verlaufs-Logger aktiv (alle ${cfg.intervalMs} ms, Puffer ${cfg.maxPunkteJeReihe} Punkte je Reihe)`);
}

function stop() {
  if (_timer) { clearInterval(_timer); _timer = null; }
  if (_flushTimer) { clearInterval(_flushTimer); _flushTimer = null; }
}

function restart() { start(); }

module.exports = {
  COLLECTION, createDefaultConfig, getConfig, updateConfig,
  start, stop, restart, flush, tick, query, listSeries, leseWert, buendeln,
};
