const defaultSourceService = require('./sourceService');
const defaultRegisterService = require('./registerService');
const ModbusClient = require('../modbus/modbusClient');
const decodeRegisterValue = require('../modbus/decodeRegisterValue');

const RUNTIME_TICK_INTERVAL_MS = 250;
const DEFAULT_POLLING_INTERVAL_MS = 5000;

function createRuntimeService({
  sourceService = defaultSourceService,
  registerService = defaultRegisterService,
  client = new ModbusClient(),
  now = () => new Date(),
} = {}) {
  const runtimeState = {
    running: false,
    polling: false,
    schedulerIntervalMs: RUNTIME_TICK_INTERVAL_MS,
    nextScheduledPollAt: null,
    cycleStartedAt: null,
    cycleFinishedAt: null,
    sourceStates: {},
    registerStates: {},
    lastCompletedSourceIds: [],
    lastError: null,
  };

  let intervalHandle = null;
  let pollPromise = null;

  function nowIso() {
    return now().toISOString();
  }

  function getPollingInterval(source) {
    return Math.max(250, Number(source.pollingIntervalMs || DEFAULT_POLLING_INTERVAL_MS));
  }

  function getEnabledSources() {
    return sourceService.listSources().filter((source) => source.enabled !== false);
  }

  function syncConfigurationState(enabledSources = getEnabledSources()) {
    const activeSourceIds = new Set(enabledSources.map((source) => source.id));

    for (const sourceId of Object.keys(runtimeState.sourceStates)) {
      if (!activeSourceIds.has(sourceId)) {
        delete runtimeState.sourceStates[sourceId];
      }
    }

    const activeRegisterIds = new Set();
    for (const source of enabledSources) {
      const sourceRegisters = registerService.listRegisters(source.id);
      sourceRegisters.forEach((registerDefinition) => activeRegisterIds.add(registerDefinition.id));
    }

    for (const registerId of Object.keys(runtimeState.registerStates)) {
      if (!activeRegisterIds.has(registerId)) {
        delete runtimeState.registerStates[registerId];
      }
    }

    return enabledSources;
  }

  function updateNextPollAt(source, baseTime = now()) {
    const sourceState = runtimeState.sourceStates[source.id] || {};
    sourceState.nextPollAt = new Date(baseTime.getTime() + getPollingInterval(source)).toISOString();
    runtimeState.sourceStates[source.id] = sourceState;
  }

  function refreshNextScheduledPollAt() {
    const enabledSources = syncConfigurationState();
    if (!runtimeState.running || enabledSources.length === 0) {
      runtimeState.nextScheduledPollAt = null;
      return;
    }

    const nextTimes = enabledSources
      .map((source) => runtimeState.sourceStates[source.id]?.nextPollAt)
      .filter(Boolean)
      .map((value) => Date.parse(value))
      .filter((value) => Number.isFinite(value));

    runtimeState.nextScheduledPollAt = new Date(
      nextTimes.length > 0 ? Math.min(...nextTimes) : now().getTime()
    ).toISOString();
  }

  async function pollSource(source) {
    const sourceRegisters = registerService.listRegisters(source.id);
    const sourceState = {
      ...runtimeState.sourceStates[source.id],
      sourceId: source.id,
      name: source.name,
      host: source.host,
      port: source.port,
      unitId: source.unitId,
      pollingIntervalMs: getPollingInterval(source),
      registerCount: sourceRegisters.length,
      lastAttemptAt: nowIso(),
      lastSuccessAt: runtimeState.sourceStates[source.id]?.lastSuccessAt || null,
      lastError: null,
    };

    runtimeState.sourceStates[source.id] = sourceState;

    if (sourceRegisters.length === 0) {
      sourceState.lastSuccessAt = sourceState.lastAttemptAt;
      updateNextPollAt(source);
      return;
    }

    let sourceHadSuccess = false;

    for (const registerDefinition of sourceRegisters) {
      try {
        const response = await client.readRegister(source, registerDefinition);
        const decoded = decodeRegisterValue(registerDefinition, response);

        runtimeState.registerStates[registerDefinition.id] = {
          registerId: registerDefinition.id,
          sourceId: source.id,
          name: registerDefinition.name,
          registerType: registerDefinition.registerType,
          address: registerDefinition.address,
          dataType: registerDefinition.dataType,
          unit: registerDefinition.unit || '',
          rawValue: decoded.rawValue,
          scaledValue: decoded.scaledValue,
          formattedValue: decoded.formattedValue,
          lastReadAt: nowIso(),
          error: null,
        };

        sourceHadSuccess = true;
      } catch (error) {
        runtimeState.registerStates[registerDefinition.id] = {
          registerId: registerDefinition.id,
          sourceId: source.id,
          name: registerDefinition.name,
          registerType: registerDefinition.registerType,
          address: registerDefinition.address,
          dataType: registerDefinition.dataType,
          unit: registerDefinition.unit || '',
          rawValue: null,
          scaledValue: null,
          formattedValue: null,
          lastReadAt: nowIso(),
          error: error.message,
        };

        sourceState.lastError = error.message;
        runtimeState.lastError = error.message;
      }
    }

    if (sourceHadSuccess) {
      sourceState.lastSuccessAt = nowIso();
    }

    updateNextPollAt(source);
  }

  function pollSources(sources) {
    if (pollPromise) {
      return pollPromise;
    }

    pollPromise = (async () => {
      runtimeState.polling = true;
      runtimeState.cycleStartedAt = nowIso();
      runtimeState.lastError = null;

      const enabledSources = syncConfigurationState();
      const enabledSourceIds = new Set(enabledSources.map((source) => source.id));
      const targetSources = sources.filter((source) => enabledSourceIds.has(source.id));

      for (const source of targetSources) {
        await pollSource(source);
      }

      runtimeState.lastCompletedSourceIds = targetSources.map((source) => source.id);
      runtimeState.cycleFinishedAt = nowIso();
      refreshNextScheduledPollAt();
    })().finally(() => {
      runtimeState.polling = false;
      pollPromise = null;
    });

    return pollPromise;
  }

  function getDueSources() {
    const currentTimestamp = now().getTime();
    const enabledSources = syncConfigurationState();

    return enabledSources.filter((source) => {
      const nextPollAt = runtimeState.sourceStates[source.id]?.nextPollAt;
      return !nextPollAt || Date.parse(nextPollAt) <= currentTimestamp;
    });
  }

  async function tickRuntime() {
    if (!runtimeState.running || pollPromise) {
      return;
    }

    const dueSources = getDueSources();
    if (dueSources.length === 0) {
      refreshNextScheduledPollAt();
      return;
    }

    await pollSources(dueSources);
  }

  function startRuntime() {
    if (intervalHandle) {
      return;
    }

    runtimeState.running = true;
    syncConfigurationState();
    refreshNextScheduledPollAt();

    intervalHandle = setInterval(() => {
      tickRuntime().catch((error) => {
        runtimeState.lastError = error.message;
        runtimeState.polling = false;
      });
    }, RUNTIME_TICK_INTERVAL_MS);

    tickRuntime().catch((error) => {
      runtimeState.lastError = error.message;
      runtimeState.polling = false;
    });
  }

  function stopRuntime() {
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }

    runtimeState.running = false;
    runtimeState.polling = false;
    runtimeState.nextScheduledPollAt = null;
  }

  function getRuntimeState() {
    return {
      ...runtimeState,
      sourceStates: { ...runtimeState.sourceStates },
      registerStates: { ...runtimeState.registerStates },
      lastCompletedSourceIds: [...runtimeState.lastCompletedSourceIds],
    };
  }

  return {
    pollOnce: () => pollSources(getEnabledSources()),
    startRuntime,
    stopRuntime,
    getRuntimeState,
  };
}

const runtimeService = createRuntimeService();

module.exports = {
  ...runtimeService,
  createRuntimeService,
};
