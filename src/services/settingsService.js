const { readCollection, writeCollection } = require('../persistence/jsonStore');
const AppSettings = require('../domain/AppSettings');

const COLLECTION = 'settings';

function createDefaultSettings() {
  const timestamp = new Date().toISOString();
  return new AppSettings({
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

function getSettings() {
  const [stored] = readCollection(COLLECTION, [createDefaultSettings()]);
  return stored;
}

function updateSettings(payload) {
  const current = getSettings();
  const next = {
    ...current,
    ...payload,
    updatedAt: new Date().toISOString(),
  };
  writeCollection(COLLECTION, [next]);
  return next;
}

module.exports = {
  COLLECTION,
  createDefaultSettings,
  getSettings,
  updateSettings,
};
