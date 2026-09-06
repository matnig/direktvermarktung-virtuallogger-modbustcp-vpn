const { test } = require('node:test');
const assert = require('node:assert');
const { simuliereSpeicher, ergaenzePv, bewerte } = require('./wirtschaftlichkeitLogik');

// Ein Tag: 48 Viertelstunden Ueberschuss, danach 48 Viertelstunden Bezug
const tag = (ueberschuss, bezug) => [
  ...Array.from({ length: 48 }, (_, i) => [i * 900000, 0, ueberschuss]),
  ...Array.from({ length: 48 }, (_, i) => [(48 + i) * 900000, bezug, 0]),
];

test('ohne Speicher bleibt der Lastgang unveraendert', () => {
  const s = simuliereSpeicher(tag(2, 2), { kapazitaetKwh: 0, leistungKw: 0 });
  assert.strictEqual(s.verschobenKwh, 0);
  assert.strictEqual(s.bezugNeuKwh, s.bezugAltKwh);
  assert.strictEqual(s.einspeisungNeuKwh, s.einspeisungAltKwh);
});

test('Speicher verschiebt Ueberschuss in den Bezug', () => {
  // 96 kWh Ueberschuss, 96 kWh Bezug, 50 kWh nutzbar (100 kWh x 0,5 DoD)
  const s = simuliereSpeicher(tag(2, 2), {
    kapazitaetKwh: 100, leistungKw: 100, wirkungsgrad: 1, entladetiefe: 0.5,
  });
  assert.ok(s.verschobenKwh > 40 && s.verschobenKwh <= 50,
    `erwartet bis 50 kWh, war ${s.verschobenKwh}`);
  assert.ok(Math.abs(s.bezugAltKwh - s.bezugNeuKwh - s.verschobenKwh) < 1e-6,
    'der Bezug muss genau um die verschobene Menge sinken');
});

test('Wirkungsgrad kostet Energie: entladen < geladen', () => {
  const s = simuliereSpeicher(tag(2, 2), {
    kapazitaetKwh: 100, leistungKw: 100, wirkungsgrad: 0.81, entladetiefe: 1,
  });
  assert.ok(s.entladenKwh < s.geladenKwh, 'Verluste muessen sich zeigen');
  assert.ok(Math.abs(s.entladenKwh / s.geladenKwh - 0.81) < 0.05,
    `Round-Trip ~0,81 erwartet, war ${(s.entladenKwh / s.geladenKwh).toFixed(3)}`);
});

test('Ladeleistung begrenzt, nicht nur die Kapazitaet', () => {
  const gross = simuliereSpeicher(tag(2, 2), { kapazitaetKwh: 500, leistungKw: 100, wirkungsgrad: 1, entladetiefe: 1 });
  const klein = simuliereSpeicher(tag(2, 2), { kapazitaetKwh: 500, leistungKw: 2, wirkungsgrad: 1, entladetiefe: 1 });
  assert.ok(klein.verschobenKwh < gross.verschobenKwh, 'geringe Leistung muss weniger schaffen');
});

test('Ertrag saettigt: mehr Kapazitaet bringt irgendwann nichts mehr', () => {
  // Der Tag bietet nur 96 kWh Ueberschuss — darueber hinaus kann kein Speicher etwas holen.
  const a = simuliereSpeicher(tag(2, 2), { kapazitaetKwh: 40, leistungKw: 100, wirkungsgrad: 1, entladetiefe: 1 });
  const b = simuliereSpeicher(tag(2, 2), { kapazitaetKwh: 200, leistungKw: 100, wirkungsgrad: 1, entladetiefe: 1 });
  assert.ok(b.verschobenKwh > a.verschobenKwh);
  assert.ok(b.verschobenKwh < a.verschobenKwh * 5, 'fuenffache Kapazitaet darf nicht fuenffachen Ertrag bringen');
  assert.ok(b.verschobenKwh <= 96 + 1e-6, 'nicht mehr als der vorhandene Ueberschuss');
});

test('Bilanz stimmt: es wird nie mehr entladen als geladen', () => {
  const s = simuliereSpeicher(tag(2, 2), { kapazitaetKwh: 100, leistungKw: 100, wirkungsgrad: 0.9, entladetiefe: 1 });
  assert.ok(s.entladenKwh <= s.geladenKwh + 1e-9,
    `entladen ${s.entladenKwh} darf geladen ${s.geladenKwh} nicht uebersteigen`);
});

test('zusaetzliche PV deckt zuerst Bezug, der Rest erhoeht die Einspeisung', () => {
  const punkte = [[0, 10, 0], [900000, 0, 0]];
  const neu = ergaenzePv(punkte, [1, 1], 20);   // 10 kWh je Schritt
  assert.strictEqual(neu[0][1], 0);             // Bezug gedeckt
  assert.strictEqual(neu[0][2], 0);             // nichts uebrig
  assert.strictEqual(neu[1][2], 10);            // zweiter Schritt komplett Einspeisung
});

test('Bewertung: Verschiebung lohnt nur ueber der Differenz der Preise', () => {
  const sim = {
    bezugAltKwh: 1000, bezugNeuKwh: 900, einspeisungAltKwh: 1000, einspeisungNeuKwh: 890,
    verschobenKwh: 100, wenigerEinspeisungKwh: 110, geladenKwh: 110, entladenKwh: 100, vollzyklen: 1,
  };
  const preise = { bezugspreisEurProKwh: 0.30, ertragDirektvermarktungEurProKwh: 0.07,
                   ertragDirektKundeEurProKwh: 0.22, anteilDirektKundeProzent: 0 };
  const r = bewerte(sim, preise, { akkuNeuKwh: 100, akkuNeuKostenEurProKwh: 300,
    betriebskostenProzentProJahr: 0, jahresfaktor: 1 });
  // 100 x 0,30 gewonnen minus 110 x 0,07 entgangen
  assert.ok(Math.abs(r.gewinnVerschiebungEur - (30 - 7.7)) < 1e-6);
  assert.strictEqual(r.investBruttoEur, 30000);
});

