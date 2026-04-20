// direction, sourceRegisterId, externalRegisterId kept for backward compatibility with existing data.
// New mappings may use sourceType/sourceId/targetType/targetId instead.
// sourceType: 'register' | 'variable'
// targetType: 'external' | 'variable' | 'internal'
class Mapping {
  constructor({
    id,
    label = '',
    description = '',
    // Legacy fields
    sourceRegisterId,
    externalRegisterId,
    direction = 'internal_to_external',
    // New generalized fields (optional; if present, override legacy)
    sourceType,
    sourceId,
    targetType,
    targetId,
    enabled = true,
    transforms = [],
    createdAt,
    updatedAt,
  }) {
    this.id = id;
    this.label = label;
    this.description = description;
    // Legacy
    this.sourceRegisterId  = sourceRegisterId;
    this.externalRegisterId = externalRegisterId;
    this.direction = direction;
    // Generalized
    this.sourceType = sourceType || null;
    this.sourceId   = sourceId   || null;
    this.targetType = targetType || null;
    this.targetId   = targetId   || null;

    this.enabled    = enabled !== false;
    this.transforms = Array.isArray(transforms) ? transforms : [];
    this.createdAt  = createdAt;
    this.updatedAt  = updatedAt;
  }
}

module.exports = Mapping;
