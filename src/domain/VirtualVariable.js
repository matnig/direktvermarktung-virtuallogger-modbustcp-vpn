class VirtualVariable {
  constructor({
    id,
    name,
    label        = '',
    dataType     = 'float32',
    unit         = '',
    deviceClass  = '',      // '' = aus der Einheit ableiten, 'none' = bewusst keine
    writable     = true,
    enabled      = true,
    haEnabled    = false,
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
    this.deviceClass  = String(deviceClass || '');
    this.writable     = writable !== false;
    this.enabled      = enabled !== false;
    this.haEnabled    = !!haEnabled;
    this.description  = String(description || '');
    this.initialValue = initialValue;
    this.createdAt    = createdAt;
    this.updatedAt    = updatedAt;
  }
}

module.exports = VirtualVariable;
