const { v4: uuidv4 } = require('uuid');
const ModbusSource = require('../domain/ModbusSource');
const sourceRepository = require('../repositories/sourceRepository');
const { validateSource } = require('../validation/sourceValidation');

function listSources() {
  return sourceRepository.list();
}

function getSource(id) {
  return sourceRepository.getById(id);
}

function createSource(payload) {
  const validation = validateSource(payload);
  if (!validation.isValid) {
    return { errors: validation.errors };
  }

  const timestamp = new Date().toISOString();
  const source = new ModbusSource({
    id: uuidv4(),
    name: String(payload.name).trim(),
    host: String(payload.host).trim(),
    port: Number(payload.port),
    unitId: Number(payload.unitId),
    pollingIntervalMs: Number(payload.pollingIntervalMs),
    enabled: payload.enabled !== false,
    description: String(payload.description || '').trim(),
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  return { data: sourceRepository.create(source) };
}

function updateSource(id, payload) {
  const validation = validateSource(payload);
  if (!validation.isValid) {
    return { errors: validation.errors };
  }

  const updated = sourceRepository.update(id, (current) => ({
    ...current,
    name: String(payload.name).trim(),
    host: String(payload.host).trim(),
    port: Number(payload.port),
    unitId: Number(payload.unitId),
    pollingIntervalMs: Number(payload.pollingIntervalMs),
    enabled: payload.enabled !== false,
    description: String(payload.description || '').trim(),
    updatedAt: new Date().toISOString(),
  }));

  if (!updated) return { notFound: true };
  return { data: updated };
}

function deleteSource(id) {
  const deleted = sourceRepository.remove(id);
  return { deleted };
}

module.exports = {
  listSources,
  getSource,
  createSource,
  updateSource,
  deleteSource,
};
