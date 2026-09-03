const { test } = require('node:test');
const assert = require('node:assert');
const EinspeisemanagementConfig = require('../domain/EinspeisemanagementConfig');
const {
  netzbetreiberStufe,
  pLimitKw,
  effektiveEinspeisungKw,
  reglerSchritt,
  dargebotKw,
  pKannKw,
} = require('./einspeisemanagementLogic');

const cfg = (over = {}) => new EinspeisemanagementConfig({ pRef100Kw: 125, ...over });

// --- Netzbetreiber-Stufen ---

test('kein Kontakt aktiv => 100 % => P_ref', () => {
  const r = netzbetreiberStufe({ i1: false, i2: false, i3: false }, cfg());
  assert.strictEqual(r.prozent, 100);
  assert.strictEqual(r.kw, 125);
});

test('I1 => 60 %', () => {
  const r = netzbetreiberStufe({ i1: true }, cfg());
  assert.strictEqual(r.prozent, 60);
  assert.strictEqual(r.kw, 75);
});

test('I3 => 0 %', () => {
  const r = netzbetreiberStufe({ i3: true }, cfg());
  assert.strictEqual(r.prozent, 0);
  assert.strictEqual(r.kw, 0);
});

test('mehrere Kontakte aktiv => restriktivste (niedrigste) Stufe', () => {
  const r = netzbetreiberStufe({ i1: true, i2: true }, cfg()); // 60 & 30 -> 30
  assert.strictEqual(r.prozent, 30);
});

test('P_ref einstellbar wirkt auf kW', () => {
  const r = netzbetreiberStufe({ i1: true }, cfg({ pRef100Kw: 100 })); // 60 % von 100
  assert.strictEqual(r.kw, 60);
});

// --- min-Select ---

test('min-Select: niedrigerer Wert gewinnt', () => {
  assert.strictEqual(pLimitKw({ direktvermarkterKw: 80, netzbetreiberKw: 75 }), 75);
  assert.strictEqual(pLimitKw({ direktvermarkterKw: 40, netzbetreiberKw: 75 }), 40);
});

test('min-Select: fehlender Wert wird ignoriert', () => {
  assert.strictEqual(pLimitKw({ direktvermarkterKw: null, netzbetreiberKw: 75 }), 75);
  assert.strictEqual(pLimitKw({ direktvermarkterKw: 50, netzbetreiberKw: null }), 50);
});

test('min-Select: beide fehlen => null', () => {
  assert.strictEqual(pLimitKw({ direktvermarkterKw: null, netzbetreiberKw: undefined }), null);
});

// --- Einseitiger Begrenzer ---

test('unter Limit: PV wird hochgefahren (Richtung Max)', () => {
  const c = cfg({ wrSollwertMaxKw: 125, reglerVerstaerkung: 0.5, maxSchrittKw: 100, totbandKw: 1 });
  const r = reglerSchritt({ napEinspeisungKw: 40, pLimitKw: 60, wrSollwertAktuellKw: 100, akku: { verfuegbar: false } }, c);
  assert.ok(r.wrSollwertKw > 100, 'sollte hochfahren');
  assert.strictEqual(r.grund, 'lockern');
});

test('über Limit: PV wird gedrosselt', () => {
  const c = cfg({ reglerVerstaerkung: 0.5, maxSchrittKw: 100, totbandKw: 1 });
  const r = reglerSchritt({ napEinspeisungKw: 80, pLimitKw: 60, wrSollwertAktuellKw: 100, akku: { verfuegbar: false } }, c);
  assert.ok(r.wrSollwertKw < 100, 'sollte drosseln');
  assert.strictEqual(r.grund, 'drosseln');
  assert.strictEqual(r.drosselAktiv, true);
});

test('innerhalb Totband: WR-Sollwert hält', () => {
  const c = cfg({ totbandKw: 2, maxSchrittKw: 100 });
  const r = reglerSchritt({ napEinspeisungKw: 61, pLimitKw: 60, wrSollwertAktuellKw: 90, akku: { verfuegbar: false } }, c);
  assert.strictEqual(r.wrSollwertKw, 90);
  assert.strictEqual(r.grund, 'halten');
});

