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

// Wie lange könnte der Akku die volle Ladeleistung noch aufnehmen (Sekunden)?
// Aus der noch ladbaren Energie (Intilion 5025, kWh) und der Ladegrenze. null = unbekannt.
function akkuRestdauerS(akku, config) {
  if (!akku) return null;
  const kwh = akku.ladbareEnergieKwh;
  if (kwh === null || kwh === undefined || !Number.isFinite(Number(kwh))) return null;
  const grenze = akkuMaxLadeGrenzeKw(akku, config);
  if (!(grenze > 0)) return null;
  return (Math.max(0, Number(kwh)) / grenze) * 3600;
}

// 1 = Akku darf voll als Puffer gerechnet werden, 0 = keine Freigabe (nur Vorsteuerung).
// Zwei Kriterien, es gilt das restriktivere:
//   (a) RESTDAUER (bevorzugt): wie lange der Akku die Ladeleistung noch aufnehmen kann. Das ist
//       die physikalisch ehrliche Größe — ein Akku bei 94 % SoC mit 4 kWh Restkapazität kann noch
//       ~5 min lang volle 50 kW ziehen und ist ein vollwertiger Puffer.
//   (b) SoC-Schwelle: grobe Rückfallebene, wenn die ladbare Energie nicht gebunden ist.
// Liegt keines der beiden Signale vor -> 0 (konservativ wie bisher).
function akkuFreigabeFaktor(akku, config) {
  if (!akku || akku.verfuegbar === false) return 0;
  const faktoren = [];

  // (a) Restdauer
  const restS = akkuRestdauerS(akku, config);
  if (restS !== null) {
    const schwelleS = Math.max(0, Number(config && config.akkuRestdauerSchwelleS) || 0);
    const bandS = Math.max(0, Number(config && config.akkuRestdauerUebergangS) || 0);
    if (bandS <= 0) faktoren.push(restS > schwelleS ? 1 : 0);
    else faktoren.push(clamp((restS - schwelleS) / bandS, 0, 1));
  }

  // (b) SoC — null/undefined NICHT als 0 lesen, sonst gäbe ein fehlendes SoC-Register
  // volle Freigabe statt der sicheren konservativen Vorsteuerung.
  if (akku.socProzent !== null && akku.socProzent !== undefined) {
    const soc = Number(akku.socProzent);
    const schwelle = Number(config && config.akkuFreigabeSocProzent);
    if (Number.isFinite(soc) && Number.isFinite(schwelle)) {
      const band = Math.max(0, Number(config && config.akkuFreigabeUebergangProzent) || 0);
      faktoren.push(band <= 0
        ? (soc < schwelle ? 1 : 0)
        : clamp((schwelle - soc) / band, 0, 1));
    }
  }

  if (!faktoren.length) return 0;
  return Math.min(...faktoren);
}

// --- 3b) Akku-Annahme-Wache: gilt die gutgeschriebene Ladereserve überhaupt noch? ---
// Die Ladereserve ist eine ANNAHME ("der Akku nimmt den Überschuss weg"). Sie ist nur gültig,
// solange der Akku das auch tut. Fällt er aus (Stopp, Störung, Komm-Fehler, fremde Sollwertvorgabe),
// meldet er weiterhin 50 kW Max-Ladeleistung, nimmt aber nichts ab — ohne Wache würde der Regler
// dann dauerhaft 50 kW echte Netzeinspeisung durchgehen lassen.
//
// Zwei unabhängige Kriterien:
//   (a) Statusregister (Systemmodus/Betriebszustand, sofern gebunden): meldet der Akku einen
//       nicht betriebsbereiten Zustand -> Reserve sofort sperren.
//   (b) Verhalten: steht trotz gutgeschriebener Reserve länger als akkuReaktionszeitMs ein echter
//       Netzüberschuss an, nimmt der Akku faktisch nicht an -> Reserve sperren. Das greift auch,
//       wenn die Statusregister nichts melden oder gar nicht gebunden sind.
//
// RÜCKKEHR: Die Sperre löst sich selbst, sobald der Akku wieder arbeitet — entweder weil er wieder
// lädt (>= akkuMindestLadeleistungKw) oder, als Rückfallebene ohne Statusregister, über eine Probe
// alle akkuSperreWiederholungMs. Nimmt er dann immer noch nicht an, greift die Sperre binnen eines
// Takts wieder (Karenzzeit 0 innerhalb des Wiederholungsfensters), sodass keine wiederkehrenden
// Einspeise-Fenster entstehen.
const AKKU_WACHE_INIT = Object.freeze({
  napUeberschussSeitMs: null,
  gesperrt: false,
  sperreSeitMs: null,
  letzteSperreMs: null, // wann zuletzt gesperrt wurde (verkürzt die Karenzzeit danach)
  probeLaeuft: false,   // Sperre wurde nur zum Neubewerten kurz gelöst
});

