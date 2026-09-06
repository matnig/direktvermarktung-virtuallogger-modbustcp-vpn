'use strict';

// Live-Werte des eigenen Modbus-Servers.
//
// Diese Berechnung (inkl. der Low/High-Paarbildung zu einem 32-Bit-Wert) wurde bisher direkt
// in der Route gemacht. Sie liegt jetzt hier, weil der Verlaufs-Logger dieselben Werte
// aufzeichnen muss wie die Oberfläche anzeigt — zwei Implementierungen würden auseinanderlaufen.

const externalRegisterRepository = require('../repositories/externalRegisterRepository');
const externalServerService = require('./externalServerService');
const { decodeWords } = require('../modbus/encodeRegisterValue');

function listValues() {
  const out = externalRegisterRepository.list().map((r) => {
    const registerType = r.registerType === 'input' ? 'input' : 'holding';
    const len = r.length || 1;
    let words = [];
    try {
      words = registerType === 'input'
        ? externalServerService.readInputWords(r.address, len)
        : externalServerService.readWords(r.address, len);
    } catch (e) {
      words = [];
    }
    const raw = decodeWords(words, r.dataType);
    const prec = Number.isInteger(Number(r.precision)) ? Number(r.precision) : 0;
    const value = typeof raw === 'number' ? Number(raw.toFixed(prec)) : raw;
    const hex = words.map((w) => '0x' + (w & 0xffff).toString(16).toUpperCase().padStart(4, '0'));
    const bin = words.map((w) => (w & 0xffff).toString(2).padStart(16, '0'));
    return {
      id: r.id,
      name: r.name,
      registerType,
      address: r.address,
      dataType: r.dataType,
      unit: r.unit || '',
      precision: prec,
      words, hex, bin, raw, value,
      word: (words && words.length) ? (words[0] & 0xffff) : 0,
    };
  });

  // "<X> Low" / "<X> High" auf aufeinanderfolgenden Adressen zu einem vorzeichenlosen
  // 32-Bit-Wert zusammenfassen; er wird am Low-Eintrag ausgewiesen.
  const byKey = {};
  out.forEach((r) => { byKey[r.registerType + ':' + r.address] = r; });
  out.forEach((r) => {
    const nm = (r.name || '').trim();
    if (/low$/i.test(nm)) {
      const hi = byKey[r.registerType + ':' + (r.address + 1)];
      if (hi && /high$/i.test((hi.name || '').trim())) {
        r.combined32 = (((hi.word << 16) >>> 0) | (r.word & 0xffff)) >>> 0;
        r.combinedPrecision = r.precision;
        hi.isHighWordOf = r.address;
      }
    }
  });

  return out;
}

// Der für Anzeige und Aufzeichnung maßgebliche Zahlenwert eines externen Registers.
function valueOf(entry) {
  if (!entry) return null;
  return entry.combined32 !== undefined ? entry.combined32 : entry.value;
}

module.exports = { listValues, valueOf };
