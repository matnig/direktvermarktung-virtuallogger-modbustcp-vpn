const mappingRepository          = require('../repositories/mappingRepository');
const externalRegisterRepository = require('../repositories/externalRegisterRepository');
const registerRepository         = require('../repositories/registerRepository');
const sourceRepository           = require('../repositories/sourceRepository');
const virtualVariableRepository  = require('../repositories/virtualVariableRepository');
const externalServerService      = require('./externalServerService');
const runtimeService             = require('./runtimeService');
const variableService            = require('./variableService');
const ModbusClient               = require('../modbus/modbusClient');
const { encodeRegisterValue, decodeWords, applyTransforms } = require('../modbus/encodeRegisterValue');

const BRIDGE_TICK_MS = 1000;

const mappingStates = {};
const writeStates   = {};

let _tickHandle    = null;
let _writeUnlisten = null;

// Dedicated write client — separate from polling to avoid interleaving
const writeClient = new ModbusClient();

// ── Source value resolution ───────────────────────────────────────────

function resolveSourceValue(mapping, registerStates) {
  // New generalized model: sourceType set
  if (mapping.sourceType === 'variable') {
    const def = virtualVariableRepository.getById(mapping.sourceId);
    if (!def) throw new Error(`Variable ${mapping.sourceId} not found (deleted?)`);
    const vs = variableService.getVariableState(mapping.sourceId);
    if (!vs || vs.currentValue == null) return null; // no value yet — skip this cycle silently
    return { value: vs.currentValue, name: def.name || mapping.sourceId, lastReadAt: vs.lastUpdatedAt };
  }

  // Legacy or sourceType === 'register'
  const regId = mapping.sourceId || mapping.sourceRegisterId;
  const reg   = registerStates[regId];
  if (!reg) throw new Error('Source register not in runtime state');
  if (reg.error) throw new Error(reg.error);
  return { value: reg.scaledValue ?? reg.rawValue, name: reg.name, lastReadAt: reg.lastReadAt };
}

// ── Target write ──────────────────────────────────────────────────────

function writeToTarget(mapping, transformed) {
  // New generalized model: targetType set
  if (mapping.targetType === 'variable') {
    const ok = variableService.setValue(mapping.targetId, transformed, 'mapping');
    if (!ok) console.warn(`[BridgeService] setValue rejected for variable ${mapping.targetId} (not found or disabled)`);
    return { kind: 'variable', id: mapping.targetId };
  }

  if (mapping.targetType === 'internal') {
    // Async write; caller catches
    const reg = registerRepository.getById(mapping.targetId);
    if (!reg) throw new Error('Target internal register not found');
    if (reg.registerType !== 'holding') {
      throw new Error(`Write target must be holding register (got: ${reg.registerType})`);
    }
    const src = sourceRepository.getById(reg.sourceId);
    if (!src) throw new Error('Source for target register not found');
    const words = encodeRegisterValue(transformed, reg.dataType);
    writeClient.writeRegisterWords(src, reg.address, words)
      .catch((err) => console.error('[BridgeService] internal write error:', err.message));
    return { kind: 'internal', address: reg.address };
  }

  // Split mode: one 32-bit source value → two 16-bit external registers (low/high word)
  if (mapping.splitTarget === true) {
    if (!Number.isFinite(transformed)) throw new Error('Split: source value is not finite, refusing to write');
    const extLow  = externalRegisterRepository.getById(mapping.targetLowRegisterId);
    const extHigh = externalRegisterRepository.getById(mapping.targetHighRegisterId);
    if (!extLow)  throw new Error('Split: low-word target register not found');
    if (!extHigh) throw new Error('Split: high-word target register not found');
    // Unsigned 32-bit split: clamp to [0, 2^32-1], round to integer, then split words
    const u32      = Math.max(0, Math.min(0xFFFFFFFF, Math.round(transformed))) >>> 0;
    const lowWord  = u32 & 0xFFFF;
    const highWord = (u32 >>> 16) & 0xFFFF;
    const writeFn  = (extReg, word) => extReg.registerType === 'input'
      ? externalServerService.writeInputWords(extReg.address, [word])
      : externalServerService.writeWords(extReg.address, [word]);
    writeFn(extLow,  lowWord);
    writeFn(extHigh, highWord);
    return { kind: 'split', lowAddress: extLow.address, highAddress: extHigh.address };
  }

  // Default / legacy: write to external register (holding or input space)
  const extRegId = mapping.targetId || mapping.externalRegisterId;
  const extReg   = externalRegisterRepository.getById(extRegId);
  if (!extReg) throw new Error('External register not found');
  const words = encodeRegisterValue(transformed, extReg.dataType);
  if (extReg.registerType === 'input') {
    externalServerService.writeInputWords(extReg.address, words);
  } else {
    externalServerService.writeWords(extReg.address, words);
  }
  return { kind: 'external', address: extReg.address, dataType: extReg.dataType, registerType: extReg.registerType || 'holding' };
}

// ── Unified mapping cycle ─────────────────────────────────────────────

