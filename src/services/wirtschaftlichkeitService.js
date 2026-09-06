'use strict';

const { readCollection, writeCollection } = require('../persistence/jsonStore');
const WirtschaftlichkeitConfig = require('../domain/WirtschaftlichkeitConfig');
const lastgangService = require('./lastgangService');
const logik = require('./wirtschaftlichkeitLogik');

const COLLECTION = 'wirtschaftlichkeit';

function createDefaultConfig() {
  const ts = new Date().toISOString();
  return new WirtschaftlichkeitConfig({ createdAt: ts, updatedAt: ts });
}

function getConfig() {
  const [stored] = readCollection(COLLECTION, [createDefaultConfig()]);
  return new WirtschaftlichkeitConfig(stored);
}

function updateConfig(payload = {}) {
  const current = getConfig();
  const next = new WirtschaftlichkeitConfig({
    ...current, ...payload, createdAt: current.createdAt, updatedAt: new Date().toISOString(),
  });
  writeCollection(COLLECTION, [next]);
  return next;
}

// Rechnet ein Szenario gegen einen importierten Lastgang.
//
// WICHTIGE ANNAHME: Der importierte Lastgang ist am Netzverknüpfungspunkt gemessen und
// enthält bereits die Wirkung des BESTEHENDEN Speichers. Gerechnet wird deshalb die
// ZUSÄTZLICHE Kapazität (neu minus Bestand) auf diesen Lastgang — das ist genau der
// Zugewinn des Umbaus. Der Erlös aus dem Verkauf des Bestandsspeichers mindert die
// Investition, seine bereits erbrachte Verschiebung bleibt im Lastgang enthalten.
function rechne(ueberschreibungen = {}) {
  const cfg = new WirtschaftlichkeitConfig({ ...getConfig(), ...ueberschreibungen });
  const meta = lastgangService.list().find((m) => m.id === cfg.lastgangId)
    || lastgangService.list()[0];
  if (!meta) return { fehler: 'Kein Lastgang importiert' };

  let punkte = lastgangService.getPunkte(meta.id);
  if (!punkte.length) return { fehler: 'Lastgang enthält keine Daten' };

  const annahmen = [];
  const tage = punkte.length * (meta.messperiodeMin || 15) / 1440;
  const jahresfaktor = tage > 0 ? 365 / tage : 1;
  if (tage < 360) {
    annahmen.push(`Der Lastgang deckt ${tage.toFixed(0)} Tage ab; Jahreswerte sind mit `
      + `${jahresfaktor.toFixed(2)} hochgerechnet und tragen die Saisonalität dieses Ausschnitts.`);
  }

  // PV-Erweiterung zuerst: sie verändert den Lastgang, auf dem der Speicher arbeitet.
  if (cfg.pvErweiterungKwp > 0) {
    const { profil, naeherung } = logik.erzeugungsprofil(punkte, null);
    const mehrKwh = cfg.pvErweiterungKwp * cfg.spezifischerErtragKwhProKwp / jahresfaktor;
    punkte = logik.ergaenzePv(punkte, profil, mehrKwh);
    annahmen.push(naeherung
      ? 'Für die zusätzliche PV wurde das gemessene Einspeiseprofil als Form verwendet — '
        + 'eine Näherung. Für belastbare Zahlen einen echten Erzeugungs-Lastgang importieren.'
      : 'Zusätzliche PV anhand des importierten Erzeugungsprofils skaliert.');
  }

  const zusatzKapazitaet = Math.max(0, cfg.akkuNeuKwh - cfg.akkuBestandKwh);
  if (cfg.akkuNeuKwh > 0 && zusatzKapazitaet === 0) {
    annahmen.push('Der neue Speicher ist nicht größer als der Bestand — es wird keine '
      + 'zusätzliche Verschiebung gerechnet.');
  }

  const sim = logik.simuliereSpeicher(punkte, {
    kapazitaetKwh: zusatzKapazitaet,
    leistungKw: cfg.akkuNeuLeistungKw,
    wirkungsgrad: cfg.akkuWirkungsgrad,
    entladetiefe: cfg.akkuEntladetiefe,
    messperiodeMin: meta.messperiodeMin || 15,
  });

  const wirtschaft = logik.bewerte(sim, {
    bezugspreisEurProKwh: cfg.bezugspreisEurProKwh,
    ertragDirektKundeEurProKwh: cfg.ertragDirektKundeEurProKwh,
    ertragDirektvermarktungEurProKwh: cfg.ertragDirektvermarktungEurProKwh,
    anteilDirektKundeProzent: cfg.anteilDirektKundeProzent,
  }, {
    akkuNeuKwh: cfg.akkuNeuKwh,
    akkuNeuKostenEurProKwh: cfg.akkuNeuKostenEurProKwh,
    akkuVerkaufserloesEur: cfg.akkuVerkaufserloesEur,
    pvErweiterungKwp: cfg.pvErweiterungKwp,
    pvKostenEurProKwp: cfg.pvKostenEurProKwp,
    sonstigeKostenEur: cfg.sonstigeKostenEur,
    betriebskostenProzentProJahr: cfg.betriebskostenProzentProJahr,
    betrachtungsjahreJahre: cfg.betrachtungsjahreJahre,
    kalkulationszinsProzent: cfg.kalkulationszinsProzent,
    jahresfaktor,
  });

  return {
    lastgang: { id: meta.id, name: meta.name, von: meta.von, bis: meta.bis, tage },
    jahresfaktor,
    zusatzKapazitaetKwh: zusatzKapazitaet,
    energie: sim,
    wirtschaft,
    annahmen,
    konfiguration: cfg,
  };
}

// Reihe von Varianten für den Vergleich (Speichergrößen).
function vergleich(groessen = [], ueberschreibungen = {}) {
  return groessen.map((kwh) => {
    const r = rechne({ ...ueberschreibungen, akkuNeuKwh: kwh });
    if (r.fehler) return { akkuNeuKwh: kwh, fehler: r.fehler };
    return {
      akkuNeuKwh: kwh,
      verschobenKwh: r.energie.verschobenKwh,
      verschobenKwhProJahr: r.energie.verschobenKwh * r.jahresfaktor,
      vollzyklenProJahr: r.energie.vollzyklen * r.jahresfaktor,
      investNettoEur: r.wirtschaft.investNettoEur,
      nettoJahresErgebnisEur: r.wirtschaft.nettoJahresErgebnisEur,
      amortisationJahre: r.wirtschaft.amortisationJahre,
      barwertEur: r.wirtschaft.barwertEur,
    };
  });
}

module.exports = { COLLECTION, createDefaultConfig, getConfig, updateConfig, rechne, vergleich };
