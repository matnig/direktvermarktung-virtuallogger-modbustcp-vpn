// Eingaben für die Wirtschaftlichkeitsbetrachtung eines Umbaus (größerer Speicher,
// PV-Erweiterung). Gehört in den JSON-Store und in den Export: das sind Planungsdaten,
// die man nicht zweimal eingeben will.

class WirtschaftlichkeitConfig {
  constructor({
    // --- Erlöse und Kosten je kWh ---
    bezugspreisEurProKwh = 0.28,              // was eine vermiedene Bezugs-kWh spart
    ertragDirektKundeEurProKwh = 0.22,        // Lieferung direkt an Kunden
    ertragDirektvermarktungEurProKwh = 0.07,  // Direktvermarktung
    anteilDirektKundeProzent = 0,             // welcher Teil der Einspeisung an Kunden geht

    // --- Speicher ---
    akkuBestandKwh = 65,                      // heutiger Speicher (Intilion, nutzbar)
    akkuBestandLeistungKw = 50,
    akkuVerkaufserloesEur = 0,                // Erlös aus dem Verkauf des Bestandsspeichers
    akkuNeuKwh = 255,
    akkuNeuLeistungKw = 100,
    akkuNeuKostenEurProKwh = 350,
    akkuWirkungsgrad = 0.92,
    akkuEntladetiefe = 0.9,

    // --- PV ---
    pvBestandKwp = 160,
    pvErweiterungKwp = 0,
    pvKostenEurProKwp = 900,
    spezifischerErtragKwhProKwp = 950,        // für die Erweiterung angenommener Jahresertrag

    // --- Rahmen ---
    sonstigeKostenEur = 0,                    // Umbau, Netzanschluss, Planung
    betriebskostenProzentProJahr = 1.5,
    betrachtungsjahreJahre = 15,
    kalkulationszinsProzent = 4,

    // --- zusätzlich verschiebbare Erzeugung (z. B. BHKW, das abgeschaltet werden kann) ---
    zusatzlastId = null,                      // importierter Zählerverlauf dieser Erzeugung
    zusatzlastKostenEurProKwh = 0.15,         // was ihre Erzeugung je kWh kostet

    lastgangId = null,                        // welcher importierte Lastgang gerechnet wird
    createdAt,
    updatedAt,
  } = {}) {
    Object.assign(this, {
      bezugspreisEurProKwh, ertragDirektKundeEurProKwh, ertragDirektvermarktungEurProKwh,
      anteilDirektKundeProzent,
      akkuBestandKwh, akkuBestandLeistungKw, akkuVerkaufserloesEur,
      akkuNeuKwh, akkuNeuLeistungKw, akkuNeuKostenEurProKwh,
      akkuWirkungsgrad, akkuEntladetiefe,
      pvBestandKwp, pvErweiterungKwp, pvKostenEurProKwp, spezifischerErtragKwhProKwp,
      sonstigeKostenEur, betriebskostenProzentProJahr, betrachtungsjahreJahre,
      kalkulationszinsProzent, zusatzlastId, zusatzlastKostenEurProKwh,
      lastgangId, createdAt, updatedAt,
    });
  }
}

module.exports = WirtschaftlichkeitConfig;
