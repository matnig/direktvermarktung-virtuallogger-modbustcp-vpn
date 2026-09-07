// Konfiguration für das Einspeisemanagement (Drosselung PV-Wechselrichter).
//
// Logik-Kurzfassung:
//   P_limit = min( Direktvermarkter-Sollwert , Netzbetreiber-Stufe->kW )
//   Der Regler ist ein EINSEITIGER BEGRENZER: er drosselt die PV nur, wenn die
//   gemessene Netzeinspeisung am Netzverknüpfungspunkt (Intilion-Zähler) P_limit
//   überschreitet. Darunter läuft die PV frei — der Akku macht ohnehin
//   Nulleinspeisung (lädt bei Überschuss bis Netzknoten = 0, max. akkuMaxLadeleistungKw).
//
// SICHERHEIT: aktuierungAktiv=false => es wird NICHTS an den Wechselrichter (LOGO AQ3)
// geschrieben. Erst nach LOGO-Link + Failsafe-Freigabe scharfschalten.

class EinspeisemanagementConfig {
  constructor({
    // --- Netzbetreiber-Stufen (Referenz für die Prozentstufen) ---
    pRef100Kw = 125,                     // 100 % = kW (default = WR-Leistung), einstellbar
    stufenProzent = [100, 60, 30, 0],    // Stufe 0..3 in %
    // Kontakt -> reduzierte Stufe (LOGO discrete inputs I1/I2/I3); kein Kontakt aktiv = 100 %
    kontaktStufeProzent = { i1: 60, i2: 30, i3: 0 },

    // --- LOGO Analog-Ausgangsskala (P_ist/P_kann an das Fernwirkgerät) ---
    aqSkalaMaxKw = 300,                  // 4-20 mA = 0..300 kW (WWN ≤300 kW)

    // --- Akkuspeicher (Intilion) ---
    akkuMaxLadeleistungKw = 50,          // Nulleinspeisungs-Puffer, für Vorsteuerung/Sättigung

    // --- Dargebot / P_kann (aus Strahlung) ---
    pInstalliertKw = 160,                // installierte PV-Leistung (Module), für Dargebot-Modell
    strahlungReferenzWm2 = 1000,         // Referenzstrahlung für Vollleistung (W/m²)
    pDiffusKw = 0,                       // Zusatzterm auf min(NW,SO) für bifaziale Module (0 = aus)
    dargebotMaxKw = 0,                   // Kappung des Dargebots (0 = keine); real max AC ~105 kW (WR 125, aber SO/NW+flach)
    pKannFaktor = 1,                     // P_kann-Schreibfaktor (10 = 0,1-kW-Auflösung; LOGO-Gain dann /10)

    // --- Regler (Wechselrichter-Sollwert via LOGO AQ3, Leistungsgrenze in kW) ---
    aktuierungAktiv = false,             // HART: false => kein Schreiben an den WR
    totbandKw = 1.0,                     // Totband um P_limit, verhindert Pendeln
    reglerAbtastMs = 1000,               // Regeltakt
    reglerVerstaerkung = 0.5,            // P-Anteil: kW WR-Korrektur je kW Regelabweichung
    maxSchrittKw = 5,                    // Ratenbegrenzung: max. Änderung WR-Sollwert je Schritt
    akkuVorsteuerung = true,             // Akku-Bilanz (Freigabe + Sättigungs-Vorsteuerung) berücksichtigen
    // Akku als Puffer: unterhalb dieser SoC-Schwelle gilt die freie Ladeleistung des Akkus als
    // echte Aufnahmefähigkeit -> Überschuss in dieser Höhe wird NICHT weggedrosselt.
    akkuFreigabeSocProzent = 85,         // ab hier zählt der Akku nicht mehr als Puffer
    akkuFreigabeUebergangProzent = 5,    // linearer Übergang darunter (80..85 %), kein Sprung
    // Besseres Kriterium als der SoC, sofern die ladbare Energie (5025) gebunden ist: wie lange
    // der Akku die volle Ladeleistung noch aufnehmen kann. Es gilt das restriktivere der beiden.
    // Bemessung: der Regler fährt einen vollen 50-kW-Kredit mit maxSchrittKw (5 kW/s) in ~10 s
    // zurück. 15 s Schwelle + 30 s Band (volle Freigabe ab 45 s Restdauer) ist dafür reichlich.
    // Frühere 60/120 waren rund zehnmal zu konservativ und haben den Akku am Ende ausgebremst.
    akkuRestdauerSchwelleS = 15,         // darunter zählt der Akku nicht mehr als Puffer
    akkuRestdauerUebergangS = 30,        // linearer Übergang darüber (15..45 s)
    akkuReserveFaktor = 1,               // Anteil der Ladereserve, der angerechnet wird (Sicherheitsmarge)
    ueberschussToleranzMs = 5000,        // kurzer Überschuss (bis Akku-Ladegrenze) wird so lange ausgesessen
    // Annahme-Wache: die Ladereserve gilt nur, solange der Akku sie auch nutzt.
    akkuReaktionszeitMs = 10000,         // steht der Überschuss länger an -> Reserve sperren
    akkuMindestLadeleistungKw = 1,       // ab dieser Ladeleistung gilt der Akku wieder als arbeitend
    akkuSperreWiederholungMs = 300000,   // Probe-Intervall, um eine Sperre neu zu bewerten (0 = nie)
    akkuSystemmodusOk = [40, 41, 140],   // Intilion 5016: Aktiv / Teil-Aktiv / Netzbildend (12 = Komm-Fehler)
    akkuBetriebszustandOk = [40, 41],    // Intilion 5056: Run / Standby (13 = Start-Komm, 20 = Stop)
    // Anti-Windup: WR-Sollwert nicht ueber das strahlungsbasierte Dargebot hinauslaufen lassen,
    // damit der Wechselrichter bei zurueckkehrender Sonne nicht ungebremst hochfaehrt und taktet.
    sollwertGrenzeAusDargebot = true,
    dargebotReserveProzent = 15,         // Zuschlag auf das Dargebot (Modellunsicherheit)
    dargebotReserveKw = 5,               // zusaetzlicher fester Zuschlag
    wrSollwertMaxKw = 125,               // harte Obergrenze WR-Sollwert
    wrSollwertMinKw = 0,                 // Untergrenze WR-Sollwert

    // --- Failsafe ---
    failsafeSollwertKw = 0,              // bei Komm-Verlust: WR-Sollwert auf diesen Wert (0 = sicher)
    logoTimeoutMs = 5000,                // ohne frische LOGO-Werte => Failsafe

    // --- Rollen-Bindings (welche Register/Variable spielt welche Rolle) ---
    // Ids sind deployment-spezifisch (Runtime-Daten auf .29) und werden in der UI/per API gesetzt.
    bindings = {
      direktvermarkterVariableId: null, // Variable "EWE Sollwert" (Wert in W)
      napRegisterIds: [],               // Intilion L1/L2/L3 (kW, Summe neg=Einspeisung)
      kontaktI1RegisterId: null,        // LOGO discrete-input I1
      kontaktI2RegisterId: null,        // LOGO discrete-input I2
      kontaktI3RegisterId: null,        // LOGO discrete-input I3
      akkuSocRegisterId: null,          // Intilion 5002 SoC (%)
      akkuLadeleistungRegisterId: null, // Intilion 5040 Wirkleistung System (neg=laden)
      akkuMaxLadeRegisterId: null,      // Intilion 5027 Max Ladeleistung (kW)
      akkuLadbareEnergieRegisterId: null, // Intilion 5025 Ladbare Energie (kWh) — Restdauer-Kriterium
      akkuSystemmodusRegisterId: null,  // Intilion 5016 Systemmodus (Annahme-Wache; null = Prüfung inaktiv)
      akkuBetriebszustandRegisterId: null, // Intilion 5056 Betriebszustand (Annahme-Wache)
      logoSourceId: null,               // LOGO Quelle (für Aktuierung)
      aq3TargetRegisterId: null,        // LOGO Holding 5 (VW10) — WR-Sollwert kW
      // --- P_kann / Dargebot ---
      pIstSourceRegisterId: null,       // Sentron PV-Wirkleistung (W) — Ist-Leistung
      strahlungOstVariableId: null,     // Variable Strahlung Ost (W/m²)
      strahlungWestVariableId: null,    // Variable Strahlung West (W/m²)
      pKannTargetRegisterId: null,      // LOGO Holding 11 (VW22) — P_kann kW
      pIstTargetRegisterId: null,       // LOGO AQ1 (NAI-VW) — P_ist an WWN = Netzeinspeisung (nur Einspeisung, max(0,·))
      // --- Netzbetreiber-Stufe an Direktvermarkter ---
      netzbetreiberOutLowRegisterId: null,  // externes Input-Register "Sollwert Netzbetreiber" Low (W)
      netzbetreiberOutHighRegisterId: null, // externes Input-Register "Sollwert Netzbetreiber" High (W)
    },

    createdAt,
    updatedAt,
  } = {}) {
    this.pRef100Kw = pRef100Kw;
    this.stufenProzent = stufenProzent;
    this.kontaktStufeProzent = kontaktStufeProzent;
    this.aqSkalaMaxKw = aqSkalaMaxKw;
    this.akkuMaxLadeleistungKw = akkuMaxLadeleistungKw;
    this.pInstalliertKw = pInstalliertKw;
    this.strahlungReferenzWm2 = strahlungReferenzWm2;
    this.pDiffusKw = pDiffusKw;
    this.dargebotMaxKw = dargebotMaxKw;
    this.pKannFaktor = pKannFaktor;
    this.aktuierungAktiv = aktuierungAktiv;
    this.totbandKw = totbandKw;
    this.reglerAbtastMs = reglerAbtastMs;
    this.reglerVerstaerkung = reglerVerstaerkung;
    this.maxSchrittKw = maxSchrittKw;
    this.akkuVorsteuerung = akkuVorsteuerung;
    this.akkuFreigabeSocProzent = akkuFreigabeSocProzent;
    this.akkuFreigabeUebergangProzent = akkuFreigabeUebergangProzent;
    this.akkuRestdauerSchwelleS = akkuRestdauerSchwelleS;
    this.akkuRestdauerUebergangS = akkuRestdauerUebergangS;
    this.akkuReserveFaktor = akkuReserveFaktor;
    this.ueberschussToleranzMs = ueberschussToleranzMs;
    this.akkuReaktionszeitMs = akkuReaktionszeitMs;
    this.akkuMindestLadeleistungKw = akkuMindestLadeleistungKw;
    this.akkuSperreWiederholungMs = akkuSperreWiederholungMs;
    this.akkuSystemmodusOk = akkuSystemmodusOk;
    this.akkuBetriebszustandOk = akkuBetriebszustandOk;
    this.sollwertGrenzeAusDargebot = sollwertGrenzeAusDargebot;
    this.dargebotReserveProzent = dargebotReserveProzent;
    this.dargebotReserveKw = dargebotReserveKw;
    this.wrSollwertMaxKw = wrSollwertMaxKw;
    this.wrSollwertMinKw = wrSollwertMinKw;
    this.failsafeSollwertKw = failsafeSollwertKw;
    this.logoTimeoutMs = logoTimeoutMs;
    this.bindings = {
      direktvermarkterVariableId: null,
      napRegisterIds: [],
      kontaktI1RegisterId: null,
      kontaktI2RegisterId: null,
      kontaktI3RegisterId: null,
      akkuSocRegisterId: null,
      akkuLadeleistungRegisterId: null,
      akkuMaxLadeRegisterId: null,
      akkuLadbareEnergieRegisterId: null,
      akkuSystemmodusRegisterId: null,
      akkuBetriebszustandRegisterId: null,
      logoSourceId: null,
      aq3TargetRegisterId: null,
      pIstSourceRegisterId: null,
      strahlungOstVariableId: null,
      strahlungWestVariableId: null,
      pKannTargetRegisterId: null,
      pIstTargetRegisterId: null,
      netzbetreiberOutLowRegisterId: null,
      netzbetreiberOutHighRegisterId: null,
      ...(bindings || {}),
    };
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }
}

module.exports = EinspeisemanagementConfig;
