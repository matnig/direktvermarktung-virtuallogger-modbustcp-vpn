class ModbusSource {
  constructor({
    id,
    name,
    host,
    port,
    unitId,
    pollingIntervalMs,
    enabled = true,
    description = '',
    createdAt,
    updatedAt,
  }) {
    this.id = id;
    this.name = name;
    this.host = host;
    this.port = port;
    this.unitId = unitId;
    this.pollingIntervalMs = pollingIntervalMs;
    this.enabled = enabled;
    this.description = description;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }
}

module.exports = ModbusSource;
