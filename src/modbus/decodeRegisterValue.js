function toBufferFromWords(words) {
  const buffer = Buffer.alloc(words.length * 2);
  words.forEach((word, index) => {
    buffer.writeUInt16BE(word & 0xffff, index * 2);
  });
  return buffer;
}

function decodeRegisterValue(registerDefinition, modbusResponse) {
  const type = registerDefinition.registerType;
  const dataType = registerDefinition.dataType;
  const scale = Number(registerDefinition.scale ?? 1);
  const precision = Number(registerDefinition.precision ?? 0);

  if (type === 'coil' || type === 'discrete-input') {
    const raw = Array.isArray(modbusResponse.data) ? modbusResponse.data[0] : false;
    return {
      rawValue: raw,
      scaledValue: raw,
      formattedValue: String(raw),
    };
  }

  const words = Array.isArray(modbusResponse.data) ? modbusResponse.data : [];
  const buffer = toBufferFromWords(words);

  let rawValue;

  switch (dataType) {
    case 'bool':
      rawValue = words[0] !== 0;
      break;
    case 'uint16':
      rawValue = buffer.readUInt16BE(0);
      break;
    case 'int16':
      rawValue = buffer.readInt16BE(0);
      break;
    case 'uint32':
      rawValue = buffer.readUInt32BE(0);
      break;
    case 'int32':
      rawValue = buffer.readInt32BE(0);
      break;
    case 'float32':
      rawValue = buffer.readFloatBE(0);
      break;
    default:
      rawValue = words[0];
      break;
  }

  const scaledValue =
    typeof rawValue === 'number' ? Number((rawValue * scale).toFixed(precision)) : rawValue;

  return {
    rawValue,
    scaledValue,
    formattedValue:
      typeof scaledValue === 'number'
        ? `${scaledValue}${registerDefinition.unit ? ` ${registerDefinition.unit}` : ''}`
        : String(scaledValue),
  };
}

module.exports = decodeRegisterValue;