test('Ratenbegrenzung: max. Schritt wird eingehalten', () => {
  const c = cfg({ reglerVerstaerkung: 1, maxSchrittKw: 5, totbandKw: 1 });
  const r = reglerSchritt({ napEinspeisungKw: 200, pLimitKw: 60, wrSollwertAktuellKw: 100, akku: { verfuegbar: false } }, c);
  assert.strictEqual(r.wrSollwertKw, 95); // 100 - 5 (begrenzt), nicht 100 - 139
});

test('Clamp: WR-Sollwert bleibt in [min,max]', () => {
  const c = cfg({ wrSollwertMinKw: 0, wrSollwertMaxKw: 125, reglerVerstaerkung: 1, maxSchrittKw: 1000, totbandKw: 0 });
  const rHoch = reglerSchritt({ napEinspeisungKw: 0, pLimitKw: 60, wrSollwertAktuellKw: 124, akku: { verfuegbar: false } }, c);
  assert.ok(rHoch.wrSollwertKw <= 125);
  const rRunter = reglerSchritt({ napEinspeisungKw: 500, pLimitKw: 60, wrSollwertAktuellKw: 3, akku: { verfuegbar: false } }, c);
  assert.ok(rRunter.wrSollwertKw >= 0);
});

test('kein P_limit => null (Caller entscheidet Failsafe)', () => {
  const r = reglerSchritt({ napEinspeisungKw: 50, pLimitKw: null, wrSollwertAktuellKw: 100, akku: { verfuegbar: false } }, cfg());
  assert.strictEqual(r.wrSollwertKw, null);
  assert.strictEqual(r.grund, 'kein P_limit');
});

// --- Akku-Vorsteuerung ---

test('Akku mit viel Reserve: effektive Einspeisung ~ gemessen', () => {
  const c = cfg({ akkuVorsteuerung: true });
  const eff = effektiveEinspeisungKw(0, { verfuegbar: true, ladeleistungKw: 10, maxLadeleistungKw: 50 }, c);
  assert.ok(eff < 3, `erwartet nahe 0, war ${eff}`); // Reserve 40/50 -> Erschöpfung 0.2 -> +2
});

test('Akku am Anschlag: aufgenommene Leistung wird vorweggenommen', () => {
  const c = cfg({ akkuVorsteuerung: true });
  // Akku lädt 30, kann aber nicht mehr (maxLade=30 -> Reserve 0 -> Erschöpfung 1)
  const eff = effektiveEinspeisungKw(0, { verfuegbar: true, ladeleistungKw: 30, maxLadeleistungKw: 30 }, c);
  assert.strictEqual(eff, 30);
});

test('Akku-Vorsteuerung deaktiviert: gemessener Wert unverändert', () => {
  const c = cfg({ akkuVorsteuerung: false });
  const eff = effektiveEinspeisungKw(5, { verfuegbar: true, ladeleistungKw: 30, maxLadeleistungKw: 30 }, c);
  assert.strictEqual(eff, 5);
});

// --- Dargebot ---

test('Dargebot: volle Referenzstrahlung => installierte Leistung', () => {
  const c = cfg({ pInstalliertKw: 160, strahlungReferenzWm2: 1000 });
  assert.strictEqual(dargebotKw(1000, 1000, c), 160);
});

test('Dargebot: Mittel aus Ost/West', () => {
  const c = cfg({ pInstalliertKw: 160, strahlungReferenzWm2: 1000 });
  assert.strictEqual(dargebotKw(1000, 0, c), 80); // Mittel 500 -> 50%
});

test('Dargebot: keine Strahlung => null', () => {
  const c = cfg({ pInstalliertKw: 160 });
  assert.strictEqual(dargebotKw(null, undefined, c), null);
});

// --- P_kann-Auswahl ---

test('P_kann: ohne Drosselung = Ist-Leistung', () => {
  assert.strictEqual(pKannKw({ drosselAktiv: false, pIstKw: 92, dargebotKw: 140 }), 92);
});

test('P_kann: mit Drosselung = Dargebot', () => {
  assert.strictEqual(pKannKw({ drosselAktiv: true, pIstKw: 40, dargebotKw: 140 }), 140);
});

test('P_kann: ohne Ist fällt auf Dargebot zurück', () => {
  assert.strictEqual(pKannKw({ drosselAktiv: false, pIstKw: null, dargebotKw: 140 }), 140);
});
