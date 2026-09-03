// manualWriteService — Test-Modus: einen Wert manuell in ein Holding-Register einer Quelle schreiben.
//
// Zweck: Inbetriebnahme/Kalibrierung — z. B. einen kW-Sollwert nach VW0 (AQ3) der LOGO! schreiben und
// anschließend AQ3 zurücklesen, um Gain/Offset zu bestimmen. Bewusst getrennt vom Regler (controlService),
// der weiterhin NICHT aktuiert.
//
// SICHERHEIT: Schreibt echte Modbus-Werte auf ein Gerät (kann Ausgänge/Wechselrichter verstellen). Nur über
// die bewusste Test-Bedienung in der UI, mit Bestätigung.

const ModbusClient       = require('../modbus/modbusClient');
const sourceRepository   = require('../repositories/sourceRepository');
const { encodeRegisterValue, decodeWords } = require('../modbus/encodeRegisterValue');

// Eigener Client, getrennt vom Poll-/Bridge-Client
const client = new ModbusClient();

const ALLOWED_TYPES = new Set(['uint16', 'int16', 'uint32', 'int32', 'float32']);

async function writeHolding({ sourceId, address, dataType = 'uint16', value }) {
  const source = sourceRepository.getById(sourceId);
  if (!source) throw new Error('Quelle nicht gefunden');

  const addr = Number(address);
  if (!Number.isInteger(addr) || addr < 0 || addr > 65535) {
    throw new Error('address muss 0..65535 sein');
  }
  if (!ALLOWED_TYPES.has(dataType)) {
    throw new Error('dataType muss eines von ' + Array.from(ALLOWED_TYPES).join(', ') + ' sein');
  }
  const num = Number(value);
  if (!Number.isFinite(num)) throw new Error('value muss eine Zahl sein');

  const words = encodeRegisterValue(num, dataType);
  await client.writeRegisterWords(source, addr, words);

  // Rücklesen zur Kontrolle (best effort)
  let readback = null;
  try {
    const res = await client.readRegister(source, {
      registerType: 'holding', address: addr, length: words.length,
    });
    readback = decodeWords(res.data, dataType);
  } catch (e) {
    readback = 'Rücklesen fehlgeschlagen: ' + e.message;
  }

  return {
    ok: true,
    sourceId, source: source.name,
    address: addr, dataType, value: num,
    words, readback,
    at: new Date().toISOString(),
  };
}

module.exports = { writeHolding };
