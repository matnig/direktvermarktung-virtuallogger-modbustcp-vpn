'use strict';

// Reine Rechenlogik für die Wirtschaftlichkeitsbetrachtung — keine I/O, damit prüfbar.
//
// Grundgedanke: Für die Bewertung eines GRÖSSEREN AKKUS reicht der Lastgang am
// Netzverknüpfungspunkt vollständig aus. Ein zusätzlicher Speicher arbeitet genau
// zwischen den beiden dort gemessenen Größen — er nimmt Einspeisung auf und deckt
// später Bezug. Dafür müssen Erzeugung und Last NICHT getrennt bekannt sein.
//
// Für eine PV-ERWEITERUNG gilt das nicht: zusätzliche Erzeugung braucht ein Profil.
// Liegt keines vor, wird das Einspeiseprofil als Form herangezogen; das ist eine
// Näherung und wird im Ergebnis als Annahme ausgewiesen.

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ── Speichersimulation über den Lastgang ─────────────────────────────
// punkte: [[tsMs, bezugKwh, einspeisungKwh], ...] je Messperiode
// Rückgabe: Energiemengen nach Einsatz des Speichers.
function simuliereSpeicher(punkte, {
  kapazitaetKwh = 0,
  leistungKw = 0,
  wirkungsgrad = 0.92,       // Round-Trip
  entladetiefe = 0.9,        // nutzbarer Anteil der Nennkapazität
  messperiodeMin = 15,
  startSocAnteil = 0,        // LEER starten
  nullpreis = null,          // Bool je Punkt: gilt hier ein Einspeiseerlös von ~0?
} = {}) {
  const nutzbar = Math.max(0, kapazitaetKwh * entladetiefe);
  const proSchritt = leistungKw * (messperiodeMin / 60);
  const eta = Math.sqrt(clamp(wirkungsgrad, 0.1, 1)); // je Richtung
  // Bewusst leer: ein halb voll startender Speicher darf Energie abgeben, die er nie
  // aufgenommen hat. Über ein Jahr faellt das kaum ins Gewicht, es beschoenigt aber
  // kurze Betrachtungszeitraeume und macht die Bilanz unpruefbar (entladen > geladen).
  let soc = nutzbar * clamp(startSocAnteil, 0, 1);

  let bezugNeu = 0, einspeisungNeu = 0, geladen = 0, entladen = 0, vollzyklen = 0;
  let bezugAlt = 0, einspeisungAlt = 0;
  // Einspeisung getrennt fuehren, die zu Zeiten mit wertlosem Netzpreis anfaellt:
  // was dort nicht mehr eingespeist wird, kostet auch keinen entgangenen Erloes.
  let einspeisungAltNull = 0, einspeisungNeuNull = 0;

  for (let i = 0; i < punkte.length; i++) {
    const p = punkte[i];
    const istNull = nullpreis ? Boolean(nullpreis[i]) : false;
    let bez = p[1] || 0;
    let ein = p[2] || 0;
    bezugAlt += bez; einspeisungAlt += ein;
    if (istNull) einspeisungAltNull += ein;

    if (nutzbar > 0 && proSchritt > 0) {
      if (ein > 0) {
        // Überschuss einlagern (Ladeverluste gehen zulasten des Speichers)
        const nimm = Math.min(ein, proSchritt, (nutzbar - soc) / eta);
        if (nimm > 0) { soc += nimm * eta; geladen += nimm; ein -= nimm; }
      }
      if (bez > 0) {
        const gib = Math.min(bez, proSchritt, soc * eta);
        if (gib > 0) { soc -= gib / eta; entladen += gib; bez -= gib; }
      }
    }
    bezugNeu += bez; einspeisungNeu += ein;
    if (istNull) einspeisungNeuNull += ein;
  }
  if (nutzbar > 0) vollzyklen = entladen / nutzbar;

  return {
    bezugAltKwh: bezugAlt, einspeisungAltKwh: einspeisungAlt,
    bezugNeuKwh: bezugNeu, einspeisungNeuKwh: einspeisungNeu,
    einspeisungAltNullKwh: einspeisungAltNull, einspeisungNeuNullKwh: einspeisungNeuNull,
    geladenKwh: geladen, entladenKwh: entladen,
    verschobenKwh: entladen,                       // ersetzter Netzbezug
    wenigerEinspeisungKwh: einspeisungAlt - einspeisungNeu,
    vollzyklen,
  };
}

// ── PV-Erweiterung ───────────────────────────────────────────────────
// Zusätzliche Erzeugung wird auf den Lastgang aufgeschlagen: sie deckt zuerst
// verbleibenden Bezug, der Rest erhöht die Einspeisung. `profil` gibt die Form
// vor (je Messperiode, beliebig skaliert), `mehrKwh` die Jahresmenge.
function ergaenzePv(punkte, profil, mehrKwh) {
  if (!(mehrKwh > 0) || !profil || !profil.length) return punkte;
  const summe = profil.reduce((a, b) => a + b, 0);
  if (!(summe > 0)) return punkte;
  const faktor = mehrKwh / summe;
  return punkte.map((p, i) => {
    const zusatz = (profil[i] || 0) * faktor;
    let bez = p[1] || 0;
    let ein = p[2] || 0;
    const deckung = Math.min(bez, zusatz);
    bez -= deckung;
    ein += zusatz - deckung;
    return [p[0], bez, ein];
  });
}

