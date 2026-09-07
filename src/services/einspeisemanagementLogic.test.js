const { test } = require('node:test');
const assert = require('node:assert');
const EinspeisemanagementConfig = require('../domain/EinspeisemanagementConfig');
const {
  netzbetreiberStufe,
  pLimitKw,
  effektiveEinspeisungKw,
  akkuReserveKw,
  akkuFreigabeFaktor,
  akkuRestdauerS,
  akkuBetriebsbereit,
  sollwertObergrenzeKw,
  akkuAnnahmeWache,
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

test('Dargebot: Kappung bei dargebotMaxKw', () => {
  const c = cfg({ pInstalliertKw: 160, strahlungReferenzWm2: 1000, dargebotMaxKw: 105 });
  assert.strictEqual(dargebotKw(1000, 1000, c), 105); // 160 -> gekappt auf 105
  assert.strictEqual(dargebotKw(500, 500, c), 80);    // 80 < 105 -> unveraendert
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

// --- Akku-Freigabe: leerer Akku darf den Überschuss aufnehmen, PV nicht drosseln ---

test('Akku-Freigabe: SoC weit unter Schwelle => volle Ladereserve wird angerechnet', () => {
  const c = cfg();
  const akku = { verfuegbar: true, socProzent: 11, ladeleistungKw: 7.5, maxLadeleistungKw: 50 };
  assert.strictEqual(akkuFreigabeFaktor(akku, c), 1);
  assert.strictEqual(akkuReserveKw(akku, c), 42.5);
  // Reales Feldbild vom 05.09.: Netzknoten ~0, Akku lädt 7,5 kW bei SoC 11 %
  const eff = effektiveEinspeisungKw(0, akku, c);
  assert.strictEqual(eff, -42.5); // vorher: +1,1 -> Dauerdrosselung
});

test('Akku-Freigabe: Regler fährt die PV hoch statt zu drosseln', () => {
  const c = cfg();
  const akku = { verfuegbar: true, socProzent: 11, ladeleistungKw: 7.5, maxLadeleistungKw: 50 };
  const r = reglerSchritt(
    { napEinspeisungKw: 0, pLimitKw: 0, wrSollwertAktuellKw: 36, akku, jetztMs: 1000 },
    c,
  );
  assert.strictEqual(r.grund, 'lockern');
  assert.strictEqual(r.wrSollwertKw, 41); // +maxSchrittKw
});

test('Akku voll geladen (SoC >= Schwelle): altes konservatives Verhalten', () => {
  const c = cfg();
  const akku = { verfuegbar: true, socProzent: 90, ladeleistungKw: 10, maxLadeleistungKw: 50 };
  assert.strictEqual(akkuFreigabeFaktor(akku, c), 0);
  assert.ok(Math.abs(effektiveEinspeisungKw(0, akku, c) - 2) < 1e-9); // Erschöpfung 0,2 x 10
});

test('Akku-Freigabe blendet über das Übergangsband stufenlos aus', () => {
  const c = cfg(); // Schwelle 85, Band 5 -> bei 82,5 % genau die Hälfte
  const akku = { verfuegbar: true, socProzent: 82.5, ladeleistungKw: 10, maxLadeleistungKw: 50 };
  assert.strictEqual(akkuFreigabeFaktor(akku, c), 0.5);
  assert.strictEqual(effektiveEinspeisungKw(0, akku, c), -19); // -0,5*40 + 0,5*2
});

test('SoC unbekannt => keine Freigabe (konservativ)', () => {
  const c = cfg();
  const akku = { verfuegbar: true, socProzent: null, ladeleistungKw: 10, maxLadeleistungKw: 50 };
  assert.strictEqual(akkuFreigabeFaktor(akku, c), 0);
  assert.ok(Math.abs(effektiveEinspeisungKw(0, akku, c) - 2) < 1e-9);
});

test('Akku am Anschlag trotz niedrigem SoC => keine Reserve, es wird geregelt', () => {
  const c = cfg();
  const akku = { verfuegbar: true, socProzent: 11, ladeleistungKw: 50, maxLadeleistungKw: 50 };
  assert.strictEqual(akkuReserveKw(akku, c), 0);
  assert.strictEqual(effektiveEinspeisungKw(8, akku, c), 8); // echter Überschuss zählt voll
});

// --- Kurzzeit-Toleranz ---

test('kurzer Überschuss bis Akku-Ladegrenze wird ausgesessen', () => {
  const c = cfg();
  // Akku zieht schon 40 kW (Restreserve 10 kW), fährt aber noch weiter hoch Richtung 50 kW
  const akku = { verfuegbar: true, socProzent: 11, ladeleistungKw: 40, maxLadeleistungKw: 50 };
  // Wolkenlücke: 30 kW Überschuss — mehr als die Restreserve, aber unter der 50-kW-Ladegrenze
  const r1 = reglerSchritt(
    { napEinspeisungKw: 30, pLimitKw: 0, wrSollwertAktuellKw: 100, akku, jetztMs: 1000, ueberschussSeitMs: null },
    c,
  );
  assert.strictEqual(r1.grund, 'Akku-Toleranz');
  assert.strictEqual(r1.wrSollwertKw, 100);        // unverändert
  assert.strictEqual(r1.ueberschussSeitMs, 1000);  // Zeitstempel gesetzt

  // 3 s später immer noch toleriert
  const r2 = reglerSchritt(
    { napEinspeisungKw: 30, pLimitKw: 0, wrSollwertAktuellKw: 100, akku, jetztMs: 4000, ueberschussSeitMs: r1.ueberschussSeitMs },
    c,
  );
  assert.strictEqual(r2.grund, 'Akku-Toleranz');

  // nach 5 s wird gedrosselt
  const r3 = reglerSchritt(
    { napEinspeisungKw: 30, pLimitKw: 0, wrSollwertAktuellKw: 100, akku, jetztMs: 6500, ueberschussSeitMs: r1.ueberschussSeitMs },
    c,
  );
  assert.strictEqual(r3.grund, 'drosseln');
  assert.strictEqual(r3.wrSollwertKw, 95); // Ratenbegrenzung maxSchrittKw
});

test('Überschuss größer als die Akku-Ladegrenze wird sofort gedrosselt', () => {
  const c = cfg();
  const akku = { verfuegbar: true, socProzent: 11, ladeleistungKw: 40, maxLadeleistungKw: 50 };
  const r = reglerSchritt(
    { napEinspeisungKw: 70, pLimitKw: 0, wrSollwertAktuellKw: 100, akku, jetztMs: 1000, ueberschussSeitMs: null },
    c,
  );
  assert.strictEqual(r.grund, 'drosseln');
  assert.strictEqual(r.wrSollwertKw, 95);
});

test('Überschuss-Zeitstempel wird zurückgesetzt, sobald der Überschuss weg ist', () => {
  const c = cfg();
  const akku = { verfuegbar: true, socProzent: 11, ladeleistungKw: 5, maxLadeleistungKw: 50 };
  const r = reglerSchritt(
    { napEinspeisungKw: 0, pLimitKw: 0, wrSollwertAktuellKw: 100, akku, jetztMs: 9000, ueberschussSeitMs: 1000 },
    c,
  );
  assert.strictEqual(r.ueberschussSeitMs, null);
});

test('Toleranz greift nicht bei vollem Akku (SoC über Schwelle)', () => {
  const c = cfg();
  const akku = { verfuegbar: true, socProzent: 92, ladeleistungKw: 40, maxLadeleistungKw: 50 };
  const r = reglerSchritt(
    { napEinspeisungKw: 20, pLimitKw: 0, wrSollwertAktuellKw: 100, akku, jetztMs: 1000, ueberschussSeitMs: null },
    c,
  );
  assert.strictEqual(r.grund, 'drosseln');
});

// --- Annahme-Wache: Reserve gilt nur, solange der Akku sie auch nutzt ---

// Hilfsfunktion: Regler über mehrere Takte laufen lassen (1 s Raster)
function laufen(cfgObj, akkuFn, napFn, takte, startSoll) {
  let soll = startSoll, seit = null, wache = undefined;
  const verlauf = [];
  for (let i = 0; i < takte; i++) {
    const jetzt = (i + 1) * 1000;
    const r = reglerSchritt({
      napEinspeisungKw: napFn(i), pLimitKw: 0, wrSollwertAktuellKw: soll,
      akku: akkuFn(i), jetztMs: jetzt, ueberschussSeitMs: seit, akkuWache: wache,
    }, cfgObj);
    soll = r.wrSollwertKw; seit = r.ueberschussSeitMs; wache = r.akkuWache;
    verlauf.push({ t: jetzt, soll, grund: r.grund, gesperrt: r.akkuSperre.gesperrt, sperrgrund: r.akkuSperre.grund });
  }
  return verlauf;
}

test('Speicher aus: Reserve wird nach der Reaktionszeit gesperrt und es wird gedrosselt', () => {
  const c = cfg();
  const toterAkku = { verfuegbar: true, socProzent: 11, ladeleistungKw: 0, maxLadeleistungKw: 50 };
  const v = laufen(c, () => toterAkku, () => 30, 15, 125);

  // erste 10 s: Reserve zählt noch, Sollwert bleibt oben
  assert.strictEqual(v[9].gesperrt, false);
  assert.strictEqual(v[9].soll, 125);
  // 10 s nach dem ersten Überschuss-Takt greift die Sperre
  assert.strictEqual(v[10].gesperrt, true);
  assert.strictEqual(v[10].sperrgrund, 'Akku nimmt nicht an');
  assert.strictEqual(v[10].grund, 'drosseln');
  // und der Sollwert wird tatsächlich heruntergefahren
  assert.ok(v[14].soll < 110, `erwartet deutlich unter 125, war ${v[14].soll}`);
});

test('Speicher kommt zurück: Sperre löst sich, sobald er wieder lädt', () => {
  const c = cfg();
  const tot   = { verfuegbar: true, socProzent: 11, ladeleistungKw: 0, maxLadeleistungKw: 50 };
  const laedt = { verfuegbar: true, socProzent: 11, ladeleistungKw: 20, maxLadeleistungKw: 50 };
  // 12 Takte tot (Sperre greift), danach lädt er wieder
  const v = laufen(c, (i) => (i < 12 ? tot : laedt), (i) => (i < 12 ? 30 : 0), 16, 125);
  assert.strictEqual(v[11].gesperrt, true);
  assert.strictEqual(v[12].gesperrt, false);   // erster Takt mit Ladung -> frei
  assert.strictEqual(v[12].sperrgrund, null);
  assert.strictEqual(v[15].grund, 'lockern');  // Reserve zählt wieder, PV fährt hoch
});

test('Statusregister melden Störung: Reserve sofort gesperrt, ohne Wartezeit', () => {
  const c = cfg();
  // Werte aus dem echten Intilion-Vorfall: Systemmodus 12, Betriebszustand 13
  const gestoert = { verfuegbar: true, socProzent: 11, ladeleistungKw: 0, maxLadeleistungKw: 50,
                     systemmodus: 12, betriebszustand: 13 };
  assert.strictEqual(akkuBetriebsbereit(gestoert, c), false);
  const r = reglerSchritt(
    { napEinspeisungKw: 30, pLimitKw: 0, wrSollwertAktuellKw: 125, akku: gestoert, jetztMs: 1000 },
    c,
  );
  assert.strictEqual(r.akkuSperre.gesperrt, true);
  assert.strictEqual(r.akkuSperre.grund, 'Akku nicht betriebsbereit');
  assert.strictEqual(r.grund, 'drosseln');
  assert.strictEqual(r.wrSollwertKw, 120);
});

test('Statusregister wieder gut: Sperre wird aufgehoben', () => {
  const c = cfg();
  const gestoert = { verfuegbar: true, socProzent: 11, ladeleistungKw: 0, maxLadeleistungKw: 50,
                     systemmodus: 12, betriebszustand: 13 };
  const gut      = { verfuegbar: true, socProzent: 11, ladeleistungKw: 20, maxLadeleistungKw: 50,
                     systemmodus: 40, betriebszustand: 40 };
  assert.strictEqual(akkuBetriebsbereit(gut, c), true);
  const v = laufen(c, (i) => (i < 5 ? gestoert : gut), (i) => (i < 5 ? 30 : 0), 8, 125);
  assert.strictEqual(v[4].gesperrt, true);
  assert.strictEqual(v[5].gesperrt, false);
});

test('Statusregister nicht gebunden => keine Aussage => betriebsbereit', () => {
  const c = cfg();
  const ohne = { verfuegbar: true, socProzent: 11, ladeleistungKw: 0, maxLadeleistungKw: 50 };
  assert.strictEqual(akkuBetriebsbereit(ohne, c), true); // Verhaltenskriterium sichert diesen Fall
});

test('dauerhaft toter Akku erzeugt keine wiederkehrenden Einspeisefenster', () => {
  const c = cfg({ akkuSperreWiederholungMs: 5000 }); // Probe zum Testen auf 5 s verkürzt
  const tot = { verfuegbar: true, socProzent: 11, ladeleistungKw: 0, maxLadeleistungKw: 50 };
  const v = laufen(c, () => tot, () => 30, 30, 125);
  // Nach der Probe darf höchstens ein einzelner Takt offen sein, dann sofort wieder Sperre
  const offeneTakte = v.slice(10).filter((x) => !x.gesperrt).length;
  assert.ok(offeneTakte <= 3, `zu viele offene Takte nach der Sperre: ${offeneTakte}`);
  assert.strictEqual(v[29].gesperrt, true);
});

test('gesunder Betrieb: kurze Wolkenspitze löst keine Sperre aus', () => {
  const c = cfg();
  const akku = (i) => ({ verfuegbar: true, socProzent: 11,
                         ladeleistungKw: i < 2 ? 0 : 35, maxLadeleistungKw: 50,
                         systemmodus: 40, betriebszustand: 40 });
  // 3 s Überschuss, dann zieht der Akku ihn weg (echtes Feldverhalten 05.09. 08:14)
  const v = laufen(c, akku, (i) => (i < 3 ? 9 : -1), 12, 125);
  assert.ok(v.every((x) => !x.gesperrt), 'keine Sperre erwartet');
  assert.strictEqual(v[11].soll, 125);
});

test('Wache greift auch bei teilweiser Annahme (Akku nimmt zu wenig ab)', () => {
  const c = cfg();
  // Akku lädt zwar 20 kW, aber es bleiben dauerhaft 8 kW echte Einspeisung stehen
  const traege = { verfuegbar: true, socProzent: 11, ladeleistungKw: 20, maxLadeleistungKw: 50 };
  const v = laufen(c, () => traege, () => 8, 15, 125);
  assert.strictEqual(v[10].gesperrt, true);
  assert.ok(v[14].soll < 125);
});

// --- Restdauer-Kriterium: der Akku bleibt bis kurz vor voll ein echter Puffer ---

test('Restdauer aus ladbarer Energie und Ladegrenze', () => {
  const c = cfg();
  // echter Feldwert 06.09. bei SoC 93,9 %: 4 kWh Restkapazitaet, 50 kW Ladegrenze
  const akku = { verfuegbar: true, socProzent: 93.9, ladeleistungKw: 5,
                 maxLadeleistungKw: 50, ladbareEnergieKwh: 4 };
  assert.ok(Math.abs(akkuRestdauerS(akku, c) - 288) < 1e-6);
});

test('SoC 94 % mit 4 kWh Restkapazitaet: voller Puffer statt Ausbremsen', () => {
  // Genau der Fall, der den Akku am Ende ausgebremst hat: SoC weit ueber der alten 85-%-Schwelle,
  // aber physikalisch noch ~5 min lang voll aufnahmefaehig.
  // Betriebseinstellung auf .29: SoC nur noch als Rueckfallebene ueber die letzten 5 %
  const c = cfg({ akkuFreigabeSocProzent: 100, akkuFreigabeUebergangProzent: 5 });
  const akku = { verfuegbar: true, socProzent: 93.9, ladeleistungKw: 5,
                 maxLadeleistungKw: 50, ladbareEnergieKwh: 4 };
  assert.strictEqual(akkuFreigabeFaktor(akku, c), 1);
  assert.strictEqual(effektiveEinspeisungKw(0, akku, c), -45); // Reserve 45 kW wird angerechnet
});

test('Akku fast voll: Freigabe blendet ueber die Restdauer aus', () => {
  const c = cfg(); // Schwelle 15 s, Band 30 s -> voll ab 45 s Restdauer
  const bei = (kwh) => akkuFreigabeFaktor(
    { verfuegbar: true, socProzent: 96, ladeleistungKw: 0, maxLadeleistungKw: 50, ladbareEnergieKwh: kwh }, c);
  assert.strictEqual(bei(50 * 45 / 3600), 1);   // 45 s -> voll
  assert.strictEqual(bei(50 * 30 / 3600), 0.5); // 30 s -> halb
  assert.strictEqual(bei(50 * 15 / 3600), 0);   // 15 s -> aus
  assert.strictEqual(bei(0), 0);                // voll  -> aus
});

test('Restdauer hat Vorrang vor dem SoC, wenn sie vorliegt', () => {
  // Der SoC ist nur ein Proxy. Liegt die echte Restkapazitaet vor, darf der grobe Wert
  // den genauen nicht ueberstimmen — sonst bremst er den Akku am Ende unnoetig aus.
  const c = cfg({ akkuFreigabeSocProzent: 85 });
  const akku = { verfuegbar: true, socProzent: 90, ladeleistungKw: 0,
                 maxLadeleistungKw: 50, ladbareEnergieKwh: 10 };
  assert.strictEqual(akkuFreigabeFaktor(akku, c), 1);
  // Ohne Kapazitaetsregister greift der SoC weiterhin
  const ohne = { verfuegbar: true, socProzent: 90, ladeleistungKw: 0, maxLadeleistungKw: 50 };
  assert.strictEqual(akkuFreigabeFaktor(ohne, c), 0);
});

test('ladbare Energie nicht gebunden: SoC bleibt Rueckfallebene', () => {
  const c = cfg();
  const akku = { verfuegbar: true, socProzent: 50, ladeleistungKw: 10, maxLadeleistungKw: 50 };
  assert.strictEqual(akkuFreigabeFaktor(akku, c), 1);
});

test('weder SoC noch ladbare Energie: keine Freigabe', () => {
  const c = cfg();
  const akku = { verfuegbar: true, ladeleistungKw: 10, maxLadeleistungKw: 50 };
  assert.strictEqual(akkuFreigabeFaktor(akku, c), 0);
});

test('voller Akku wird nicht faelschlich als "nimmt nicht an" gemeldet', () => {
  const c = cfg({ akkuFreigabeSocProzent: 100, akkuFreigabeUebergangProzent: 5 });
  // Feldbild 06.09. 12:48: SoC 100 %, 0 kWh ladbar, 57 kW Einspeisung unter einem 125-kW-Limit
  const voll = { verfuegbar: true, socProzent: 100, ladeleistungKw: 0, maxLadeleistungKw: 50,
                 ladbareEnergieKwh: 0, systemmodus: 40, betriebszustand: 40 };
  assert.strictEqual(akkuFreigabeFaktor(voll, c), 0);
  const v = laufen(c, () => voll, () => 57, 20, 125);
  assert.ok(v.every((x) => !x.gesperrt), 'keine Sperre erwartet, der Akku ist nur voll');
});

// --- Anti-Windup: Sollwert nicht ueber das Dargebot hinauslaufen lassen ---

test('Obergrenze folgt dem Dargebot mit Zuschlag', () => {
  const c = cfg(); // 15 % + 5 kW
  assert.ok(Math.abs(sollwertObergrenzeKw({ dargebotKw: 20, pIstKw: 18 }, c) - 28) < 1e-9);
});

test('Obergrenze geht nie unter die laufende Produktion plus Reserve', () => {
  const c = cfg();
  // Dargebot schaetzt zu niedrig (Wolke ueber dem Fuehler), Anlage produziert real 60 kW
  const g = sollwertObergrenzeKw({ dargebotKw: 10, pIstKw: 60 }, c);
  assert.ok(g >= 60, `Begrenzung darf nie Leistung wegnehmen, war ${g}`);
  assert.ok(Math.abs(g - 74) < 1e-9); // 60*1,15+5
});

test('ohne Strahlungswerte keine Obergrenze', () => {
  const c = cfg();
  assert.strictEqual(sollwertObergrenzeKw({ dargebotKw: null, pIstKw: 18 }, c), 125);
});

test('abschaltbar ueber die Config', () => {
  const c = cfg({ sollwertGrenzeAusDargebot: false });
  assert.strictEqual(sollwertObergrenzeKw({ dargebotKw: 20, pIstKw: 18 }, c), 125);
});

test('Feldfall 06.09.: Sollwert laeuft nicht mehr auf 125 kW hoch', () => {
  const c = cfg();
  // Bedeckt, Nulleinspeisung, Akku voll, Standort bezieht 10 kW -> Regler lockert dauerhaft
  const akku = { verfuegbar: true, socProzent: 99, ladeleistungKw: 0, maxLadeleistungKw: 0,
                 ladbareEnergieKwh: 0, systemmodus: 40, betriebszustand: 40 };
  let soll = 20, seit = null, wache;
  for (let i = 0; i < 60; i++) {
    const r = reglerSchritt({
      napEinspeisungKw: -10, pLimitKw: 0, wrSollwertAktuellKw: soll, akku,
      jetztMs: (i + 1) * 1000, ueberschussSeitMs: seit, akkuWache: wache,
      dargebotKw: 20, pIstKw: 18.3,
    }, c);
    soll = r.wrSollwertKw; seit = r.ueberschussSeitMs; wache = r.akkuWache;
  }
  assert.ok(Math.abs(soll - 28) < 1e-9, `erwartet 28 kW (Dargebot 20 +15 % +5), war ${soll}`);
});

test('Anti-Windup-Grenze zaehlt nicht als Drosselung', () => {
  const c = cfg();
  const akku = { verfuegbar: true, socProzent: 99, ladeleistungKw: 0, maxLadeleistungKw: 0, ladbareEnergieKwh: 0 };
  const r = reglerSchritt({
    napEinspeisungKw: -10, pLimitKw: 0, wrSollwertAktuellKw: 28, akku,
    jetztMs: 1000, dargebotKw: 20, pIstKw: 18.3,
  }, c);
  assert.strictEqual(r.wrSollwertKw, 28); // will hoch, wird von der Obergrenze gehalten
  assert.strictEqual(r.drosselAktiv, false); // sonst meldete P_kann faelschlich das Dargebot
});

test('echte Drosselung wird weiterhin als solche erkannt', () => {
  const c = cfg();
  const akku = { verfuegbar: true, socProzent: 99, ladeleistungKw: 0, maxLadeleistungKw: 0, ladbareEnergieKwh: 0 };
  const r = reglerSchritt({
    napEinspeisungKw: 30, pLimitKw: 0, wrSollwertAktuellKw: 28, akku,
    jetztMs: 1000, dargebotKw: 20, pIstKw: 18.3,
  }, c);
  assert.ok(r.wrSollwertKw < 28);
  assert.strictEqual(r.drosselAktiv, true);
});

// --- Feldfall 06.09. 13:40: Regler drosselte auf 0, waehrend der Akku mit 40 kW lud ---

test('Akku laedt kraeftig und bezieht aus dem Netz: es wird NICHT gedrosselt', () => {
  const c = cfg();
  // Reale Messwerte 13:40:10: Netzknoten bezieht 3,2 kW, Akku laedt 32,8 kW von 50 kW,
  // SoC 97,8 %, noch 1 kWh ladbar. Der Regler fuhr den WR damals von 44 auf 0 kW.
  const akku = { verfuegbar: true, socProzent: 97.8, ladeleistungKw: 32.8,
                 maxLadeleistungKw: 50, ladbareEnergieKwh: 1, systemmodus: 40, betriebszustand: 40 };
  assert.strictEqual(akkuFreigabeFaktor(akku, c), 1); // 72 s Restdauer -> volle Freigabe
  const eff = effektiveEinspeisungKw(-3.2, akku, c);
  assert.ok(eff < -1, `erwartet deutlich negativ (lockern), war ${eff}`);
  const r = reglerSchritt({
    napEinspeisungKw: -3.2, pLimitKw: 0, wrSollwertAktuellKw: 43.8, akku,
    jetztMs: 1000, dargebotKw: 73.9, pIstKw: 58.4,
  }, c);
  assert.strictEqual(r.grund, 'lockern');
  assert.ok(r.wrSollwertKw > 43.8, 'der Sollwert muss steigen, nicht fallen');
});

test('Ueberschuss-Spitze beim Hochfahren des Akkus wird ausgesessen', () => {
  const c = cfg();
  // 13:40:04: nap springt auf 18,6 kW, weil der Akku erst bei 13,9 kW ist und noch hochfaehrt
  const akku = { verfuegbar: true, socProzent: 97.8, ladeleistungKw: 13.9,
                 maxLadeleistungKw: 50, ladbareEnergieKwh: 1, systemmodus: 40, betriebszustand: 40 };
  const r = reglerSchritt({
    napEinspeisungKw: 18.6, pLimitKw: 0, wrSollwertAktuellKw: 58.8, akku,
    jetztMs: 1000, dargebotKw: 74, pIstKw: 63.2,
  }, c);
  assert.notStrictEqual(r.grund, 'drosseln'); // Reserve 36 kW deckt die Spitze
  assert.ok(r.wrSollwertKw >= 58.8);
});

test('wirklich voller Akku: Vorsteuerung greift weiterhin', () => {
  const c = cfg();
  const voll = { verfuegbar: true, socProzent: 100, ladeleistungKw: 30,
                 maxLadeleistungKw: 50, ladbareEnergieKwh: 0 };
  assert.strictEqual(akkuFreigabeFaktor(voll, c), 0);
  // Erschoepfung 1-20/50=0,6 x 30 = 18 -> vorausschauend drosseln, bevor es ins Netz geht
  assert.ok(effektiveEinspeisungKw(0, voll, c) > 1);
});

// --- Dargebot mit bifazialem Zusatzterm ---

test('pDiffusKw = 0 ergibt exakt das fruehere Verhalten', () => {
  const c = cfg({ pInstalliertKw: 129, strahlungReferenzWm2: 1000, pDiffusKw: 0 });
  assert.ok(Math.abs(dargebotKw(600, 800, c) - 700 * 0.129) < 1e-9);
});

test('bifazialer Term wirkt ueber den kleineren Messwert', () => {
  const c = cfg({ pInstalliertKw: 79.1, strahlungReferenzWm2: 1000, pDiffusKw: 57.45, dargebotMaxKw: 0 });
  // Mittel 700, Minimum 600
  const erwartet = 700 * 0.0791 + 600 * 0.05745;
  assert.ok(Math.abs(dargebotKw(600, 800, c) - erwartet) < 1e-9);
});

test('das Modell ist symmetrisch in beiden Dachhaelften', () => {
  const c = cfg({ pInstalliertKw: 79.1, strahlungReferenzWm2: 1000, pDiffusKw: 57.45, dargebotMaxKw: 0 });
  // Genau das kann eine freie Zwei-Sensor-Gewichtung nicht: sie sagte fuer diese
  // beiden spiegelbildlichen Faelle 95 gegen 55 kW voraus.
  assert.strictEqual(dargebotKw(200, 900, c), dargebotKw(900, 200, c));
});

test('bei ausgeglichener Strahlung entspricht es der Summe beider Faktoren', () => {
  const c = cfg({ pInstalliertKw: 79.1, strahlungReferenzWm2: 1000, pDiffusKw: 57.45, dargebotMaxKw: 0 });
  assert.ok(Math.abs(dargebotKw(1000, 1000, c) - (79.1 + 57.45)) < 1e-9);
});

test('Kappung wirkt auch mit dem Zusatzterm', () => {
  const c = cfg({ pInstalliertKw: 79.1, strahlungReferenzWm2: 1000, pDiffusKw: 57.45, dargebotMaxKw: 105 });
  assert.strictEqual(dargebotKw(1000, 1000, c), 105);
});
