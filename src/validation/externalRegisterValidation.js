const DATA_TYPES = new Set(['uint16', 'int16', 'uint32', 'int32', 'float32', 'bool']);

function validateExternalRegister(payload) {
  const errors = [];

  if (!payload.name || String(payload.name).trim().length < 2) {
    errors.push('name must contain at least 2 characters');
  }

  const address = Number(payload.address);
  const is32bit = ['uint32', 'int32', 'float32'].includes(payload.dataType);
  // 32-bit types occupy 2 words: address and address+1; max start address is 65534.
  // 16-bit types occupy 1 word; max address is 65535.
  const maxAddress = is32bit ? 65534 : 65535;
  if (!Number.isInteger(address) || address < 0 || address > maxAddress) {
    errors.push(`address must be an integer between 0 and ${maxAddress} for dataType "${payload.dataType}"`);
  }

  if (!DATA_TYPES.has(payload.dataType)) {
    errors.push('dataType must be one of: uint16, int16, uint32, int32, float32, bool');
  }

  if (payload.writable !== undefined && typeof payload.writable !== 'boolean') {
    errors.push('writable must be a boolean');
  }

  if (payload.enabled !== undefined && typeof payload.enabled !== 'boolean') {
    errors.push('enabled must be a boolean');
  }

  return { isValid: errors.length === 0, errors };
}

function validateNoAddressConflict(address, dataType, existingRegisters, excludeId = null) {
  const len = ['uint32', 'int32', 'float32'].includes(dataType) ? 2 : 1;
  const newAddresses = new Set();
  for (let i = 0; i < len; i++) newAddresses.add(address + i);

  for (const reg of existingRegisters) {
    if (reg.id === excludeId) continue;
    if (!reg.enabled) continue;
    const regLen = reg.length || 1;
    for (let i = 0; i < regLen; i++) {
      if (newAddresses.has(reg.address + i)) {
        return {
          isValid: false,
          error: `Address conflict with existing register "${reg.name}" at address ${reg.address}`,
        };
      }
    }
  }
  return { isValid: true };
}

module.exports = {
  validateExternalRegister,
  validateNoAddressConflict,
  DATA_TYPES: Array.from(DATA_TYPES),
};
