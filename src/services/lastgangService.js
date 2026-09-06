'use strict';

// Import und Ablage von Lastgang-Zeitreihen (Netzbetreiber-CSV).
//
// Die Messdaten liegen als Datei je Datensatz unter DATA_DIR/lastgaenge/, nur die
// Metadaten stehen im JSON-Store: ein Jahr mit 15-Minuten-Werten sind rund 35.000 Punkte,
// die haben in der exportierbaren Konfiguration nichts zu suchen.

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { DATA_DIR } = require('../config/appConfig');
const { readCollection, updateCollection } = require('../persistence/jsonStore');

const COLLECTION = 'lastgaenge';
const DIR = path.join(DATA_DIR, 'lastgaenge');

// ── Home-Assistant-Export (Zaehlerstaende) ───────────────────────────
// Format: entity_id,state,last_changed mit KUMULIERTEM Zaehlerstand. Daraus wird die
// Energie je Intervall als Differenz gebildet. Rueckspruenge (Zaehlertausch, Neustart)
// und unplausible Spruenge werden verworfen statt als Riesenverbrauch zu zaehlen.
function parseHaCsv(text) {
  const zeilen = String(text).replace(/^﻿/, '').split(/\r?\n/);
  const kopf = (zeilen[0] || '').toLowerCase();
  if (!/entity_id/.test(kopf) || !/last_changed/.test(kopf)) return null;
  const spalten = kopf.split(',').map((c) => c.trim());
  const iState = spalten.indexOf('state');
  const iZeit = spalten.indexOf('last_changed');

  const roh = [];
  for (let i = 1; i < zeilen.length; i++) {
    const t = zeilen[i].split(',');
    if (t.length <= Math.max(iState, iZeit)) continue;
    const ts = Date.parse(t[iZeit]);
    const v = Number(t[iState]);
    if (Number.isFinite(ts) && Number.isFinite(v)) roh.push([ts, v]);
  }
  if (roh.length < 2) throw new Error('Zu wenige Datenpunkte im Home-Assistant-Export');
  roh.sort((a, b) => a[0] - b[0]);

  // Zaehlerstand -> Energie je Schritt
  const punkte = [];
  let verworfen = 0;
  for (let i = 1; i < roh.length; i++) {
    const d = roh[i][1] - roh[i - 1][1];
    const dtStunden = (roh[i][0] - roh[i - 1][0]) / 3600000;
    // Plausibilitaet: kein Ruecksprung, und nicht mehr als 1000 kWh je Stunde
    if (d < 0 || (dtStunden > 0 && d / dtStunden > 1000)) { verworfen++; continue; }
    punkte.push([roh[i][0], d, 0]);
  }
  if (!punkte.length) throw new Error('Keine plausiblen Differenzen im Zaehlerverlauf');
  const dt = punkte.length > 1
    ? Math.round((punkte[punkte.length - 1][0] - punkte[0][0]) / (punkte.length - 1) / 60000)
    : 60;
  return {
    punkte, messperiodeMin: Math.max(1, dt), einheit: 'kWh',
    rollenErkannt: true, ungueltigeZeilen: verworfen,
    von: punkte[0][0], bis: punkte[punkte.length - 1][0],
    art: 'zusatzlast',
  };
}

