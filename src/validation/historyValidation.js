function isNum(v) { return typeof v === 'number' && Number.isFinite(v); }

function validateHistory(payload = {}) {
  const errors = [];
  const numRange = (key, min, max) => {
    if (payload[key] === undefined) return;
    if (!isNum(payload[key]) || payload[key] < min || payload[key] > max) {
      errors.push(`${key} must be a number between ${min} and ${max}`);
    }
  };
  if (payload.enabled !== undefined && typeof payload.enabled !== 'boolean') {
    errors.push('enabled must be a boolean');
  }
  numRange('intervalMs', 1000, 3600000);
  numRange('maxPunkteJeReihe', 60, 500000);
  numRange('flushMs', 5000, 600000);
  return { isValid: errors.length === 0, errors };
}

module.exports = { validateHistory };
