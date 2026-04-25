const { readCollection, updateCollection } = require('../persistence/jsonStore');

const COLLECTION = 'external_registers';

function list() {
  return readCollection(COLLECTION, []);
}

function getById(id) {
  return list().find((item) => item.id === id) || null;
}

function getByAddress(address, registerType) {
  return list().filter((item) => {
    if (item.address !== address) return false;
    if (registerType !== undefined && (item.registerType || 'holding') !== registerType) return false;
    return true;
  });
}

function create(reg) {
  updateCollection(COLLECTION, [], (items) => {
    items.push(reg);
    return items;
  });
  return reg;
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

module.exports = { list, getById, getByAddress, create, update, remove, COLLECTION };
