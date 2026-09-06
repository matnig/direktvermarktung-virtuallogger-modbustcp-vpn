const { readCollection, writeCollection } = require('../persistence/jsonStore');
const DashboardConfig = require('../domain/DashboardConfig');

const COLLECTION = 'dashboard';

function createDefaultConfig() {
  const timestamp = new Date().toISOString();
  return new DashboardConfig({ createdAt: timestamp, updatedAt: timestamp });
}

function getConfig() {
  const [stored] = readCollection(COLLECTION, [createDefaultConfig()]);
  return new DashboardConfig(stored);
}

function updateConfig(payload = {}) {
  const current = getConfig();
  const next = new DashboardConfig({
    ...current,
    ...payload,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
  });
  writeCollection(COLLECTION, [next]);
  return next;
}

module.exports = { COLLECTION, createDefaultConfig, getConfig, updateConfig };
