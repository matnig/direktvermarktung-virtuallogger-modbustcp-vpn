'use strict';

// Mitlernende Kalibrierung des Dargebot-Modells — reine Rechenlogik, keine I/O.
//
// Gesucht sind die beiden Koeffizienten aus
//     P = a * mittel + b * min(NW, SO)
// (a = pInstalliertKw, b = pDiffusKw, jeweils bezogen auf strahlungReferenzWm2).
//
// Verfahren: gewichtete kleinste Quadrate mit ZEITLICHEM Vergessen. Die aufsummierten
// Normalgleichungen werden bei jedem Schritt um 0,5^(dt/Halbwertszeit) gedämpft. Damit
// hängt die Zeitkonstante an der Uhr und nicht an der Abtastrate — genau das braucht
// man, damit sich das Modell über Wochen an die Jahreszeit anpasst und nicht an einem
// einzelnen sonnigen Nachmittag verreißt.
//
// Sicherheitsnetz, weil P_kann an den Netzbetreiber geht und die Sollwert-Obergrenze
// daran hängt: die gelernten Werte werden gegen die konfigurierten begrenzt, und
// gelernt wird nur aus Punkten, die das Dargebot überhaupt abbilden können.

function leererZustand() {
  return { s11: 0, s12: 0, s22: 0, b1: 0, b2: 0, n: 0, tMs: null };
}

// Taugt dieser Messpunkt zum Lernen?
// Gedrosselte Punkte scheiden aus: dort ist P_ist begrenzt und damit gerade NICHT das
// Können der Anlage. Zu wenig Licht und zu wenig Leistung ebenfalls — dort dominieren
// Wechselrichter-Eigenverbrauch und Anlaufeffekte.
function istBrauchbar({ strNw, strSo, pIstKw, drosselAktiv }, cfg = {}) {
  if (drosselAktiv) return { ok: false, grund: 'gedrosselt' };
  const zahl = (v) => typeof v === 'number' && Number.isFinite(v);
  if (!zahl(strNw) || !zahl(strSo) || !zahl(pIstKw)) return { ok: false, grund: 'unvollstaendig' };
  const mittel = (strNw + strSo) / 2;
  if (mittel < (cfg.lernMinStrahlungWm2 ?? 300)) return { ok: false, grund: 'zu wenig Strahlung' };
  if (pIstKw < (cfg.lernMinLeistungKw ?? 10)) return { ok: false, grund: 'zu wenig Leistung' };
  return { ok: true, mittel, minimum: Math.min(strNw, strSo) };
}

// Einen Punkt einarbeiten. Gibt den neuen Zustand zurück (rein, ohne Seiteneffekt).
function beobachte(zustand, punkt, cfg = {}, jetztMs = Date.now()) {
  const z = { ...leererZustand(), ...(zustand || {}) };
  const pruef = istBrauchbar(punkt, cfg);
  if (!pruef.ok) return { zustand: z, uebernommen: false, grund: pruef.grund };

  const halbwertMs = Math.max(1, (cfg.lernHalbwertszeitTage ?? 30)) * 86400000;
  if (z.tMs !== null && jetztMs > z.tMs) {
    const d = Math.pow(0.5, (jetztMs - z.tMs) / halbwertMs);
    z.s11 *= d; z.s12 *= d; z.s22 *= d; z.b1 *= d; z.b2 *= d; z.n *= d;
  }
  z.tMs = jetztMs;

  const ref = cfg.strahlungReferenzWm2 || 1000;
  const x1 = pruef.mittel / ref;      // normiert, damit die Koeffizienten kW sind
  const x2 = pruef.minimum / ref;
  const y = punkt.pIstKw;

  z.s11 += x1 * x1; z.s12 += x1 * x2; z.s22 += x2 * x2;
  z.b1 += x1 * y;   z.b2 += x2 * y;   z.n += 1;
  return { zustand: z, uebernommen: true };
}

// Koeffizienten aus dem Zustand lösen — mit kleinem Ridge-Term gegen schlecht
// konditionierte Systeme (Strahlung auf beiden Dächern läuft über den Tag parallel).
function loese(zustand, cfg = {}) {
  const z = zustand || leererZustand();
  const minN = cfg.lernMinBeobachtungen ?? 500;
  if (!(z.n >= minN)) return { gueltig: false, grund: `zu wenige Beobachtungen (${Math.round(z.n)}/${minN})` };

  const ridge = 1e-6 * Math.max(1, z.s11);
  const a11 = z.s11 + ridge, a12 = z.s12, a22 = z.s22 + ridge;
  const det = a11 * a22 - a12 * a12;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) {
    return { gueltig: false, grund: 'System nicht loesbar' };
  }
  const a = (z.b1 * a22 - z.b2 * a12) / det;
  const b = (a11 * z.b2 - a12 * z.b1) / det;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return { gueltig: false, grund: 'kein endliches Ergebnis' };
  return { gueltig: true, pInstalliertKw: a, pDiffusKw: b };
}

// Gegen die konfigurierten Werte begrenzen. Zwei Gründe: erstens darf ein
// Messfehler das Modell nicht davonlaufen lassen, zweitens geht P_kann an den
// Netzbetreiber — eine gelernte Überschätzung meldet ein Können, das es nicht gibt.
// Negative Koeffizienten sind physikalisch sinnlos und werden auf 0 gezogen.
function begrenze(gelernt, cfg = {}) {
  const grenze = Math.max(0, cfg.lernMaxAbweichungProzent ?? 25) / 100;
  const basisA = Number(cfg.pInstalliertKw) || 0;
  const basisB = Number(cfg.pDiffusKw) || 0;
  const spanne = (basis, wert) => {
    if (!(basis > 0)) return Math.max(0, wert);
    return Math.min(basis * (1 + grenze), Math.max(basis * (1 - grenze), Math.max(0, wert)));
  };
  const a = spanne(basisA, gelernt.pInstalliertKw);
  const b = spanne(basisB, gelernt.pDiffusKw);
  return {
    pInstalliertKw: a,
    pDiffusKw: b,
    begrenzt: Math.abs(a - gelernt.pInstalliertKw) > 1e-9 || Math.abs(b - gelernt.pDiffusKw) > 1e-9,
  };
}

module.exports = { leererZustand, istBrauchbar, beobachte, loese, begrenze };
