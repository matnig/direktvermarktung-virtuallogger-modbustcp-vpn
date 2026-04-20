const { readCollection, updateCollection } = require('../persistence/jsonStore');

const COLLECTION = 'virtual_variables';

function list() { return readCollection(COLLECTION, []); }

function getById(id) { return list().find((v) => v.id === id) || null; }

function getByName(name) { return list().find((v) => v.name === name) || null; }

function create(variable) {
  updateCollection(COLLECTION, [], (items) => { items.push(variable); return items; });
  return variable;
}

function update(id, updater) {
  let updated = null;
  updateCollection(COLLECTION, [], (items) => {
    const i = items.findIndex((v) => v.id === id);
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
    const next = items.filter((v) => v.id !== id);
    deleted = next.length !== items.length;
    return deleted ? next : items;
  });
  return deleted;
}

module.exports = { list, getById, getByName, create, update, remove, COLLECTION };