// Statusregister-Prüfung. Nicht gebunden / kein Wert => keine Aussage => betriebsbereit
// (das Verhaltenskriterium sichert diesen Fall ab).
function akkuBetriebsbereit(akku, config) {
  if (!akku || akku.verfuegbar === false) return false;
  const pruefe = (wert, erlaubt) => {
    if (wert === null || wert === undefined) return true;   // kein Signal -> keine Aussage
    if (!Array.isArray(erlaubt) || erlaubt.length === 0) return true;
    return erlaubt.some((ok) => Number(ok) === Number(wert));
  };
  return pruefe(akku.systemmodus, config && config.akkuSystemmodusOk)
      && pruefe(akku.betriebszustand, config && config.akkuBetriebszustandOk);
}

function akkuAnnahmeWache({ napEinspeisungKw, pLimitKw: limit, akku, jetztMs, zustand }, config) {
  const z = { ...AKKU_WACHE_INIT, ...(zustand || {}) };
  const jetzt = isNum(jetztMs) ? jetztMs : null;
  const wiederholung = Math.max(0, Number(config && config.akkuSperreWiederholungMs) || 0);

  // (a) Statusregister
  if (!akkuBetriebsbereit(akku, config)) {
    return {
      gesperrt: true,
      grund: 'Akku nicht betriebsbereit',
      zustand: {
        napUeberschussSeitMs: null,
        gesperrt: true,
        sperreSeitMs: z.gesperrt && z.sperreSeitMs != null ? z.sperreSeitMs : jetzt,
        letzteSperreMs: jetzt,
        probeLaeuft: false,
      },
    };
  }

  const mindestLade = Number(config && config.akkuMindestLadeleistungKw);
  const laedt = Math.max(0, Number(akku && akku.ladeleistungKw) || 0)
    >= (Number.isFinite(mindestLade) ? mindestLade : 0);
  const totband = Number(config && config.totbandKw) || 0;
  const ueberschuss = isNum(napEinspeisungKw) && isNum(limit)
    ? (napEinspeisungKw - limit) > totband
    : false;

  // --- Sperre lösen: arbeitet der Akku wieder? ---
  let gesperrt = z.gesperrt;
  let sperreSeitMs = z.sperreSeitMs;
  let probeLaeuft = z.probeLaeuft;
  let grund = gesperrt ? 'Akku nimmt nicht an' : null;
  if (laedt) probeLaeuft = false;                              // Akku arbeitet nachweislich
  if (gesperrt) {
    const probeFaellig = wiederholung > 0 && jetzt != null && sperreSeitMs != null
      && (jetzt - sperreSeitMs) >= wiederholung;
    if (laedt && !ueberschuss) {
      // Nachweislich zurück: er lädt UND der Netzüberschuss ist weg. Ladeleistung allein genügt
      // nicht — ein Akku, der 20 kW zieht während 8 kW ins Netz gehen, nimmt eben nicht an.
      gesperrt = false; sperreSeitMs = null; grund = null;
    } else if (probeFaellig) {
      // Probe: Sperre einmal lösen und neu bewerten. Nimmt er weiterhin nicht an, greift sie
      // beim nächsten Überschuss-Takt sofort wieder (Karenzzeit 0) — kein zweites Zeitfenster.
      gesperrt = false; sperreSeitMs = null; grund = null; probeLaeuft = true;
    }
  }

  // --- Sperre setzen: Überschuss steht trotz Reserve zu lange an ---
  let seit = z.napUeberschussSeitMs;
  let letzteSperreMs = z.letzteSperreMs;
  if (!gesperrt) {
    // Nur pruefen, wenn die Reserve ueberhaupt angerechnet wird. Ist die Freigabe schon 0
    // (Akku voll bzw. Restdauer zu kurz), sagt ein anstehender Ueberschuss nichts ueber den
    // Akku aus — er wuerde sonst dauerhaft faelschlich als "nimmt nicht an" gemeldet.
    if (ueberschuss && akkuReserveKw(akku, config) > 0 && akkuFreigabeFaktor(akku, config) > 0) {
      if (seit == null) seit = jetzt;
      // Während einer laufenden Probe ohne Karenz sperren — sonst entstünde bei einem dauerhaft
      // toten Akku bei jeder Probe ein neues Einspeisefenster von voller Reaktionszeit.
      // Auch kurz nach einer Sperre ohne Karenz sperren, sonst pendelt der Regler mit jeweils
      // voller Reaktionszeit als Einspeisefenster.
      const kuerzlichGesperrt = wiederholung > 0 && jetzt != null && letzteSperreMs != null
        && (jetzt - letzteSperreMs) < wiederholung;
      const karenz = (probeLaeuft || kuerzlichGesperrt)
        ? 0
        : Math.max(0, Number(config && config.akkuReaktionszeitMs) || 0);
      if (jetzt != null && seit != null && (jetzt - seit) >= karenz) {
        gesperrt = true; grund = 'Akku nimmt nicht an';
        sperreSeitMs = jetzt; letzteSperreMs = jetzt; seit = null;
      }
    } else {
      seit = null;
    }
  } else {
    seit = null;
  }

  return {
    gesperrt,
    grund,
    zustand: { napUeberschussSeitMs: seit, gesperrt, sperreSeitMs, letzteSperreMs, probeLaeuft },
  };
}

