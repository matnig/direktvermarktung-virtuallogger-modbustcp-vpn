class MqttConfig {
  constructor({
    enabled      = false,
    host         = 'localhost',
    port         = 1883,
    clientId     = 'modbus-bridge',
    username     = '',
    password     = '',
    baseTopic    = 'modbus-bridge',
    keepalive    = 60,
    tls          = false,
    reconnectMs  = 5000,
    updatedAt,
  } = {}) {
    this.enabled     = !!enabled;
    this.host        = String(host);
    this.port        = Number(port) || 1883;
    this.clientId    = String(clientId);
    this.username    = String(username);
    this.password    = String(password);
    this.baseTopic   = String(baseTopic).replace(/\/$/, '');
    this.keepalive   = Number(keepalive) || 60;
    this.tls         = !!tls;
    this.reconnectMs = Number(reconnectMs) || 5000;
    this.updatedAt   = updatedAt;
  }
}

module.exports = MqttConfig;
