function isIPv4(value) {
  return /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(value);
}

function isHostname(value) {
  return /^[a-zA-Z0-9.-]+$/.test(value) && value.length <= 253;
}

function validateSource(payload) {
  const errors = [];

  if (!payload.name || String(payload.name).trim().length < 2) {
    errors.push('name must contain at least 2 characters');
  }

  const host = String(payload.host || '').trim();
  if (!host || (!isIPv4(host) && !isHostname(host))) {
    errors.push('host must be a valid IPv4 address or hostname');
  }

  const port = Number(payload.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push('port must be an integer between 1 and 65535');
  }

  const unitId = Number(payload.unitId);
  if (!Number.isInteger(unitId) || unitId < 0 || unitId > 255) {
    errors.push('unitId must be an integer between 0 and 255');
  }

  const pollingIntervalMs = Number(payload.pollingIntervalMs);
  if (!Number.isInteger(pollingIntervalMs) || pollingIntervalMs < 250) {
    errors.push('pollingIntervalMs must be an integer >= 250');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

module.exports = {
  validateSource,
};
