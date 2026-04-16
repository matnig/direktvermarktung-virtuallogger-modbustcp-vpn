const ModbusRTU = require('modbus-serial');

class ModbusClient {
  constructor() {
    this.client = new ModbusRTU();
    this.connectedKey = null;
  }

  async connect(source) {
    const key = `${source.host}:${source.port}`;

    if (this.connectedKey !== key || !this.client.isOpen) {
      if (this.client.isOpen) {
        try {
          this.client.close(() => {});
        } catch (error) {
          // ignore close cleanup errors
        }
      }

      await this.client.connectTCP(source.host, { port: source.port });
      this.connectedKey = key;
    }

    this.client.setID(source.unitId);
    this.client.setTimeout(3000);
  }

  async readRegister(source, registerDefinition) {
    await this.connect(source);

    const address = Number(registerDefinition.address);
    const length = Number(registerDefinition.length);

    switch (registerDefinition.registerType) {
      case 'holding':
        return this.client.readHoldingRegisters(address, length);
      case 'input':
        return this.client.readInputRegisters(address, length);
      case 'coil':
        return this.client.readCoils(address, length);
      case 'discrete-input':
        return this.client.readDiscreteInputs(address, length);
      default:
        throw new Error(`Unsupported register type: ${registerDefinition.registerType}`);
    }
  }
}

module.exports = ModbusClient;