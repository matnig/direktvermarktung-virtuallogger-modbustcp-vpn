const { readCollection, writeCollection } = require('../persistence/jsonStore');
const EinspeisemanagementConfig = require('../domain/EinspeisemanagementConfig');

const COLLECTION = 'einspeisemanagement';

function createDefaultConfig() {
  const timestamp = new Date().toISOString();
  return new EinspeisemanagementConfig({
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

function getConfig() {
  const [stored] = readCollection(COLLECTION, [createDefaultConfig()]);
  // Durch den Konstruktor schicken, damit neu hinzugekommene Felder ihre Defaults bekommen
  return new EinspeisemanagementConfig(stored);
}

function updateConfig(payload) {
  const current = getConfig();
  // bindings tief mergen, damit Teil-Updates die übrigen Bindings nicht verwerfen
  const mergedBindings = payload.bindings
    ? { ...current.bindings, ...payload.bindings }
    : current.bindings;
  const next = new EinspeisemanagementConfig({
    ...current,
    ...payload,
    bindings: mergedBindings,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
  });
  writeCollection(COLLECTION, [next]);
  return next;
}

module.exports = {
  COLLECTION,
  createDefaultConfig,
  getConfig,
  updateConfig,
};
