class RegisterDefinition {
  constructor({
    id,
    sourceId,
    name,
    registerType,
    address,
    length,
    dataType,
    scale = 1,
    precision = 0,
    unit = '',
    signed = false,
    byteOrder = 'big-endian',
    wordOrder = 'big-endian',
    description = '',
    createdAt,
    updatedAt,
  }) {
    this.id = id;
    this.sourceId = sourceId;
    this.name = name;
    this.registerType = registerType;
    this.address = address;
    this.length = length;
    this.dataType = dataType;
    this.scale = scale;
    this.precision = precision;
    this.unit = unit;
    this.signed = signed;
    this.byteOrder = byteOrder;
    this.wordOrder = wordOrder;
    this.description = description;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }
}

module.exports = RegisterDefinition;
