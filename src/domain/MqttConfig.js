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
    // Home Assistant MQTT Discovery
    discoveryEnabled    = false,
    discoveryPrefix     = 'homeassistant',
    discoveryDeviceName = 'Modbus Bridge',
    discoveryDeviceId   = 'modbus-bridge',
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
    // Discovery
    this.discoveryEnabled    = !!discoveryEnabled;
    this.discoveryPrefix     = String(discoveryPrefix || 'homeassistant');
    this.discoveryDeviceName = String(discoveryDeviceName || 'Modbus Bridge');
    this.discoveryDeviceId   = String(discoveryDeviceId || 'modbus-bridge');
    this.updatedAt   = updatedAt;
  }
}

module.exports = MqttConfig;