test('Verkaufserloes des Bestandsspeichers mindert die Investition', () => {
  const sim = { bezugAltKwh: 0, bezugNeuKwh: 0, einspeisungAltKwh: 0, einspeisungNeuKwh: 0,
                verschobenKwh: 0, wenigerEinspeisungKwh: 0, geladenKwh: 0, entladenKwh: 0, vollzyklen: 0 };
  const r = bewerte(sim, {}, { akkuNeuKwh: 100, akkuNeuKostenEurProKwh: 300, akkuVerkaufserloesEur: 8000 });
  assert.strictEqual(r.investBruttoEur, 30000);
  assert.strictEqual(r.investNettoEur, 22000);
});

test('ohne Ertrag gibt es keine Amortisation statt einer negativen Zahl', () => {
  const sim = { bezugAltKwh: 0, bezugNeuKwh: 0, einspeisungAltKwh: 0, einspeisungNeuKwh: 0,
                verschobenKwh: 0, wenigerEinspeisungKwh: 0, geladenKwh: 0, entladenKwh: 0, vollzyklen: 0 };
  const r = bewerte(sim, {}, { akkuNeuKwh: 100, akkuNeuKostenEurProKwh: 300 });
  assert.strictEqual(r.amortisationJahre, null);
  assert.ok(r.barwertEur < 0);
});

// --- Zeiten ohne Einspeiseerloes ---

test('an Nullpreis-Zeiten kostet verlagerte Einspeisung keinen entgangenen Erloes', () => {
  const sim = {
    bezugAltKwh: 1000, bezugNeuKwh: 900, einspeisungAltKwh: 1000, einspeisungNeuKwh: 890,
    verschobenKwh: 100, wenigerEinspeisungKwh: 110,
    einspeisungAltNullKwh: 1000, einspeisungNeuNullKwh: 890,   // alles im Nullpreis-Fenster
    geladenKwh: 110, entladenKwh: 100, vollzyklen: 1,
  };
  const preise = { bezugspreisEurProKwh: 0.23, ertragDirektvermarktungEurProKwh: 0.08,
                   nullpreisVerguetungEurProKwh: 0 };
  const r = bewerte(sim, preise, { betriebskostenProzentProJahr: 0, jahresfaktor: 1 });
  assert.ok(Math.abs(r.gewinnVerschiebungEur - 23) < 1e-6,
    `volle 100 x 0,23 erwartet, war ${r.gewinnVerschiebungEur}`);
  assert.strictEqual(r.wenigerEinspeisungNormalKwh, 0);
});

test('ausserhalb der Nullpreis-Zeiten wird der entgangene Erloes weiterhin abgezogen', () => {
  const sim = {
    bezugAltKwh: 1000, bezugNeuKwh: 900, einspeisungAltKwh: 1000, einspeisungNeuKwh: 890,
    verschobenKwh: 100, wenigerEinspeisungKwh: 110,
    einspeisungAltNullKwh: 0, einspeisungNeuNullKwh: 0,
    geladenKwh: 110, entladenKwh: 100, vollzyklen: 1,
  };
  const r = bewerte(sim, { bezugspreisEurProKwh: 0.23, ertragDirektvermarktungEurProKwh: 0.08 },
    { betriebskostenProzentProJahr: 0, jahresfaktor: 1 });
  assert.ok(Math.abs(r.gewinnVerschiebungEur - (23 - 8.8)) < 1e-6);
});

test('gemischt: nur der Nullpreis-Anteil bleibt ohne Abzug', () => {
  const sim = {
    bezugAltKwh: 1000, bezugNeuKwh: 900, einspeisungAltKwh: 1000, einspeisungNeuKwh: 890,
    verschobenKwh: 100, wenigerEinspeisungKwh: 110,
    einspeisungAltNullKwh: 500, einspeisungNeuNullKwh: 440,   // 60 der 110 im Nullpreis
    geladenKwh: 110, entladenKwh: 100, vollzyklen: 1,
  };
  const r = bewerte(sim, { bezugspreisEurProKwh: 0.23, ertragDirektvermarktungEurProKwh: 0.08 },
    { betriebskostenProzentProJahr: 0, jahresfaktor: 1 });
  assert.strictEqual(r.wenigerEinspeisungNullpreisKwh, 60);
  assert.strictEqual(r.wenigerEinspeisungNormalKwh, 50);
  assert.ok(Math.abs(r.gewinnVerschiebungEur - (23 - 50 * 0.08)) < 1e-6);
});

test('Simulation zaehlt die Nullpreis-Einspeisung getrennt mit', () => {
  const punkte = [...Array.from({ length: 48 }, (_, i) => [i * 900000, 0, 2]),
                  ...Array.from({ length: 48 }, (_, i) => [(48 + i) * 900000, 2, 0])];
  const flags = punkte.map((_, i) => i < 24);   // erste 24 Schritte im Nullpreis
  const s = simuliereSpeicher(punkte, { kapazitaetKwh: 100, leistungKw: 100,
    wirkungsgrad: 1, entladetiefe: 1, nullpreis: flags });
  assert.strictEqual(s.einspeisungAltNullKwh, 48);          // 24 Schritte x 2 kWh
  assert.ok(s.einspeisungNeuNullKwh < s.einspeisungAltNullKwh,
    'der Speicher muss zuerst die fruehe Einspeisung aufnehmen');
});
