'use strict';

// Speicherplatz-Auskunft für das Datenverzeichnis.
//
// Das Gerät läuft dauerhaft und schreibt Verlaufsdaten. Ohne eine Anzeige merkt man
// eine volle Platte erst, wenn Schreibvorgänge fehlschlagen — und dann steht auch der
// Regler still, weil seine Konfiguration nicht mehr gespeichert werden kann.

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config/appConfig');

function verzeichnisGroesse(dir) {
  let bytes = 0;
  let dateien = 0;
  let eintraege;
  try { eintraege = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return { bytes: 0, dateien: 0 }; }
  for (const e of eintraege) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const u = verzeichnisGroesse(p);
      bytes += u.bytes; dateien += u.dateien;
    } else {
      try { bytes += fs.statSync(p).size; dateien += 1; } catch { /* verschwunden */ }
    }
  }
  return { bytes, dateien };
}

function platte(pfad) {
  // fs.statfs gibt es ab Node 18.15; sonst gibt es hier eben keine Angabe.
  try {
    const st = fs.statfsSync(pfad);
    const gesamt = st.blocks * st.bsize;
    const frei = st.bavail * st.bsize;
    return {
      gesamtBytes: gesamt,
      freiBytes: frei,
      belegtBytes: gesamt - frei,
      belegtProzent: gesamt > 0 ? ((gesamt - frei) / gesamt) * 100 : null,
    };
  } catch { return null; }
}

// Verlaufsdateien, die zu keiner aktiven Reihe mehr gehören: sie bleiben bewusst liegen,
// damit ein versehentlich abgewählter Wert seinen Verlauf behält — aber man sollte sie sehen.
function verwaisteVerlaufsdateien() {
  const dir = path.join(DATA_DIR, 'history');
  let aktiv = new Set();
  try {
    const cfg = require('./dashboardService').getConfig();
    aktiv = new Set((cfg.liveItems || []).map((i) => `${i.kind}:${i.id}`.replace(/[^A-Za-z0-9_.:-]/g, '_').replace(/:/g, '__')));
  } catch { /* ohne Auswahl gilt alles als verwaist */ }
  const out = [];
  let dateien = [];
  try { dateien = fs.readdirSync(dir); } catch { return out; }
  for (const f of dateien) {
    if (!f.endsWith('.ndjson')) continue;
    const key = f.replace(/\.ndjson$/, '');
    if (aktiv.has(key)) continue;
    let size = 0;
    try { size = fs.statSync(path.join(dir, f)).size; } catch { /* egal */ }
    out.push({ datei: f, bytes: size });
  }
  return out;
}

function bericht() {
  const unter = {};
  let eintraege = [];
  try { eintraege = fs.readdirSync(DATA_DIR, { withFileTypes: true }); } catch { /* noch nichts */ }
  for (const e of eintraege) {
    const p = path.join(DATA_DIR, e.name);
    if (e.isDirectory()) unter[e.name] = verzeichnisGroesse(p);
    else {
      try { unter[e.name] = { bytes: fs.statSync(p).size, dateien: 1 }; } catch { /* egal */ }
    }
  }
  const gesamt = verzeichnisGroesse(DATA_DIR);
  const verwaist = verwaisteVerlaufsdateien();

  // Obergrenze des Verlaufs-Loggers: er kappt je Reihe auf maxPunkteJeReihe.
  let prognose = null;
  try {
    const hcfg = require('./historyService').getConfig();
    const reihen = require('./historyService').listSeries().filter((r) => r.aktiv).length;
    const bytesJeZeile = 32;   // "[1788717778640,125]\n" plus Reserve
    prognose = {
      reihen,
      punkteJeReihe: hcfg.maxPunkteJeReihe,
      tageJeReihe: hcfg.maxPunkteJeReihe * hcfg.intervalMs / 1000 / 86400,
      maxBytes: reihen * hcfg.maxPunkteJeReihe * bytesJeZeile,
    };
  } catch { /* ohne Logger keine Prognose */ }

  return {
    datenverzeichnis: DATA_DIR,
    gesamt,
    unterverzeichnisse: unter,
    platte: platte(DATA_DIR),
    verlaufProgose: prognose,
    verwaisteVerlaufsdateien: verwaist,
    verwaisteBytes: verwaist.reduce((a, v) => a + v.bytes, 0),
  };
}

// Verwaiste Verlaufsdateien entfernen — nur auf ausdrückliche Anforderung.
function raeumeVerwaiste() {
  const dir = path.join(DATA_DIR, 'history');
  const weg = [];
  for (const v of verwaisteVerlaufsdateien()) {
    try { fs.unlinkSync(path.join(dir, v.datei)); weg.push(v.datei); } catch { /* egal */ }
  }
  return weg;
}

module.exports = { bericht, raeumeVerwaiste, verzeichnisGroesse };
