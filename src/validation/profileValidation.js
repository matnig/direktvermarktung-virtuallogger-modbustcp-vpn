function validateProfile(payload) {
  const errors = [];

  if (!payload.name || String(payload.name).trim().length < 2) {
    errors.push('name must contain at least 2 characters');
  }

  if (!payload.providerKey || String(payload.providerKey).trim().length < 2) {
    errors.push('providerKey must contain at least 2 characters');
  }

  if (payload.sourceDefaults != null && typeof payload.sourceDefaults !== 'object') {
    errors.push('sourceDefaults must be an object');
  }

  if (payload.registerTemplates != null && !Array.isArray(payload.registerTemplates)) {
    errors.push('registerTemplates must be an array');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

module.exports = {
  validateProfile,
};
