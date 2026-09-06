const { test } = require('node:test');
const assert = require('node:assert');
const { buildDiscoveryPayload } = require('./mqttDiscoveryService');

const cfg = { baseTopic: 'modbus-bridge', discoveryPrefix: 'homeassistant', discoveryDeviceId: 'modbus-bridge' };
const bau = (over) => buildDiscoveryPayload(cfg, {
  id: 'em-var-x', name: 'X', dataType: 'float32', unit: '', writable: false, ...over,
});

test('Messwert-Sensor bekommt state_class measurement (Langzeitstatistik)', () => {
  const { type, payload } = bau({ name: 'PV Dargebot', unit: 'kW' });
  assert.strictEqual(type, 'sensor');
  assert.strictEqual(payload.state_class, 'measurement');
  assert.strictEqual(payload.device_class, 'power');
  assert.strictEqual(payload.unit_of_measurement, 'kW');
});

test('expliziter deviceClass schlaegt die Ableitung aus der Einheit', () => {
  // Ohne Angabe waere % -> humidity, fuer einen Akku-SoC falsch
  assert.strictEqual(bau({ unit: '%' }).payload.device_class, 'humidity');
  assert.strictEqual(bau({ unit: '%', deviceClass: 'battery' }).payload.device_class, 'battery');
});

test("deviceClass 'none' unterdrueckt die device_class ganz", () => {
  // kWh -> energy waere hier falsch: HA laesst energy nur mit state_class total/total_increasing zu,
  // die ladbare Energie ist aber ein Momentanwert.
  assert.strictEqual(bau({ unit: 'kWh' }).payload.device_class, 'energy');
  const p = bau({ unit: 'kWh', deviceClass: 'none' }).payload;
  assert.strictEqual(p.device_class, undefined);
  assert.strictEqual(p.state_class, 'measurement');
});

test('bool wird binary_sensor, nicht number', () => {
  const { type, payload } = bau({ name: 'Drosselung aktiv', dataType: 'bool' });
  assert.strictEqual(type, 'binary_sensor');
  assert.strictEqual(payload.payload_on, '1');
  assert.strictEqual(payload.state_class, undefined);
});

test('writable:false verhindert die number-Entity (sonst keine Statistik)', () => {
  assert.strictEqual(bau({ writable: true }).type, 'number');
  assert.strictEqual(bau({ writable: false }).type, 'sensor');
});
