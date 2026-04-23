// Encode a numeric value into Modbus words (big-endian) for a given dataType.
function encodeRegisterValue(value, dataType) {
  if (dataType === 'bool') {
    return [value ? 1 : 0];
  }

  const is32 = dataType === 'uint32' || dataType === 'int32' || dataType === 'float32';
  const buf  = Buffer.alloc(is32 ? 4 : 2);

  if (typeof value !== 'number' || !isFinite(value)) {
    console.warn(`[encode] non-finite value (${value}) for dataType ${dataType}, substituting 0`);
  }
  const v = typeof value === 'number' && isFinite(value) ? value : 0;

  switch (dataType) {
    case 'uint16': buf.writeUInt16BE(Math.max(0, Math.min(65535, Math.round(v))), 0); break;
    case 'int16':  buf.writeInt16BE(Math.max(-32768, Math.min(32767, Math.round(v))), 0); break;
    case 'uint32': buf.writeUInt32BE(Math.max(0, Math.min(4294967295, Math.round(v))), 0); break;
    case 'int32':  buf.writeInt32BE(Math.max(-2147483648, Math.min(2147483647, Math.round(v))), 0); break;
    case 'float32': buf.writeFloatBE(v, 0); break;
    default:
      console.warn(`[encode] unknown dataType "${dataType}", writing 0`);
      buf.writeUInt16BE(0, 0);
      break;
  }

  const words = [];
  for (let i = 0; i < buf.length; i += 2) words.push(buf.readUInt16BE(i));
  return words;
}

// Decode Modbus words back to a number for a given dataType (raw, no scale).
function decodeWords(words, dataType) {
  if (!Array.isArray(words) || words.length === 0) return 0;

  if (dataType === 'bool') return words[0] !== 0;

  const buf = Buffer.alloc(words.length * 2);
  words.forEach((w, i) => buf.writeUInt16BE(w & 0xffff, i * 2));

  switch (dataType) {
    case 'uint16':  return buf.readUInt16BE(0);
    case 'int16':   return buf.readInt16BE(0);
    case 'uint32':  return buf.readUInt32BE(0);
    case 'int32':   return buf.readInt32BE(0);
    case 'float32': return buf.readFloatBE(0);
    default:        return buf.readUInt16BE(0);
  }
}

// Apply an ordered transform pipeline to a numeric value.
// Throws if a step produces a non-finite result (NaN / Infinity propagation).
function applyTransforms(value, transforms) {
  if (!Array.isArray(transforms) || transforms.length === 0) return value;
  let v = typeof value === 'number' && isFinite(value) ? value : 0;

  for (const step of transforms) {
    switch (step.type) {
      case 'scale': {
        const factor = Number(step.factor ?? 1);
        v = v * factor;
        if (!isFinite(v)) throw new Error(`transform 'scale' produced non-finite result (factor=${step.factor})`);
        break;
      }
      case 'offset': {
        const offset = Number(step.value ?? 0);
        v = v + offset;
        if (!isFinite(v)) throw new Error(`transform 'offset' produced non-finite result (value=${step.value})`);
        break;
      }
      case 'multiply': {
        const mf = Number(step.factor ?? step.value ?? 1);
        v = v * mf;
        if (!isFinite(v)) throw new Error(`transform 'multiply' produced non-finite result (factor=${step.factor ?? step.value})`);
        break;
      }
      case 'divide': {
        const div = Number(step.divisor ?? step.value ?? 1);
        if (div === 0) throw new Error(`transform 'divide': divisor cannot be zero`);
        v = v / div;
        if (!isFinite(v)) throw new Error(`transform 'divide' produced non-finite result (divisor=${step.divisor ?? step.value})`);
        break;
      }
      case 'add': {
        const av = Number(step.value ?? 0);
        v = v + av;
        if (!isFinite(v)) throw new Error(`transform 'add' produced non-finite result`);
        break;
      }
      case 'subtract': {
        const sv = Number(step.value ?? 0);
        v = v - sv;
        if (!isFinite(v)) throw new Error(`transform 'subtract' produced non-finite result`);
        break;
      }
      case 'invert':
      case 'invertSign': v = -v; break;
      case 'abs':    v = Math.abs(v); break;
      case 'clamp':
      case 'clampRange': {
        const lo = step.min !== undefined ? Number(step.min) : -Infinity;
        const hi = step.max !== undefined ? Number(step.max) :  Infinity;
        const safeLo = isFinite(lo) ? lo : -Infinity;
        const safeHi = isFinite(hi) ? hi :  Infinity;
        v = Math.max(safeLo, Math.min(safeHi, v));
        break;
      }
      case 'clampMin': {
        const cmin = Number(step.min ?? step.value ?? 0);
        if (isFinite(cmin)) v = Math.max(cmin, v);
        break;
      }
      case 'clampMax': {
        const cmax = Number(step.max ?? step.value ?? 0);
        if (isFinite(cmax)) v = Math.min(cmax, v);
        break;
      }
      case 'positiveOnly': v = Math.max(0, v); break;
      case 'negativeOnly': v = Math.min(0, v); break;
      case 'round': {
        const dec = Math.max(0, Math.round(Number(step.decimals ?? 0)));
        v = Number(v.toFixed(dec));
        break;
      }
      case 'boolToInt': v = v ? 1 : 0; break;
      case 'intToBool': v = v !== 0 ? 1 : 0; break;
      default: break;
    }
  }

  return v;
}

module.exports = { encodeRegisterValue, decodeWords, applyTransforms };