function runMappingCycle() {
  const { registerStates } = runtimeService.getRuntimeState();

  // All enabled mappings that are NOT purely external→internal (those are event-driven)
  const mappings = mappingRepository.list().filter((m) => {
    if (!m.enabled) return false;
    // New model: always run in the tick (external→internal handled differently)
    if (m.sourceType) return true;
    // Legacy model: only i2e and bidirectional run in tick
    return m.direction === 'internal_to_external' || m.direction === 'bidirectional';
  });

  for (const mapping of mappings) {
    try {
      const source = resolveSourceValue(mapping, registerStates);
      if (!source) continue; // variable has no value yet — skip without setting error

      const { value: rawInput, name: sourceName, lastReadAt } = source;
      const transformed = applyTransforms(rawInput, mapping.transforms);
      const writeResult = writeToTarget(mapping, transformed);
      const now = new Date().toISOString();

      const extAddr = writeResult.kind === 'split'
        ? `${writeResult.lowAddress}/${writeResult.highAddress}`
        : (writeResult.address ?? null);
      mappingStates[mapping.id] = {
        mappingId:        mapping.id,
        label:            mapping.label,
        direction:        mapping.direction || `${mapping.sourceType}→${mapping.targetType}`,
        sourceType:       mapping.sourceType || 'register',
        sourceValue:      rawInput,
        transformedValue: transformed,
        sourceName,
        externalAddress:  extAddr,
        externalDataType: writeResult.kind === 'split' ? 'split16' : (writeResult.dataType ?? null),
        status:           'ok',
        error:            null,
        lastUpdatedAt:    now,
        lastWriteAt:      now,
      };
    } catch (err) {
      // Clear value fields so stale data is not displayed alongside the error
      mappingStates[mapping.id] = {
        mappingId:        mapping.id,
        label:            mapping.label,
        sourceType:       mapping.sourceType || 'register',
        sourceValue:      null,
        transformedValue: null,
        sourceName:       mappingStates[mapping.id]?.sourceName ?? null,
        externalAddress:  mappingStates[mapping.id]?.externalAddress ?? null,
        externalDataType: mappingStates[mapping.id]?.externalDataType ?? null,
        status:           'error',
        error:            err.message,
        lastUpdatedAt:    new Date().toISOString(),
        lastWriteAt:      mappingStates[mapping.id]?.lastWriteAt ?? null,
      };
    }
  }

  // Purge stale mapping states
  const activeIds = new Set(mappingRepository.list().map((m) => m.id));
  for (const id of Object.keys(mappingStates)) {
    if (!activeIds.has(id)) delete mappingStates[id];
  }
}

// ── External → Internal write forwarding (event-driven) ──────────────

async function handleExternalWrite(address, words) {
  // FC06/FC10 only write holding registers; input registers are server-side write, client-side read-only
  const extRegs = externalRegisterRepository.getByAddress(address, 'holding');

  for (const extReg of extRegs) {
    if (!extReg.writable) continue;

    // Only legacy direction-based mappings handle e2i writes; new-model variable mappings do not.
    const mappings = mappingRepository.listByExternalRegisterId(extReg.id).filter(
      (m) => m.enabled
        && !m.sourceType  // skip new-model mappings (they are tick-driven only)
        && (m.direction === 'external_to_internal' || m.direction === 'bidirectional')
    );

    for (const mapping of mappings) {
      const key = mapping.id;
      try {
        const rawValue  = decodeWords(words, extReg.dataType);
        const transformed = applyTransforms(rawValue, mapping.transforms);

        const internalReg = registerRepository.getById(mapping.sourceRegisterId);
        if (!internalReg) throw new Error('Internal register not found');
        if (internalReg.registerType !== 'holding') {
          throw new Error(`Write forwarding only supports holding registers (got: ${internalReg.registerType})`);
        }

        const source = sourceRepository.getById(internalReg.sourceId);
        if (!source) throw new Error('Source for internal register not found');

        const encWords = encodeRegisterValue(transformed, internalReg.dataType);
        await writeClient.writeRegisterWords(source, internalReg.address, encWords);

        writeStates[key] = {
          mappingId:       mapping.id,
          label:           mapping.label,
          externalAddress: extReg.address,
          receivedValue:   rawValue,
          writtenValue:    transformed,
          targetAddress:   internalReg.address,
          error:           null,
          lastWriteAt:     new Date().toISOString(),
        };
      } catch (err) {
        writeStates[key] = {
          ...writeStates[key],
          mappingId:   mapping.id,
          label:       mapping.label,
          error:       err.message,
          lastWriteAt: new Date().toISOString(),
        };
      }
    }
  }
}

// ── Lifecycle ─────────────────────────────────────────────────────────

function startBridge() {
  if (_tickHandle) return;

  _writeUnlisten = externalServerService.onWrite((address, words) => {
    handleExternalWrite(address, words).catch((err) =>
      console.error('[BridgeService] write forwarding error:', err.message)
    );
  });

  _tickHandle = setInterval(() => {
    try {
      runMappingCycle();

      // Drive MQTT publish cycle on the same tick
      const { registerStates } = runtimeService.getRuntimeState();
      const mqttService = require('./mqttService');
      const watchdogService = require('./watchdogService');
      mqttService.runPublishCycle(registerStates, watchdogService.getWatchdogStates());
    } catch (err) {
      console.error('[BridgeService] tick error:', err.message);
    }
  }, BRIDGE_TICK_MS);

  runMappingCycle();
}

function stopBridge() {
  if (_tickHandle) { clearInterval(_tickHandle); _tickHandle = null; }
  if (_writeUnlisten) { _writeUnlisten(); _writeUnlisten = null; }
}

// ── Public state ──────────────────────────────────────────────────────

function getBridgeState() {
  return {
    mappingStates: { ...mappingStates },
    writeStates:   { ...writeStates },
  };
}

module.exports = { startBridge, stopBridge, getBridgeState };