// Form der zusätzlichen Erzeugung. Bevorzugt ein echtes Erzeugungsprofil;
// ersatzweise das Einspeiseprofil (Näherung, wird als Annahme gemeldet).
function erzeugungsprofil(punkte, erzeugung) {
  if (Array.isArray(erzeugung) && erzeugung.length === punkte.length) {
    return { profil: erzeugung, naeherung: false };
  }
  return { profil: punkte.map((p) => p[2] || 0), naeherung: true };
}

// ── Wirtschaftlichkeit ───────────────────────────────────────────────
// Erlösseiten:
//   - vermiedener Netzbezug  -> bezugspreisEurProKwh
//   - Lieferung an Kunden    -> ertragDirektKundeEurProKwh
//   - Direktvermarktung      -> ertragDirektvermarktungEurProKwh
// `anteilDirektKunde` steuert, welcher Teil der Einspeisung an Kunden geht.
function bewerte(sim, preise = {}, invest = {}) {
  const p = {
    bezugspreisEurProKwh: 0,
    ertragDirektKundeEurProKwh: 0,
    ertragDirektvermarktungEurProKwh: 0,
    anteilDirektKundeProzent: 0,
    nullpreisVerguetungEurProKwh: 0,   // Erlös in Zeiten mit wertlosem Netzpreis
    ...preise,
  };
  const i = {
    akkuNeuKwh: 0, akkuNeuKostenEurProKwh: 0, akkuVerkaufserloesEur: 0,
    pvErweiterungKwp: 0, pvKostenEurProKwp: 0, sonstigeKostenEur: 0,
    betriebskostenProzentProJahr: 1.5, betrachtungsjahreJahre: 15,
    kalkulationszinsProzent: 4, jahresfaktor: 1,
    ...invest,
  };

  const anteil = clamp(p.anteilDirektKundeProzent / 100, 0, 1);
  const erloesJeEinspeisung = anteil * p.ertragDirektKundeEurProKwh
    + (1 - anteil) * p.ertragDirektvermarktungEurProKwh;

  // Der Speicher verlagert Einspeisung in Eigenverbrauch: gewonnen wird die
  // Differenz zwischen vermiedenem Bezug und dem entgangenen Einspeiseerlös.
  //
  // Entscheidend ist dabei, WANN die verlagerte Einspeisung angefallen waere. An
  // Sommertagen mit hoher Erzeugung faellt der Boersenpreis auf null — was dort nicht
  // mehr eingespeist wird, kostet keinen entgangenen Erloes, die verschobene
  // Kilowattstunde ist dann den vollen Eigenverbrauchswert wert.
  const wenigerNull = Math.max(0, (sim.einspeisungAltNullKwh || 0) - (sim.einspeisungNeuNullKwh || 0));
  const wenigerNormal = Math.max(0, sim.wenigerEinspeisungKwh - wenigerNull);
  const gewinnVerschiebung = sim.verschobenKwh * p.bezugspreisEurProKwh
    - wenigerNormal * erloesJeEinspeisung
    - wenigerNull * p.nullpreisVerguetungEurProKwh;

  // Zusätzliche PV erhöht beides: weniger Bezug und mehr Einspeisung.
  const mehrEigenverbrauch = Math.max(0, sim.bezugAltKwh - sim.bezugNeuKwh - sim.verschobenKwh);
  const mehrEinspeisung = Math.max(0, sim.einspeisungNeuKwh - sim.einspeisungAltKwh + sim.wenigerEinspeisungKwh);
  const gewinnPv = mehrEigenverbrauch * p.bezugspreisEurProKwh + mehrEinspeisung * erloesJeEinspeisung;

  const jahresertragEur = (gewinnVerschiebung + gewinnPv) * i.jahresfaktor;

  const investAkku = i.akkuNeuKwh * i.akkuNeuKostenEurProKwh;
  const investPv = i.pvErweiterungKwp * i.pvKostenEurProKwp;
  const investBrutto = investAkku + investPv + i.sonstigeKostenEur;
  const investNetto = investBrutto - i.akkuVerkaufserloesEur;

  const betriebskostenEur = investBrutto * (i.betriebskostenProzentProJahr / 100);
  const nettoJahresErgebnis = jahresertragEur - betriebskostenEur;

  const amortisationJahre = nettoJahresErgebnis > 0 ? investNetto / nettoJahresErgebnis : null;

  // Barwert über die Betrachtungsdauer
  const z = i.kalkulationszinsProzent / 100;
  let barwert = -investNetto;
  for (let j = 1; j <= i.betrachtungsjahreJahre; j++) {
    barwert += nettoJahresErgebnis / Math.pow(1 + z, j);
  }

  return {
    erloesJeEinspeisungEurProKwh: erloesJeEinspeisung,
    wenigerEinspeisungNormalKwh: wenigerNormal,
    wenigerEinspeisungNullpreisKwh: wenigerNull,
    gewinnVerschiebungEur: gewinnVerschiebung,
    gewinnPvEur: gewinnPv,
    jahresertragEur,
    betriebskostenEur,
    nettoJahresErgebnisEur: nettoJahresErgebnis,
    investAkkuEur: investAkku,
    investPvEur: investPv,
    investBruttoEur: investBrutto,
    investNettoEur: investNetto,
    amortisationJahre,
    barwertEur: barwert,
    renditeProzent: investNetto > 0 ? (nettoJahresErgebnis / investNetto) * 100 : null,
  };
}

module.exports = { simuliereSpeicher, ergaenzePv, erzeugungsprofil, bewerte, clamp };
