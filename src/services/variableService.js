const virtualVariableRepository = require('../repositories/virtualVariableRepository');

// In-memory runtime state per variable
const variableStates = {};

// ── Runtime state ─────────────────────────────────────────────────────

function getVariableState(id) {
  return variableStates[id] || null;
}

function getAllVariableStates() {
  // Merge definition + runtime state
  const definitions = virtualVariableRepository.list();
  return definitions.map((def) => ({
    ...def,
    ...(variableStates[def.id] || {
      variableId:    def.id,
      currentValue:  def.initialValue ?? null,
      lastUpdatedAt: null,
      source:        null,
      error:         null,
    }),
  }));
}

// ── Mutation ──────────────────────────────────────────────────────────

function setValue(id, value, source = 'system') {
  const def = virtualVariableRepository.getById(id);
  if (!def || !def.enabled) return false;

  variableStates[id] = {
    variableId:    id,
    currentValue:  value,
    lastUpdatedAt: new Date().toISOString(),
    source,
    error:         null,
  };
  return true;
}

function setError(id, errorMessage) {
  variableStates[id] = {
    ...(variableStates[id] || { variableId: id }),
    error:         errorMessage,
    lastUpdatedAt: new Date().toISOString(),
  };
}

// Called after a variable is deleted — purge runtime state
function purgeState(id) {
  delete variableStates[id];
}

// Seed initial values from definitions on startup
function initVariableStates() {
  for (const def of virtualVariableRepository.list()) {
    if (!variableStates[def.id] && def.initialValue !== null && def.initialValue !== undefined) {
      variableStates[def.id] = {
        variableId:    def.id,
        currentValue:  def.initialValue,
        lastUpdatedAt: new Date().toISOString(),
        source:        'initial',
        error:         null,
      };
    }
  }
}

module.exports = {
  getVariableState,
  getAllVariableStates,
  setValue,
  setError,
  purgeState,
  initVariableStates,
};
