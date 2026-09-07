const { test } = require('node:test');
const assert = require('node:assert');
const L = require('./dargebotLernLogik');

const CFG = { strahlungReferenzWm2: 1000, lernHalbwertszeitTage: 30,
  lernMinStrahlungWm2: 300, lernMinLeistungKw: 10, lernMinBeobachtungen: 50,
  pInstalliertKw: 79.1, pDiffusKw: 57.45, lernMaxAbweichungProzent: 25 };

// Kuenstliche Anlage mit bekannten Koeffizienten
const echteA = 80, echteB = 55;
function punkt(nw, so) {
  return { strNw: nw, strSo: so, pIstKw: (nw + so) / 2 / 1000 * echteA + Math.min(nw, so) / 1000 * echteB,
           drosselAktiv: false };
}

function lauf(punkte, cfg = CFG, startMs = 0, schrittMs = 15000) {
  let z = L.leererZustand();
  punkte.forEach((p, i) => { z = L.beobachte(z, p, cfg, startMs + i * schrittMs).zustand; });
  return z;
}

test('findet die zugrunde liegenden Koeffizienten wieder', () => {
  const ps = [];
  for (let i = 0; i < 300; i++) {
    const nw = 350 + (i % 7) * 60, so = 400 + (i % 11) * 50;
    ps.push(punkt(nw, so));
  }
  const r = L.loese(lauf(ps), CFG);
  assert.ok(r.gueltig, r.grund);
  assert.ok(Math.abs(r.pInstalliertKw - echteA) < 1.5, `a erwartet ~${echteA}, war ${r.pInstalliertKw.toFixed(2)}`);
  assert.ok(Math.abs(r.pDiffusKw - echteB) < 1.5, `b erwartet ~${echteB}, war ${r.pDiffusKw.toFixed(2)}`);
});

test('gedrosselte Punkte werden nicht gelernt', () => {
  const p = { ...punkt(600, 700), drosselAktiv: true };
  const r = L.beobachte(L.leererZustand(), p, CFG);
  assert.strictEqual(r.uebernommen, false);
  assert.strictEqual(r.grund, 'gedrosselt');
});

test('Schwachlicht und Kleinstleistung werden aussortiert', () => {
  assert.strictEqual(L.beobachte(L.leererZustand(), punkt(100, 120), CFG).grund, 'zu wenig Strahlung');
  const schwach = { strNw: 600, strSo: 700, pIstKw: 2, drosselAktiv: false };
  assert.strictEqual(L.beobachte(L.leererZustand(), schwach, CFG).grund, 'zu wenig Leistung');
});

test('zu wenige Beobachtungen ergeben kein Ergebnis', () => {
  const r = L.loese(lauf([punkt(600, 700), punkt(500, 800)]), CFG);
  assert.strictEqual(r.gueltig, false);
  assert.ok(r.grund.includes('zu wenige'));
});

test('alte Beobachtungen verlieren an Gewicht', () => {
  // Erst 300 Punkte einer Anlage, dann 300 einer anderen, 60 Tage spaeter
  const alt = [];
  for (let i = 0; i < 300; i++) alt.push(punkt(400 + (i % 5) * 70, 450 + (i % 9) * 60));
  let z = lauf(alt, CFG, 0);
  const spaeter = 60 * 86400000;
  const neuA = 100, neuB = 30;
  for (let i = 0; i < 300; i++) {
    const nw = 400 + (i % 5) * 70, so = 450 + (i % 9) * 60;
    const p = { strNw: nw, strSo: so, drosselAktiv: false,
      pIstKw: (nw + so) / 2 / 1000 * neuA + Math.min(nw, so) / 1000 * neuB };
    z = L.beobachte(z, p, CFG, spaeter + i * 15000).zustand;
  }
  const r = L.loese(z, CFG);
  assert.ok(r.gueltig);
  // Nach zwei Halbwertszeiten muss der neue Zustand deutlich ueberwiegen
  assert.ok(Math.abs(r.pInstalliertKw - neuA) < Math.abs(r.pInstalliertKw - echteA),
    `naeher am neuen Wert erwartet, war ${r.pInstalliertKw.toFixed(1)}`);
});

test('Begrenzung haelt das Ergebnis am konfigurierten Wert fest', () => {
  const b = L.begrenze({ pInstalliertKw: 200, pDiffusKw: 200 }, CFG);
  assert.ok(Math.abs(b.pInstalliertKw - 79.1 * 1.25) < 1e-9);
  assert.ok(Math.abs(b.pDiffusKw - 57.45 * 1.25) < 1e-9);
  assert.strictEqual(b.begrenzt, true);
});

test('negative Koeffizienten werden nicht uebernommen', () => {
  const b = L.begrenze({ pInstalliertKw: -5, pDiffusKw: -1 }, CFG);
  assert.ok(b.pInstalliertKw >= 0 && b.pDiffusKw >= 0);
});

test('Werte innerhalb der Grenzen bleiben unveraendert', () => {
  const b = L.begrenze({ pInstalliertKw: 82, pDiffusKw: 55 }, CFG);
  assert.strictEqual(b.pInstalliertKw, 82);
  assert.strictEqual(b.pDiffusKw, 55);
  assert.strictEqual(b.begrenzt, false);
});
