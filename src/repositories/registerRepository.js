const { readCollection, updateCollection } = require('../persistence/jsonStore');

const COLLECTION = 'registers';

function list() {
  return readCollection(COLLECTION, []);
}

function listBySourceId(sourceId) {
  return list().filter((item) => item.sourceId === sourceId);
}

function getById(id) {
  return list().find((item) => item.id === id) || null;
}

function create(registerDefinition) {
  updateCollection(COLLECTION, [], (items) => {
    items.push(registerDefinition);
    return items;
  });

  return registerDefinition;
}

function update(id, updater) {
  let updated = null;

  updateCollection(COLLECTION, [], (items) => {
    const index = items.findIndex((item) => item.id === id);
    if (index === -1) return items;

    updated = updater(items[index]);
    items[index] = updated;
    return items;
  });

  return updated;
}

function remove(id) {
  let deleted = false;

  updateCollection(COLLECTION, [], (items) => {
    const next = items.filter((item) => item.id !== id);
    deleted = next.length !== items.length;
    return deleted ? next : items;
  });

  return deleted;
}

module.exports = {
  list,
  listBySourceId,
  getById,
  create,
  update,
  remove,
};
