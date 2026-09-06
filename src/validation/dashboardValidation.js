const KINDS = new Set(['register', 'variable', 'external', 'em']);

function validateDashboard(payload = {}) {
  const errors = [];

  if (payload.liveItems !== undefined) {
    if (!Array.isArray(payload.liveItems)) {
      errors.push('liveItems must be an array');
    } else {
      payload.liveItems.forEach((item, i) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          errors.push(`liveItems[${i}] must be an object like {kind,id}`);
          return;
        }
        if (!KINDS.has(item.kind)) {
          errors.push(`liveItems[${i}].kind must be one of: ${[...KINDS].join(', ')}`);
        }
        if (typeof item.id !== 'string' || !item.id.trim()) {
          errors.push(`liveItems[${i}].id must be a non-empty string`);
        }
      });
      if (payload.liveItems.length > 200) errors.push('liveItems must not exceed 200 entries');
    }
  }

  if (payload.parameterKarten !== undefined) {
    if (!Array.isArray(payload.parameterKarten)
        || !payload.parameterKarten.every((k) => typeof k === 'string')) {
      errors.push('parameterKarten must be an array of strings');
    }
  }

  if (payload.startAnsicht !== undefined && typeof payload.startAnsicht !== 'string') {
    errors.push('startAnsicht must be a string');
  }

  return { isValid: errors.length === 0, errors };
}

module.exports = { validateDashboard, KINDS: [...KINDS] };
