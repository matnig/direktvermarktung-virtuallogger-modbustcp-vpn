const DATA_TYPES = new Set(['uint16', 'int16', 'uint32', 'int32', 'float32', 'bool', 'string']);
const PUBLISH_SOURCE_TYPES = new Set(['register', 'variable', 'external_register', 'watchdog']);
const QOS_LEVELS = new Set([0, 1, 2]);
const TRANSFORM_TYPES = new Set(['scale', 'offset', 'invert', 'clamp', 'abs']);

function validateTransforms(transforms, errors) {
  if (transforms === undefined) return;
  if (!Array.isArray(transforms)) { errors.push('transforms must be an array'); return; }
  transforms.forEach((step, i) => {
    if (!step || typeof step !== 'object') { errors.push(`transforms[${i}]: must be an object`); return; }
    if (!TRANSFORM_TYPES.has(step.type)) {
      errors.push(`transforms[${i}].type must be one of: ${[...TRANSFORM_TYPES].join(', ')}`);
    }
    if (step.type === 'scale' && !Number.isFinite(Number(step.factor))) {
      errors.push(`transforms[${i}]: scale requires a finite numeric factor`);
    }
    if (step.type === 'offset' && !Number.isFinite(Number(step.value))) {
      errors.push(`transforms[${i}]: offset requires a finite numeric value`);
    }
    if (step.type === 'clamp') {
      const min = step.min !== undefined ? Number(step.min) : null;
      const max = step.max !== undefined ? Number(step.max) : null;
      if (min !== null && !Number.isFinite(min)) errors.push(`transforms[${i}]: clamp min must be finite`);
      if (max !== null && !Number.isFinite(max)) errors.push(`transforms[${i}]: clamp max must be finite`);
      if (min !== null && max !== null && min > max) errors.push(`transforms[${i}]: clamp min must be <= max`);
    }
  });
}

function validateMqttConfig(payload) {
  const errors = [];

  if (payload.enabled !== undefined && typeof payload.enabled !== 'boolean') {
    errors.push('enabled must be a boolean');
  }
  if (payload.port !== undefined) {
    const port = Number(payload.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      errors.push('port must be an integer between 1 and 65535');
    }
  }
  if (payload.keepalive !== undefined) {
    const k = Number(payload.keepalive);
    if (!Number.isInteger(k) || k < 0) errors.push('keepalive must be a non-negative integer');
  }
  if (payload.reconnectMs !== undefined) {
    const r = Number(payload.reconnectMs);
    if (!Number.isInteger(r) || r < 1000) errors.push('reconnectMs must be an integer >= 1000');
  }
  if (payload.tls !== undefined && typeof payload.tls !== 'boolean') {
    errors.push('tls must be a boolean');
  }
  return { isValid: errors.length === 0, errors };
}

function validateMqttTopic(topic) {
  if (!topic || typeof topic !== 'string' || !topic.trim()) {
    return { isValid: false, error: 'topic is required' };
  }
  // # must be last segment
  const parts = topic.split('/');
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i] === '#') return { isValid: false, error: 'wildcard # must be the last segment' };
  }
  return { isValid: true };
}

function validateMqttSubscription(payload) {
  const errors = [];

  const topicCheck = validateMqttTopic(payload.topic);
  if (!topicCheck.isValid) errors.push(topicCheck.error);

  if (!payload.variableId || String(payload.variableId).trim().length < 1) {
    errors.push('variableId is required');
  }
  if (!DATA_TYPES.has(payload.dataType)) {
    errors.push(`dataType must be one of: ${[...DATA_TYPES].join(', ')}`);
  }
  if (payload.enabled !== undefined && typeof payload.enabled !== 'boolean') {
    errors.push('enabled must be a boolean');
  }
  validateTransforms(payload.transforms, errors);
  return { isValid: errors.length === 0, errors };
}

function validateMqttPublishRule(payload) {
  const errors = [];

  if (!PUBLISH_SOURCE_TYPES.has(payload.sourceType)) {
    errors.push(`sourceType must be one of: ${[...PUBLISH_SOURCE_TYPES].join(', ')}`);
  }
  if (!payload.sourceId || String(payload.sourceId).trim().length < 1) {
    errors.push('sourceId is required');
  }
  const topicCheck = validateMqttTopic(payload.topic);
  if (!topicCheck.isValid) errors.push(topicCheck.error);

  if (payload.qos !== undefined && !QOS_LEVELS.has(Number(payload.qos))) {
    errors.push('qos must be 0, 1, or 2');
  }
  if (payload.retain !== undefined && typeof payload.retain !== 'boolean') {
    errors.push('retain must be a boolean');
  }
  if (payload.enabled !== undefined && typeof payload.enabled !== 'boolean') {
    errors.push('enabled must be a boolean');
  }
  validateTransforms(payload.transforms, errors);
  return { isValid: errors.length === 0, errors };
}

module.exports = {
  validateMqttConfig,
  validateMqttSubscription,
  validateMqttPublishRule,
  PUBLISH_SOURCE_TYPES: [...PUBLISH_SOURCE_TYPES],
};
