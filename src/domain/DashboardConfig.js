// Konfiguration der Übersichtsseite (Dashboard) der Web-UI.
//
// Sie gehört bewusst in den JSON-Store und nicht in den localStorage des Browsers:
// die Auswahl ist Teil der Anlagenkonfiguration und muss über Export/Import mitwandern,
// damit ein zweites Gerät oder eine wiederhergestellte Installation dieselbe Übersicht zeigt.

class DashboardConfig {
  constructor({
    // Zusätzlich in der Live-Übersicht angezeigte Werte.
    // Einträge: { kind: 'register' | 'variable' | 'external' | 'em', id }
    //   register — Register einer Modbus-Quelle (Live-Wert aus dem Runtime-State)
    //   variable — virtuelle Variable
    //   external — Register des eigenen Modbus-Servers
    //   em       — Feld aus dem Einspeisemanagement-Status (id = Pfad, z. B. 'pIstKw')
    liveItems = [],
    // Welche Kacheln der Betriebsparameter-Übersicht eingeblendet sind.
    parameterKarten = ['runtime', 'bridge', 'mqtt', 'netzwerk', 'einspeisemanagement', 'bestand'],
    // Startansicht beim Öffnen der Seite
    startAnsicht = 'uebersicht',
    createdAt,
    updatedAt,
  } = {}) {
    this.liveItems = Array.isArray(liveItems)
      ? liveItems
          .filter((i) => i && typeof i === 'object')
          .map((i) => ({ kind: String(i.kind || ''), id: String(i.id || '') }))
          .filter((i) => i.kind && i.id)
      : [];
    this.parameterKarten = Array.isArray(parameterKarten) ? parameterKarten.map(String) : [];
    this.startAnsicht = String(startAnsicht || 'uebersicht');
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }
}

module.exports = DashboardConfig;
