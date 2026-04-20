class Watchdog {
  constructor({
    id,
    label = '',
    description = '',
    externalRegisterId,
    timeoutMs = 30000,
    enabled = true,
    createdAt,
    updatedAt,
  }) {
    this.id = id;
    this.label = label;
    this.description = description;
    this.externalRegisterId = externalRegisterId;
    this.timeoutMs = Number(timeoutMs) || 30000;
    this.enabled = enabled !== false;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }
}

module.exports = Watchdog;
