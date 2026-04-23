const DIRECTIONS    = new Set(['internal_to_external', 'external_to_internal', 'bidirectional']);
const SOURCE_TYPES  = new Set(['register', 'variable']);
const TARGET_TYPES  = new Set(['external', 'variable', 'internal']);
const TRANSFORM_TYPES = new Set([
  'scale', 'offset', 'invert', 'clamp', 'abs',
  'multiply', 'divide', 'add', 'subtract', 'invertSign',
  'clampMin', 'clampMax', 'clampRange',
  'positiveOnly', 'negativeOnly',
  'round', 'boolToInt', 'intToBool',
]);

function validateTransform(step, index) {
  const errors = [];
  if (!step || typeof step !== 'object') {
    return [`transforms[${index}]: must be an object`];
  }
  if (!TRANSFORM_TYPES.has(step.type)) {
    errors.push(`transforms[${index}].type must be one of: ${[...TRANSFORM_TYPES].join(', ')}`);
  }
  if (step.type === 'scale' && (step.factor === undefined || !Number.isFinite(Number(step.factor)))) {
    errors.push(`transforms[${index}]: scale requires a finite numeric factor`);
  }
  if (step.type === 'multiply' && (step.factor === undefined || !Number.isFinite(Number(step.factor ?? step.value)))) {
    errors.push(`transforms[${index}]: multiply requires a finite numeric factor`);
  }
  if (step.type === 'divide') {
    const d = Number(step.divisor ?? step.value);
    if (!Number.isFinite(d)) errors.push(`transforms[${index}]: divide requires a finite numeric divisor`);
    else if (d === 0) errors.push(`transforms[${index}]: divide divisor cannot be zero`);
  }
  if (step.type === 'offset' && (step.value === undefined || !Number.isFinite(Number(step.value)))) {
    errors.push(`transforms[${index}]: offset requires a finite numeric value`);
  }
  if ((step.type === 'add' || step.type === 'subtract') && !Number.isFinite(Number(step.value))) {
    errors.push(`transforms[${index}]: ${step.type} requires a finite numeric value`);
  }
  if (step.type === 'round' && step.decimals !== undefined) {
    const d = Number(step.decimals);
    if (!Number.isFinite(d) || d < 0) errors.push(`transforms[${index}]: round decimals must be a non-negative integer`);
  }
  if (step.type === 'clampMin' && !Number.isFinite(Number(step.min ?? step.value))) {
    errors.push(`transforms[${index}]: clampMin requires a finite numeric min`);
  }
  if (step.type === 'clampMax' && !Number.isFinite(Number(step.max ?? step.value))) {
    errors.push(`transforms[${index}]: clampMax requires a finite numeric max`);
  }
  if (step.type === 'clamp' || step.type === 'clampRange') {
    const min = step.min !== undefined ? Number(step.min) : null;
    const max = step.max !== undefined ? Number(step.max) : null;
    if (min !== null && !Number.isFinite(min)) errors.push(`transforms[${index}]: clamp min must be a finite number`);
    if (max !== null && !Number.isFinite(max)) errors.push(`transforms[${index}]: clamp max must be a finite number`);
    if (min !== null && max !== null && min > max) errors.push(`transforms[${index}]: clamp min must be <= max`);
  }
  return errors;
}

function validateTransforms(transforms, errors) {
  if (transforms === undefined) return;
  if (!Array.isArray(transforms)) {
    errors.push('transforms must be an array');
    return;
  }
  transforms.forEach((step, i) => errors.push(...validateTransform(step, i)));
}

function validateMapping(payload) {
  const errors = [];

  // Detect which model is in use. sourceType presence → new generalized model.
  const useNewModel = payload.sourceType !== undefined;

  if (useNewModel) {
    if (!SOURCE_TYPES.has(payload.sourceType)) {
      errors.push(`sourceType must be one of: ${[...SOURCE_TYPES].join(', ')}`);
    }
    if (!TARGET_TYPES.has(payload.targetType)) {
      errors.push(`targetType must be one of: ${[...TARGET_TYPES].join(', ')}`);
    }
    if (!payload.sourceId || String(payload.sourceId).trim().length < 1) {
      errors.push('sourceId is required');
    }
    if (!payload.targetId || String(payload.targetId).trim().length < 1) {
      errors.push('targetId is required');
    }
  } else {
    // Legacy model: register → external register with explicit direction
    if (!payload.sourceRegisterId || String(payload.sourceRegisterId).trim().length < 1) {
      errors.push('sourceRegisterId is required');
    }
    if (!payload.externalRegisterId || String(payload.externalRegisterId).trim().length < 1) {
      errors.push('externalRegisterId is required');
    }
    if (!DIRECTIONS.has(payload.direction)) {
      errors.push('direction must be one of: internal_to_external, external_to_internal, bidirectional');
    }
  }

  if (payload.enabled !== undefined && typeof payload.enabled !== 'boolean') {
    errors.push('enabled must be a boolean');
  }

  validateTransforms(payload.transforms, errors);

  return { isValid: errors.length === 0, errors };
}

module.exports = {
  validateMapping,
  validateTransform,
  DIRECTIONS:      Array.from(DIRECTIONS),
  SOURCE_TYPES:    Array.from(SOURCE_TYPES),
  TARGET_TYPES:    Array.from(TARGET_TYPES),
  TRANSFORM_TYPES: Array.from(TRANSFORM_TYPES),
};