function effektiveEinspeisungKw(napEinspeisungKw, akku, config, opts) {
  if (!config.akkuVorsteuerung || !akku || akku.verfuegbar === false) return napEinspeisungKw;
  const reserveGesperrt = Boolean(opts && opts.reserveGesperrt);
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
  const puffer = reserveGesperrt ? 0 : akkuReserveKw(akku, config) * rf;

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
function reglerSchritt({ napEinspeisungKw, pLimitKw: limit, wrSollwertAktuellKw, akku, jetztMs, ueberschussSeitMs, akkuWache }, config) {
  if (!isNum(limit)) {
    return {
      wrSollwertKw: null, drosselAktiv: false, abweichungKw: null,
      effektiveEinspeisungKw: null, grund: 'kein P_limit', ueberschussSeitMs: null,
      akkuWache: { ...AKKU_WACHE_INIT, ...(akkuWache || {}) }, akkuSperre: null,
    };
  }
  // Wache zuerst: sie entscheidet, ob die Ladereserve in diesem Takt überhaupt zählt.
  const wache = akkuAnnahmeWache(
    { napEinspeisungKw, pLimitKw: limit, akku, jetztMs, zustand: akkuWache },
    config,
  );
  const start = isNum(wrSollwertAktuellKw) ? wrSollwertAktuellKw : config.wrSollwertMaxKw;
  const effektiv = effektiveEinspeisungKw(napEinspeisungKw, akku, config, { reserveGesperrt: wache.gesperrt });
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
    toleriert = !wache.gesperrt
      && toleranzMs > 0
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
    akkuWache: wache.zustand,
    akkuSperre: wache.gesperrt ? { gesperrt: true, grund: wache.grund } : { gesperrt: false, grund: null },
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
  akkuRestdauerS,
  akkuBetriebsbereit,
  akkuAnnahmeWache,
  AKKU_WACHE_INIT,
  effektiveEinspeisungKw,
  reglerSchritt,
  dargebotKw,
  pKannKw,
};
