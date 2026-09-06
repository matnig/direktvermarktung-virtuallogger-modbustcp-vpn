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

  // Zusätzlich verschiebbare Erzeugung (BHKW o. ä.): Sie deckt heute Last, die sonst
  // aus dem Netz käme. Ein größerer Speicher könnte sie ersetzen, also zählt sie als
  // zusätzlicher Bedarf, den der Speicher bedienen kann.
  let zusatzlastKwh = 0;
  if (cfg.zusatzlastId) {
    const zl = lastgangService.getPunkte(cfg.zusatzlastId);
    if (zl.length) {
      const schrittMs = (meta.messperiodeMin || 15) * 60000;
      const eimer = new Map();
      for (const [ts, wert] of zl) {
        const k = Math.floor(ts / schrittMs) * schrittMs;
        eimer.set(k, (eimer.get(k) || 0) + (wert || 0));
      }
      punkte = punkte.map((p) => {
        const k = Math.floor(p[0] / schrittMs) * schrittMs;
        const zu = eimer.get(k) || 0;
        zusatzlastKwh += zu;
        return [p[0], (p[1] || 0) + zu, p[2] || 0];
      });
      annahmen.push(`Zusätzlich verschiebbare Erzeugung von ${zusatzlastKwh.toFixed(0)} kWh `
        + 'wurde dem Bedarf zugeschlagen. Der Wert einer verschobenen Kilowattstunde ist der '
        + 'mengengewichtete Mittelwert aus Bezugspreis und Erzeugungskosten dieser Anlage.');
    }
  }

  const zusatzKapazitaet = Math.max(0, cfg.akkuNeuKwh - cfg.akkuBestandKwh);
  if (cfg.akkuNeuKwh > 0 && zusatzKapazitaet === 0) {
    annahmen.push('Der neue Speicher ist nicht größer als der Bestand — es wird keine '
      + 'zusätzliche Verschiebung gerechnet.');
  }

  // Zeiten ohne Einspeiseerlös bestimmen: Tage im gewählten Fenster, deren Einspeisung
  // über der Schwelle liegt. Bewusst tageweise — der Börsenpreis bricht an ganzen
  // Strahlungstagen ein, nicht an einzelnen Viertelstunden.
  let nullpreis = null;
  let nullpreisTage = 0;
  if (cfg.nullpreisAktiv) {
    const tagesSumme = new Map();
    const tagOf = (ts) => new Date(ts).toISOString().slice(0, 10);
    for (const pt of punkte) {
      const k = tagOf(pt[0]);
      tagesSumme.set(k, (tagesSumme.get(k) || 0) + (pt[2] || 0));
    }
    const imFenster = (k) => {
      const md = k.slice(5);
      const von = String(cfg.nullpreisVonTag || '01-01');
      const bis = String(cfg.nullpreisBisTag || '12-31');
      return von <= bis ? (md >= von && md <= bis) : (md >= von || md <= bis);
    };
    const schwelle = Number(cfg.nullpreisAbTagesEinspeisungKwh) || 0;
    const betroffen = new Set();
    for (const [k, summe] of tagesSumme) {
      if (imFenster(k) && summe >= schwelle) betroffen.add(k);
    }
    nullpreisTage = betroffen.size;
    nullpreis = punkte.map((pt) => betroffen.has(tagOf(pt[0])));
    annahmen.push(`An ${nullpreisTage} Tagen im Fenster ${cfg.nullpreisVonTag} bis `
      + `${cfg.nullpreisBisTag} mit mehr als ${schwelle} kWh Einspeisung wird mit `
      + `${cfg.nullpreisVerguetungEurProKwh} €/kWh Einspeiseerlös gerechnet.`);
  }

  const sim = logik.simuliereSpeicher(punkte, {
    kapazitaetKwh: zusatzKapazitaet,
    leistungKw: cfg.akkuNeuLeistungKw,
    wirkungsgrad: cfg.akkuWirkungsgrad,
    entladetiefe: cfg.akkuEntladetiefe,
    messperiodeMin: meta.messperiodeMin || 15,
    nullpreis,
  });

  // Mengengewichteter Wert einer verdrängten Kilowattstunde
  const bedarfGesamt = sim.bezugAltKwh || 1;
  const anteilZusatz = Math.min(1, zusatzlastKwh / bedarfGesamt);
  const wertVerdraengt = anteilZusatz * cfg.zusatzlastKostenEurProKwh
    + (1 - anteilZusatz) * cfg.bezugspreisEurProKwh;

  const wirtschaft = logik.bewerte(sim, {
    bezugspreisEurProKwh: wertVerdraengt,
    ertragDirektKundeEurProKwh: cfg.ertragDirektKundeEurProKwh,
    ertragDirektvermarktungEurProKwh: cfg.ertragDirektvermarktungEurProKwh,
    anteilDirektKundeProzent: cfg.anteilDirektKundeProzent,
    nullpreisVerguetungEurProKwh: cfg.nullpreisVerguetungEurProKwh,
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
    zusatzlastKwh,
    wertVerdraengtEurProKwh: wertVerdraengt,
    nullpreisTage,
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