// ── CSV-Parser ───────────────────────────────────────────────────────
// Zugeschnitten auf das Format der Netzbetreiber-Downloads (IDSpecto/enVIEW und
// aehnliche): Kopfblock, dann eine Zeile "Datum/Uhrzeit;...", danach Werte mit
// deutschem Dezimalkomma und Semikolon als Trenner. Die Rollen der Datenreihen
// werden aus den OBIS-Kennzahlen im Kopf erkannt:
//   1-1:1.29.0 / "Netzbetreiber an Kunde" / (+P)  -> Bezug
//   1-1:2.29.0 / "Kunde an Netzbetreiber" / (-P)  -> Einspeisung
function parseCsv(text) {
  const ha = parseHaCsv(text);
  if (ha) return ha;
  const zeilen = String(text).replace(/^﻿/, '').split(/\r?\n/);
  const kopfIdx = zeilen.findIndex((l) => /^Datum\/Uhrzeit/i.test(l.trim()));
  if (kopfIdx < 0) {
    throw new Error('Kopfzeile "Datum/Uhrzeit" nicht gefunden — ist das ein Lastgang-Export?');
  }

  // Rollen aus dem Kopfblock ableiten
  const kopf = zeilen.slice(0, kopfIdx).join('\n');
  const rollen = [];
  for (const m of kopf.matchAll(/^\s*(\d+):\s*(.+)$/gm)) {
    const nr = Number(m[1]);
    const txt = m[2];
    let rolle = null;
    if (/1[.-]29\.0|Netzbetreiber an Kunde|\(\+P\)/i.test(txt)) rolle = 'bezug';
    else if (/2[.-]29\.0|Kunde an Netzbetreiber|\(-P\)/i.test(txt)) rolle = 'einspeisung';
    rollen[nr - 1] = rolle;
  }

  const einheit = (kopf.match(/^Ma[ßs]einheit;([^;]+)/mi) || [])[1] || 'kWh';
  const messperiodeMin = Number((kopf.match(/^Messperiode\s*\[min\];(\d+)/mi) || [])[1]) || 15;

  // Spaltenzuordnung: Datum, dann je Datenreihe Wert + Status
  const punkte = [];
  let ungueltig = 0;
  for (let i = kopfIdx + 1; i < zeilen.length; i++) {
    const z = zeilen[i];
    if (!z || !z.trim()) continue;
    const t = z.split(';');
    if (t.length < 3) { ungueltig++; continue; }
    const ts = parseZeit(t[0]);
    if (ts === null) { ungueltig++; continue; }
    const werte = [];
    for (let s = 1; s < t.length; s += 2) {
      const v = parseZahl(t[s]);
      werte.push(v);
    }
    punkte.push([ts, werte]);
  }
  if (!punkte.length) throw new Error('Keine auswertbaren Datenzeilen gefunden');

  // Rollen auf Spalten abbilden; ohne Erkennung: erste Spalte Bezug, zweite Einspeisung
  const spalteBezug = rollen.indexOf('bezug') >= 0 ? rollen.indexOf('bezug') : 0;
  const spalteEin = rollen.indexOf('einspeisung') >= 0 ? rollen.indexOf('einspeisung') : 1;

  const reihen = punkte.map(([ts, w]) => [
    ts,
    Number.isFinite(w[spalteBezug]) ? w[spalteBezug] : 0,
    Number.isFinite(w[spalteEin]) ? w[spalteEin] : 0,
  ]);
  reihen.sort((a, b) => a[0] - b[0]);

  return {
    punkte: reihen,
    messperiodeMin,
    einheit,
    rollenErkannt: rollen.some(Boolean),
    ungueltigeZeilen: ungueltig,
    von: reihen[0][0],
    bis: reihen[reihen.length - 1][0],
  };
}

function parseZeit(s) {
  const m = String(s).trim().match(/^(\d{2})\.(\d{2})\.(\d{4})[ T](\d{2}):(\d{2})/);
  if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4], +m[5]);
  const iso = Date.parse(s);
  return Number.isFinite(iso) ? iso : null;
}

function parseZahl(s) {
  if (s === undefined || s === null) return NaN;
  const t = String(s).trim().replace(/\./g, '').replace(',', '.');
  if (!t) return NaN;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

// ── Ablage ───────────────────────────────────────────────────────────
function datei(id) { return path.join(DIR, `${id}.json`); }

function list() { return readCollection(COLLECTION, []); }

function getPunkte(id) {
  try { return JSON.parse(fs.readFileSync(datei(id), 'utf8')).punkte || []; }
  catch { return []; }
}

function importieren({ name, csv }) {
  const geparst = parseCsv(csv);
  const id = uuidv4();
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(datei(id), JSON.stringify({ punkte: geparst.punkte }));

  const bezug = geparst.punkte.reduce((a, p) => a + p[1], 0);
  const einspeisung = geparst.punkte.reduce((a, p) => a + p[2], 0);
  const meta = {
    id,
    name: String(name || '').trim() || new Date(geparst.von).getFullYear().toString(),
    von: new Date(geparst.von).toISOString(),
    bis: new Date(geparst.bis).toISOString(),
    anzahlPunkte: geparst.punkte.length,
    messperiodeMin: geparst.messperiodeMin,
    einheit: geparst.einheit,
    art: geparst.art || 'netzknoten',
    rollenErkannt: geparst.rollenErkannt,
    ungueltigeZeilen: geparst.ungueltigeZeilen,
    summeBezugKwh: Number(bezug.toFixed(1)),
    summeEinspeisungKwh: Number(einspeisung.toFixed(1)),
    tage: Number((geparst.punkte.length * geparst.messperiodeMin / 1440).toFixed(1)),
    importiertAm: new Date().toISOString(),
  };
  // Atomar anhaengen statt Liste lesen und zurueckschreiben: zwei kurz aufeinander
  // folgende Importe (etwa aus der Oberflaeche und ueber die API) haben sich sonst
  // gegenseitig ueberschrieben — genau das ist am 06.09. passiert.
  updateCollection(COLLECTION, [], (aktuell) => [...aktuell, meta]);
  return meta;
}

function loeschen(id) {
  updateCollection(COLLECTION, [], (aktuell) => aktuell.filter((m) => m.id !== id));
  try { fs.unlinkSync(datei(id)); } catch { /* schon weg */ }
  return true;
}

module.exports = { COLLECTION, parseCsv, parseHaCsv, list, getPunkte, importieren, loeschen };
