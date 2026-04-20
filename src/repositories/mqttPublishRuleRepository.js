const { readCollection, updateCollection } = require('../persistence/jsonStore');

const COLLECTION = 'mqtt_publish_rules';

function list() { return readCollection(COLLECTION, []); }

function getById(id) { return list().find((r) => r.id === id) || null; }

function create(rule) {
  updateCollection(COLLECTION, [], (items) => { items.push(rule); return items; });
  return rule;
}

function update(id, updater) {
  let updated = null;
  updateCollection(COLLECTION, [], (items) => {
    const i = items.findIndex((r) => r.id === id);
    if (i === -1) return items;
    updated = updater(items[i]);
    items[i] = updated;
    return items;
  });
  return updated;
}

function remove(id) {
  let deleted = false;
  updateCollection(COLLECTION, [], (items) => {
    const next = items.filter((r) => r.id !== id);
    deleted = next.length !== items.length;
    return deleted ? next : items;
  });
  return deleted;
}

module.exports = { list, getById, create, update, remove, COLLECTION };
