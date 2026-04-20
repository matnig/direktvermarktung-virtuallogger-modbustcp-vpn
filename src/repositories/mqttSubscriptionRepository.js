const { readCollection, updateCollection } = require('../persistence/jsonStore');

const COLLECTION = 'mqtt_subscriptions';

function list() { return readCollection(COLLECTION, []); }

function getById(id) { return list().find((s) => s.id === id) || null; }

function listByVariableId(variableId) { return list().filter((s) => s.variableId === variableId); }

function create(sub) {
  updateCollection(COLLECTION, [], (items) => { items.push(sub); return items; });
  return sub;
}

function update(id, updater) {
  let updated = null;
  updateCollection(COLLECTION, [], (items) => {
    const i = items.findIndex((s) => s.id === id);
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
    const next = items.filter((s) => s.id !== id);
    deleted = next.length !== items.length;
    return deleted ? next : items;
  });
  return deleted;
}

module.exports = { list, getById, listByVariableId, create, update, remove, COLLECTION };
