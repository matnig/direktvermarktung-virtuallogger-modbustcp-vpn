const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('../config/appConfig');

const cache = new Map();

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function filePath(name) {
  ensureDir();
  return path.join(DATA_DIR, `${name}.json`);
}

function normalizeFallback(fallback) {
  return Array.isArray(fallback) ? [...fallback] : fallback;
}

function loadCollection(name, fallback = []) {
  if (cache.has(name)) {
    return cache.get(name);
  }

  const target = filePath(name);
  const defaultValue = normalizeFallback(fallback);

  if (!fs.existsSync(target)) {
    writeCollection(name, defaultValue);
    return cache.get(name);
  }

  try {
    const raw = fs.readFileSync(target, 'utf8');
    const parsed = raw ? JSON.parse(raw) : defaultValue;
    cache.set(name, parsed);
    return parsed;
  } catch (error) {
    throw new Error(`Failed to load JSON collection "${name}": ${error.message}`);
  }
}

function readCollection(name, fallback = []) {
  const data = loadCollection(name, fallback);
  return cloneValue(data);
}

function writeCollection(name, data) {
  const target = filePath(name);
  const next = cloneValue(data);

  try {
    fs.writeFileSync(target, JSON.stringify(next, null, 2));
    cache.set(name, next);
    return cloneValue(next);
  } catch (error) {
    throw new Error(`Failed to write JSON collection "${name}": ${error.message}`);
  }
}

function updateCollection(name, fallback, updater) {
  const current = loadCollection(name, fallback);
  const next = updater(cloneValue(current));
  return writeCollection(name, next);
}

function initializeCollections(definitions) {
  definitions.forEach(({ name, fallback = [] }) => {
    loadCollection(name, fallback);
  });
}

module.exports = {
  initializeCollections,
  readCollection,
  updateCollection,
  writeCollection,
};
