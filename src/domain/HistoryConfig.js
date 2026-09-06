// Konfiguration des Verlaufs-Loggers.
//
// Aufgezeichnet werden genau die Werte, die in der Übersicht als Live-Daten ausgewählt sind
// (dashboard.liveItems) — das ist auch die Menge, die man dort anklicken kann. Eine zweite,
// getrennt zu pflegende Serienliste wäre eine zusätzliche Fehlerquelle.

class HistoryConfig {
  constructor({
    enabled = true,
    intervalMs = 15000,        // Abtastrate
    maxPunkteJeReihe = 17280,  // Ringpuffer je Reihe (bei 15 s ≈ 3 Tage)
    flushMs = 30000,           // wie oft neue Punkte auf die Platte geschrieben werden
    createdAt,
    updatedAt,
  } = {}) {
    this.enabled = enabled !== false;
    this.intervalMs = Math.max(1000, Number(intervalMs) || 15000);
    this.maxPunkteJeReihe = Math.max(60, Number(maxPunkteJeReihe) || 17280);
    this.flushMs = Math.max(5000, Number(flushMs) || 30000);
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }
}

module.exports = HistoryConfig;
