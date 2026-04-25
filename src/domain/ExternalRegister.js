const DATA_TYPES_32 = new Set(['uint32', 'int32', 'float32']);

class ExternalRegister {
  constructor({
    id,
    name,
    address,
    registerType = 'holding',
    dataType = 'uint16',
    writable = false,
    unit = '',
    description = '',
    enabled = true,
    createdAt,
    updatedAt,
  }) {
    this.id = id;
    this.name = name;
    this.address = Number(address);
    this.registerType = registerType === 'input' ? 'input' : 'holding';
    this.dataType = dataType;
    this.length = DATA_TYPES_32.has(dataType) ? 2 : 1;
    // Input registers are read-only from the external client's perspective
    this.writable = this.registerType === 'input' ? false : !!writable;
    this.unit = unit;
    this.description = description;
    this.enabled = enabled !== false;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }
}

module.exports = ExternalRegister;
