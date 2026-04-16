const REGISTER_TYPES = new Set(['holding', 'input', 'coil', 'discrete-input']);
const DATA_TYPES = new Set([
  'uint16',
  'int16',
  'uint32',
  'int32',
  'float32',
  'bool',
]);

function validateRegister(payload) {
  const errors = [];

  if (!payload.name || String(payload.name).trim().length < 2) {
    errors.push('name must contain at least 2 characters');
  }

  if (!payload.sourceId || String(payload.sourceId).trim().length < 1) {
    errors.push('sourceId is required');
  }

  if (!REGISTER_TYPES.has(payload.registerType)) {
    errors.push('registerType must be one of: holding, input, coil, discrete-input');
  }

  const address = Number(payload.address);
  if (!Number.isInteger(address) || address < 0 || address > 65535) {
    errors.push('address must be an integer between 0 and 65535');
  }

  const length = Number(payload.length);
  if (!Number.isInteger(length) || length < 1 || length > 125) {
    errors.push('length must be an integer between 1 and 125');
  }

  if (!DATA_TYPES.has(payload.dataType)) {
    errors.push('dataType must be one of: uint16, int16, uint32, int32, float32, bool');
  }

  const scale = Number(payload.scale ?? 1);
  if (!Number.isFinite(scale)) {
    errors.push('scale must be a number');
  }

  const precision = Number(payload.precision ?? 0);
  if (!Number.isInteger(precision) || precision < 0 || precision > 6) {
    errors.push('precision must be an integer between 0 and 6');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

module.exports = {
  validateRegister,
  REGISTER_TYPES: Array.from(REGISTER_TYPES),
  DATA_TYPES: Array.from(DATA_TYPES),
};
