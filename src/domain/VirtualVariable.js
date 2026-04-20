class VirtualVariable {
  constructor({
    id,
    name,
    label        = '',
    dataType     = 'float32',
    unit         = '',
    writable     = true,
    enabled      = true,
    description  = '',
    initialValue = null,
    createdAt,
    updatedAt,
  }) {
    this.id           = id;
    this.name         = String(name || '');
    this.label        = String(label || '');
    this.dataType     = dataType;
    this.unit         = String(unit || '');
    this.writable     = writable !== false;
    this.enabled      = enabled !== false;
    this.description  = String(description || '');
    this.initialValue = initialValue;
    this.createdAt    = createdAt;
    this.updatedAt    = updatedAt;
  }
}

module.exports = VirtualVariable;
