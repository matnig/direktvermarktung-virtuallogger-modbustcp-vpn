// Reine Rechenlogik für das Einspeisemanagement — KEINE I/O, damit unit-testbar.
//
// Vorzeichen-Konventionen (WICHTIG):
//   napEinspeisungKw   : positiv = Einspeisung INS Netz. (= -(Intilion-Summe), da Intilion neg=Einspeisung)
//   akku.ladeleistungKw: positiv = Akku LÄDT (nimmt auf).  (= -(Intilion 5040), da dort neg=laden)
//
// Der Regler ist ein EINSEITIGER BEGRENZER: PV nur drosseln, wenn die (ggf. vorausschauend
// korrigierte) Netzeinspeisung P_limit überschreitet. Darunter PV wieder hochfahren bis
// wrSollwertMaxKw. Der Akku macht selbst Nulleinspeisung — wir kämpfen nicht dagegen.

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// --- 1) Netzbetreiber-Stufe aus den 3 Meldekontakten (LOGO I1/I2/I3) ---
// kein Kontakt aktiv = 100 %. Bei mehreren aktiven gewinnt die RESTRIKTIVSTE (niedrigste %).
function netzbetreiberStufe(kontakte, config) {
  const k = config.kontaktStufeProzent || { i1: 60, i2: 30, i3: 0 };
  const aktive = [];
  if (kontakte && kontakte.i1) aktive.push(Number(k.i1));
  if (kontakte && kontakte.i2) aktive.push(Number(k.i2));
  if (kontakte && kontakte.i3) aktive.push(Number(k.i3));
  const prozent = aktive.length ? Math.min(...aktive) : 100;
  const kw = (prozent / 100) * Number(config.pRef100Kw);
  return { prozent, kw };
}

// --- 2) min-Select: der niedrigere Drosselwert gewinnt ---
// Werte in kW; null/undefined = "nicht vorhanden" und wird ignoriert. Beide fehlen -> null.
function pLimitKw({ direktvermarkterKw, netzbetreiberKw }) {
  const vals = [direktvermarkterKw, netzbetreiberKw].filter(isNum);
  if (!vals.length) return null;
  return Math.min(...vals);
}

// --- 3) Akku-Vorsteuerung: effektive (vorausschauende) Netzeinspeisung ---
// Wenn der Akku nahe an seiner Ladegrenze ist, fällt seine Pufferwirkung bald weg -> die aktuell
// aufgenommene Leistung käme dann zusätzlich ins Netz. Das rechnen wir gewichtet vorweg.
function effektiveEinspeisungKw(napEinspeisungKw, akku, config) {
  if (!config.akkuVorsteuerung || !akku || akku.verfuegbar === false) return napEinspeisungKw;
  const maxLade = Math.max(0, Number(akku.maxLadeleistungKw) || 0);
  const lade    = Math.max(0, Number(akku.ladeleistungKw) || 0);
  if (maxLade <= 0) return napEinspeisungKw + lade; // am Anschlag: volle aufgenommene Leistung droht
  const reserve      = Math.max(0, maxLade - lade);
  const erschoepfung = clamp(1 - reserve / maxLade, 0, 1); // 0=viel Reserve, 1=am Anschlag
  return napEinspeisungKw + erschoepfung * lade;
}

// --- 4) Ein Regelschritt: neuer WR-Sollwert (Leistungsgrenze kW) ---
// Gibt {wrSollwertKw, drosselAktiv, abweichungKw, effektiveEinspeisungKw, grund} zurück.
// pLimitKw === null => kein bekanntes Limit -> Regler gibt null zurück (Caller entscheidet Failsafe).
function reglerSchritt({ napEinspeisungKw, pLimitKw: limit, wrSollwertAktuellKw, akku }, config) {
  if (!isNum(limit)) {
    return { wrSollwertKw: null, drosselAktiv: false, abweichungKw: null, effektiveEinspeisungKw: null, grund: 'kein P_limit' };
  }
  const start = isNum(wrSollwertAktuellKw) ? wrSollwertAktuellKw : config.wrSollwertMaxKw;
  const effektiv = effektiveEinspeisungKw(napEinspeisungKw, akku, config);
  const abweichung = effektiv - limit; // >0: über Limit
  const totband = Number(config.totbandKw) || 0;
  const kp = Number(config.reglerVerstaerkung) || 0;

  let ziel = start;
  if (abweichung > totband) {
    ziel = start - kp * (abweichung - totband);          // über Limit -> drosseln
  } else if (abweichung < -totband) {
    ziel = start + kp * (-abweichung - totband);         // unter Limit -> lockern (hochfahren)
  }

  const maxSchritt = Number(config.maxSchrittKw) || Infinity;
  const delta = clamp(ziel - start, -maxSchritt, maxSchritt);          // Ratenbegrenzung
  const wrSollwertKw = clamp(start + delta, config.wrSollwertMinKw, config.wrSollwertMaxKw);

  return {
    wrSollwertKw,
    drosselAktiv: wrSollwertKw < config.wrSollwertMaxKw - 1e-9,
    abweichungKw: abweichung,
    effektiveEinspeisungKw: effektiv,
    grund: abweichung > totband ? 'drosseln' : (abweichung < -totband ? 'lockern' : 'halten'),
  };
}

// --- 5) Dargebot (theoretisch mögliche Leistung) aus Strahlung Ost/West ---
// Lineares Modell: P_kann = (mittlere Strahlung / Referenzstrahlung) × installierte Leistung.
// GESCHÄTZT — bei realen Tagesdaten kalibrieren. Gibt null, wenn keine Strahlung vorliegt.
function dargebotKw(strahlungOstWm2, strahlungWestWm2, config) {
  const ref = Number(config.strahlungReferenzWm2) || 1000;
  const pInst = Number(config.pInstalliertKw) || 0;
  const vals = [strahlungOstWm2, strahlungWestWm2].filter(isNum);
  if (!vals.length || ref <= 0) return null;
  const mittel = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.max(0, (mittel / ref) * pInst);
}

// --- 6) P_kann-Auswahl: ohne Drosselung = Ist-Leistung, mit Drosselung = Dargebot ---
// (Ohne Drossel ist Ist = Kann, also den genauen Messwert nehmen; bei Drosselung liegt Ist unter Kann.)
function pKannKw({ drosselAktiv, pIstKw, dargebotKw: dg }) {
  if (!drosselAktiv && isNum(pIstKw)) return Math.max(0, pIstKw);
  return isNum(dg) ? dg : null;
}

module.exports = {
  clamp,
  netzbetreiberStufe,
  pLimitKw,
  effektiveEinspeisungKw,
  reglerSchritt,
  dargebotKw,
  pKannKw,
};
