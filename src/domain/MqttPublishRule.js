// sourceType: 'register' | 'variable' | 'external_register' | 'watchdog'
class MqttPublishRule {
  constructor({
    id,
    label          = '',
    enabled        = true,
    sourceType,
    sourceId,
    topic,
    qos            = 0,
    retain         = false,
    publishOnChange = true,
    transforms     = [],
    description    = '',
    createdAt,
    updatedAt,
  }) {
    this.id              = id;
    this.label           = label;
    this.enabled         = enabled !== false;
    this.sourceType      = sourceType;
    this.sourceId        = sourceId;
    this.topic           = String(topic || '');
    this.qos             = Number(qos) || 0;
    this.retain          = !!retain;
    this.publishOnChange = publishOnChange !== false;
    this.transforms      = Array.isArray(transforms) ? transforms : [];
    this.description     = description;
    this.createdAt       = createdAt;
    this.updatedAt       = updatedAt;
  }
}

module.exports = MqttPublishRule;
