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

// --- 3) Akku-Bilanz: effektive (vorausschauende) Netzeinspeisung ---
// Zwei gegenläufige Effekte, über den SoC stufenlos überblendet:
//   a) FREIGABE (SoC deutlich unter akkuFreigabeSocProzent): die freie Ladereserve des Akkus ist
//      echte Aufnahmefähigkeit. Überschuss in dieser Höhe landet nicht im Netz, sondern im Akku,
//      sobald dessen eigene Nulleinspeisungsregelung hochgefahren ist -> NICHT drosseln, sondern
//      die PV weiter hochfahren lassen.
//   b) VORSTEUERUNG (SoC nahe/über der Schwelle): der Akku sättigt bald, seine aufgenommene
//      Leistung käme dann zusätzlich ins Netz -> gewichtet vorwegnehmen (bisheriges Verhalten).
// SoC unbekannt => Freigabe 0 => rein konservative Vorsteuerung wie bisher.

// Obergrenze der Akku-Ladeleistung: Live-Wert (Register 5027) und projektierter Wert, das Kleinere.
function akkuMaxLadeGrenzeKw(akku, config) {
  const live = Math.max(0, Number(akku && akku.maxLadeleistungKw) || 0);
  const projektiert = Number(config && config.akkuMaxLadeleistungKw);
  if (Number.isFinite(projektiert) && projektiert > 0) {
    return live > 0 ? Math.min(live, projektiert) : projektiert;
  }
  return live;
}

// Noch freie Ladeleistung des Akkus in kW (was er zusätzlich sofort aufnehmen könnte).
function akkuReserveKw(akku, config) {
  const lade = Math.max(0, Number(akku && akku.ladeleistungKw) || 0);
  return Math.max(0, akkuMaxLadeGrenzeKw(akku, config) - lade);
}

// 1 = Akku darf voll als Puffer gerechnet werden, 0 = keine Freigabe (nur Vorsteuerung).
// Linearer Übergang über akkuFreigabeUebergangProzent unterhalb der Schwelle (kein Sprung).
function akkuFreigabeFaktor(akku, config) {
  if (!akku || akku.verfuegbar === false) return 0;
  const schwelle = Number(config && config.akkuFreigabeSocProzent);
  // SoC muss echt vorliegen — null/undefined NICHT als 0 lesen, sonst gäbe ein fehlendes
  // SoC-Register volle Freigabe statt der sicheren konservativen Vorsteuerung.
  if (akku.socProzent === null || akku.socProzent === undefined) return 0;
  const soc = Number(akku.socProzent);
  if (!Number.isFinite(schwelle) || !Number.isFinite(soc)) return 0;
  const band = Math.max(0, Number(config && config.akkuFreigabeUebergangProzent) || 0);
  if (band <= 0) return soc < schwelle ? 1 : 0;
  return clamp((schwelle - soc) / band, 0, 1);
}

function effektiveEinspeisungKw(napEinspeisungKw, akku, config) {
  if (!config.akkuVorsteuerung || !akku || akku.verfuegbar === false) return napEinspeisungKw;
  const maxLade = Math.max(0, Number(akku.maxLadeleistungKw) || 0);
  const lade    = Math.max(0, Number(akku.ladeleistungKw) || 0);

  // (b) bisherige Vorsteuerung
  let vorsteuerung;
  if (maxLade <= 0) {
    vorsteuerung = lade;                                   // am Anschlag: volle Leistung droht
  } else {
    const reserve      = Math.max(0, maxLade - lade);
    const erschoepfung = clamp(1 - reserve / maxLade, 0, 1); // 0=viel Reserve, 1=am Anschlag
    vorsteuerung = erschoepfung * lade;
  }

  // (a) Freigabe der noch nutzbaren Ladereserve
  const f = akkuFreigabeFaktor(akku, config);
  const rf = Number.isFinite(Number(config.akkuReserveFaktor))
    ? clamp(Number(config.akkuReserveFaktor), 0, 1)
    : 1;
  const puffer = akkuReserveKw(akku, config) * rf;

  return napEinspeisungKw - f * puffer + (1 - f) * vorsteuerung;
}

