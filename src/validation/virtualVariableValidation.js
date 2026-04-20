const DATA_TYPES = new Set(['uint16', 'int16', 'uint32', 'int32', 'float32', 'bool', 'string']);
const NUMERIC_TYPES = new Set(['uint16', 'int16', 'uint32', 'int32', 'float32']);

function validateVirtualVariable(payload) {
  const errors = [];

  if (!payload.name || String(payload.name).trim().length < 2) {
    errors.push('name must contain at least 2 characters');
  }
  if (!DATA_TYPES.has(payload.dataType)) {
    errors.push(`dataType must be one of: ${[...DATA_TYPES].join(', ')}`);
  }
  if (payload.writable !== undefined && typeof payload.writable !== 'boolean') {
    errors.push('writable must be a boolean');
  }
  if (payload.enabled !== undefined && typeof payload.enabled !== 'boolean') {
    errors.push('enabled must be a boolean');
  }

  // Validate initialValue against dataType when both are provided
  if (payload.initialValue !== undefined && payload.initialValue !== null && payload.initialValue !== '') {
    const dt = payload.dataType;
    if (NUMERIC_TYPES.has(dt)) {
      const n = Number(payload.initialValue);
      if (!Number.isFinite(n)) {
        errors.push(`initialValue must be a finite number for dataType "${dt}"`);
      }
    } else if (dt === 'bool') {
      const v = payload.initialValue;
      if (typeof v !== 'boolean' && v !== 0 && v !== 1 && v !== 'true' && v !== 'false') {
        errors.push('initialValue for bool must be true, false, 0, or 1');
      }
    }
    // 'string' accepts any value
  }

  return { isValid: errors.length === 0, errors };
}

module.exports = { validateVirtualVariable, DATA_TYPES: [...DATA_TYPES] };
