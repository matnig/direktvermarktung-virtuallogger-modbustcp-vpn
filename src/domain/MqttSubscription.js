class MqttSubscription {
  constructor({
    id,
    label        = '',
    enabled      = true,
    topic,
    variableId,
    dataType     = 'float32',
    jsonPath     = '',
    transforms   = [],
    description  = '',
    createdAt,
    updatedAt,
  }) {
    this.id          = id;
    this.label       = label;
    this.enabled     = enabled !== false;
    this.topic       = String(topic || '');
    this.variableId  = variableId;
    this.dataType    = dataType;
    this.jsonPath    = String(jsonPath || '');
    this.transforms  = Array.isArray(transforms) ? transforms : [];
    this.description = description;
    this.createdAt   = createdAt;
    this.updatedAt   = updatedAt;
  }
}

module.exports = MqttSubscription;
