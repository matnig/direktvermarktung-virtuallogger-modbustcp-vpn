function validateWatchdog(payload) {
  const errors = [];

  if (!payload.externalRegisterId || String(payload.externalRegisterId).trim().length < 1) {
    errors.push('externalRegisterId is required');
  }

  const timeoutMs = Number(payload.timeoutMs);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000) {
    errors.push('timeoutMs must be an integer >= 1000');
  }

  if (payload.enabled !== undefined && typeof payload.enabled !== 'boolean') {
    errors.push('enabled must be a boolean');
  }

  return { isValid: errors.length === 0, errors };
}

module.exports = { validateWatchdog };