// --- 4) Ein Regelschritt: neuer WR-Sollwert (Leistungsgrenze kW) ---
// Gibt {wrSollwertKw, drosselAktiv, abweichungKw, effektiveEinspeisungKw, grund, ueberschussSeitMs}
// zurück. pLimitKw === null => kein bekanntes Limit -> null (Caller entscheidet Failsafe).
//
// KURZZEIT-TOLERANZ: Solange der Akku noch nicht auf seine maximale Ladeleistung hochgefahren ist
// und der SoC unter der Freigabeschwelle liegt, wird ein Netzüberschuss bis zu dieser maximalen
// Ladeleistung für ueberschussToleranzMs ausgesessen statt sofort gedrosselt — der Akku zieht ihn
// binnen Sekunden selbst weg. Erst wenn der Überschuss länger steht, größer als die Akku-Ladegrenze
// ist oder der Akku voll/nicht verfügbar ist, greift der Regler ein.
// Zeitführung ist zustandslos: der Caller reicht jetztMs + den letzten ueberschussSeitMs herein.
function reglerSchritt({ napEinspeisungKw, pLimitKw: limit, wrSollwertAktuellKw, akku, jetztMs, ueberschussSeitMs }, config) {
  if (!isNum(limit)) {
    return {
      wrSollwertKw: null, drosselAktiv: false, abweichungKw: null,
      effektiveEinspeisungKw: null, grund: 'kein P_limit', ueberschussSeitMs: null,
    };
  }
  const start = isNum(wrSollwertAktuellKw) ? wrSollwertAktuellKw : config.wrSollwertMaxKw;
  const effektiv = effektiveEinspeisungKw(napEinspeisungKw, akku, config);
  const abweichung = effektiv - limit; // >0: über Limit
  const totband = Number(config.totbandKw) || 0;
  const kp = Number(config.reglerVerstaerkung) || 0;

  // --- Überschuss-Zeitstempel führen (null = aktuell kein Überschuss) ---
  // null/undefined dürfen NICHT über Number() zu 0 werden (0 wäre ein gültiger, uralter Zeitstempel).
  const jetzt = isNum(jetztMs) ? jetztMs : null;
  let seit = isNum(ueberschussSeitMs) ? ueberschussSeitMs : null;
  if (abweichung > totband) {
    if (seit == null) seit = jetzt;
  } else {
    seit = null;
  }

  // --- Kurzzeit-Toleranz prüfen ---
  let toleriert = false;
  if (abweichung > totband) {
    const toleranzMs = Math.max(0, Number(config.ueberschussToleranzMs) || 0);
    const ladegrenze = akkuMaxLadeGrenzeKw(akku, config);
    const rohUeberschuss = isNum(napEinspeisungKw) ? napEinspeisungKw - limit : abweichung;
    const akkuKannNoch = akkuFreigabeFaktor(akku, config) > 0 && akkuReserveKw(akku, config) > 0;
    toleriert = toleranzMs > 0
      && jetzt != null && seit != null
      && (jetzt - seit) < toleranzMs
      && akkuKannNoch
      && rohUeberschuss <= ladegrenze;
  }

  let ziel = start;
  if (abweichung > totband && !toleriert) {
    ziel = start - kp * (abweichung - totband);          // über Limit -> drosseln
  } else if (abweichung < -totband) {
    ziel = start + kp * (-abweichung - totband);         // unter Limit -> lockern (hochfahren)
  }

  const maxSchritt = Number(config.maxSchrittKw) || Infinity;
  const delta = clamp(ziel - start, -maxSchritt, maxSchritt);          // Ratenbegrenzung
  const wrSollwertKw = clamp(start + delta, config.wrSollwertMinKw, config.wrSollwertMaxKw);

  let grund;
  if (abweichung > totband) grund = toleriert ? 'Akku-Toleranz' : 'drosseln';
  else if (abweichung < -totband) grund = 'lockern';
  else grund = 'halten';

  return {
    wrSollwertKw,
    drosselAktiv: wrSollwertKw < config.wrSollwertMaxKw - 1e-9,
    abweichungKw: abweichung,
    effektiveEinspeisungKw: effektiv,
    grund,
    ueberschussSeitMs: seit,
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
  let dg = Math.max(0, (mittel / ref) * pInst);
  const cap = Number(config.dargebotMaxKw) || 0;
  if (cap > 0) dg = Math.min(dg, cap); // reale Max-AC-Leistung (Kappung)
  return dg;
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
  akkuMaxLadeGrenzeKw,
  akkuReserveKw,
  akkuFreigabeFaktor,
  effektiveEinspeisungKw,
  reglerSchritt,
  dargebotKw,
  pKannKw,
};
