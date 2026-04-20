const { readCollection, updateCollection } = require('../persistence/jsonStore');

const COLLECTION = 'mappings';

function list() {
  return readCollection(COLLECTION, []);
}

function getById(id) {
  return list().find((item) => item.id === id) || null;
}

function listBySourceRegisterId(sourceRegisterId) {
  return list().filter((item) => item.sourceRegisterId === sourceRegisterId);
}

function listByExternalRegisterId(externalRegisterId) {
  return list().filter((item) => item.externalRegisterId === externalRegisterId);
}

function create(mapping) {
  updateCollection(COLLECTION, [], (items) => {
    items.push(mapping);
    return items;
  });
  return mapping;
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
  getById,
  listBySourceRegisterId,
  listByExternalRegisterId,
  create,
  update,
  remove,
  COLLECTION,
};
