const watchdogRepository        = require('../repositories/watchdogRepository');
const externalRegisterRepository = require('../repositories/externalRegisterRepository');
const externalServerService     = require('./externalServerService');
const { decodeWords }           = require('../modbus/encodeRegisterValue');

const WATCHDOG_TICK_MS = 1000;

// state: 'ok' | 'stale' | 'disabled' | 'error'
const watchdogStates = {};

let _tickHandle = null;

function runWatchdogCycle() {
  const watchdogs = watchdogRepository.list();

  for (const wd of watchdogs) {
    if (!wd.enabled) {
      watchdogStates[wd.id] = {
        watchdogId:    wd.id,
        label:         wd.label,
        state:         'disabled',
        lastChangedAt: watchdogStates[wd.id]?.lastChangedAt || null,
        lastValue:     watchdogStates[wd.id]?.lastValue ?? null,
        error:         null,
      };
      continue;
    }

    const extReg = externalRegisterRepository.getById(wd.externalRegisterId);
    if (!extReg) {
      watchdogStates[wd.id] = {
        watchdogId: wd.id,
        label:      wd.label,
        state:      'error',
        error:      'External register not found',
        lastChangedAt: null,
        lastValue:     null,
      };
      continue;
    }

    try {
      const words   = externalServerService.readWords(extReg.address, extReg.length);
      const current = decodeWords(words, extReg.dataType);
      const prev    = watchdogStates[wd.id];

      const now = Date.now();

      if (!prev || prev.lastValue === undefined || prev.lastValue === null) {
        // First observation — initialise
        watchdogStates[wd.id] = {
          watchdogId:    wd.id,
          label:         wd.label,
          state:         'ok',
          lastChangedAt: new Date(now).toISOString(),
          lastValue:     current,
          error:         null,
        };
      } else if (current !== prev.lastValue) {
        // Value changed → reset timer
        watchdogStates[wd.id] = {
          ...prev,
          state:         'ok',
          lastChangedAt: new Date(now).toISOString(),
          lastValue:     current,
          error:         null,
        };
      } else {
        // Value unchanged — check timeout
        const elapsed = now - Date.parse(prev.lastChangedAt);
        // Guard: Date.parse returns NaN for invalid strings → treat as ok (fresh observation)
        const isStale = Number.isFinite(elapsed) && elapsed >= wd.timeoutMs;
        watchdogStates[wd.id] = {
          ...prev,
          state:     isStale ? 'stale' : 'ok',
          lastValue: current,
          error:     null,
        };
      }
    } catch (err) {
      watchdogStates[wd.id] = {
        watchdogId: wd.id,
        label:      wd.label,
        state:      'error',
        error:      err.message,
        lastChangedAt: watchdogStates[wd.id]?.lastChangedAt || null,
        lastValue:     watchdogStates[wd.id]?.lastValue ?? null,
      };
    }
  }

  // Purge states for deleted watchdogs
  const activeIds = new Set(watchdogs.map((w) => w.id));
  for (const id of Object.keys(watchdogStates)) {
    if (!activeIds.has(id)) delete watchdogStates[id];
  }
}

function startWatchdog() {
  if (_tickHandle) return;
  _tickHandle = setInterval(() => {
    try { runWatchdogCycle(); } catch (err) {
      console.error('[WatchdogService] tick error:', err.message);
    }
  }, WATCHDOG_TICK_MS);
  runWatchdogCycle();
}

function stopWatchdog() {
  if (_tickHandle) { clearInterval(_tickHandle); _tickHandle = null; }
}

function getWatchdogStates() {
  return { ...watchdogStates };
}

module.exports = { startWatchdog, stopWatchdog, getWatchdogStates };
