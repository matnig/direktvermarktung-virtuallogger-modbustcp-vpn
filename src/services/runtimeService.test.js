const test = require('node:test');
const assert = require('node:assert/strict');

const { createRuntimeService } = require('./runtimeService');

function createNow(initialIso) {
  let current = new Date(initialIso).getTime();

  return {
    now: () => new Date(current),
    advance: (milliseconds) => {
      current += milliseconds;
    },
  };
}

test('pollOnce reads enabled sources and computes runtime state', async () => {
  const clock = createNow('2024-01-01T00:00:00.000Z');
  const sources = [
    {
      id: 'source-1',
      name: 'Inverter A',
      host: '127.0.0.1',
      port: 502,
      unitId: 1,
      pollingIntervalMs: 1000,
      enabled: true,
    },
  ];
  const registers = [
    {
      id: 'register-1',
      sourceId: 'source-1',
      name: 'Power',
      registerType: 'holding',
      address: 0,
      length: 1,
      dataType: 'uint16',
      scale: 1,
      precision: 0,
      unit: 'kW',
    },
  ];
  const runtimeService = createRuntimeService({
    sourceService: {
      listSources: () => sources,
    },
    registerService: {
      listRegisters: (sourceId) => registers.filter((registerDefinition) => registerDefinition.sourceId === sourceId),
    },
    client: {
      readRegister: async () => ({ data: [42] }),
    },
    now: clock.now,
  });

  await runtimeService.pollOnce();

  const state = runtimeService.getRuntimeState();
  assert.equal(state.polling, false);
  assert.deepEqual(state.lastCompletedSourceIds, ['source-1']);
  assert.equal(state.sourceStates['source-1'].lastError, null);
  assert.equal(state.sourceStates['source-1'].lastSuccessAt, '2024-01-01T00:00:00.000Z');
  assert.equal(state.sourceStates['source-1'].nextPollAt, '2024-01-01T00:00:01.000Z');
  assert.equal(state.registerStates['register-1'].scaledValue, 42);
  assert.equal(state.registerStates['register-1'].formattedValue, '42 kW');
});

test('pollOnce does not overlap concurrent polls', async () => {
  const clock = createNow('2024-01-01T00:00:00.000Z');
  let readCount = 0;
  let resolveRead;

  const runtimeService = createRuntimeService({
    sourceService: {
      listSources: () => [
        {
          id: 'source-1',
          name: 'Inverter A',
          host: '127.0.0.1',
          port: 502,
          unitId: 1,
          pollingIntervalMs: 1000,
          enabled: true,
        },
      ],
    },
    registerService: {
      listRegisters: () => [
        {
          id: 'register-1',
          sourceId: 'source-1',
          name: 'Power',
          registerType: 'holding',
          address: 0,
          length: 1,
          dataType: 'uint16',
          scale: 1,
          precision: 0,
        },
      ],
    },
    client: {
      readRegister: () => {
        readCount += 1;
        return new Promise((resolve) => {
          resolveRead = resolve;
        });
      },
    },
    now: clock.now,
  });

  const firstPoll = runtimeService.pollOnce();
  const secondPoll = runtimeService.pollOnce();

  assert.strictEqual(firstPoll, secondPoll);
  assert.equal(readCount, 1);

  resolveRead({ data: [7] });
  await firstPoll;

  const state = runtimeService.getRuntimeState();
  assert.equal(state.registerStates['register-1'].scaledValue, 7);
});

test('pollOnce removes stale source and register state when configuration changes', async () => {
  const clock = createNow('2024-01-01T00:00:00.000Z');
  let sources = [
    {
      id: 'source-1',
      name: 'Inverter A',
      host: '127.0.0.1',
      port: 502,
      unitId: 1,
      pollingIntervalMs: 1000,
      enabled: true,
    },
  ];
  let registers = [
    {
      id: 'register-1',
      sourceId: 'source-1',
      name: 'Power',
      registerType: 'holding',
      address: 0,
      length: 1,
      dataType: 'uint16',
      scale: 1,
      precision: 0,
    },
  ];

  const runtimeService = createRuntimeService({
    sourceService: {
      listSources: () => sources,
    },
    registerService: {
      listRegisters: (sourceId) => registers.filter((registerDefinition) => registerDefinition.sourceId === sourceId),
    },
    client: {
      readRegister: async () => ({ data: [1] }),
    },
    now: clock.now,
  });

  await runtimeService.pollOnce();
  assert.ok(runtimeService.getRuntimeState().sourceStates['source-1']);
  assert.ok(runtimeService.getRuntimeState().registerStates['register-1']);

  sources = [];
  registers = [];
  clock.advance(1000);

  await runtimeService.pollOnce();

  const state = runtimeService.getRuntimeState();
  assert.deepEqual(state.sourceStates, {});
  assert.deepEqual(state.registerStates, {});
  assert.deepEqual(state.lastCompletedSourceIds, []);
});
