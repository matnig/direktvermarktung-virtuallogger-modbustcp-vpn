const { v4: uuidv4 } = require('uuid');
const RegisterDefinition = require('../domain/RegisterDefinition');
const registerRepository = require('../repositories/registerRepository');
const sourceRepository = require('../repositories/sourceRepository');
const { validateRegister } = require('../validation/registerValidation');

function listRegisters(sourceId) {
  return sourceId ? registerRepository.listBySourceId(sourceId) : registerRepository.list();
}

function getRegister(id) {
  return registerRepository.getById(id);
}

function createRegister(payload) {
  const validation = validateRegister(payload);
  if (!validation.isValid) {
    return { errors: validation.errors };
  }

  const source = sourceRepository.getById(payload.sourceId);
  if (!source) {
    return { errors: ['sourceId does not reference an existing source'] };
  }

  const timestamp = new Date().toISOString();
  const register = new RegisterDefinition({
    id: uuidv4(),
    sourceId: payload.sourceId,
    name: String(payload.name).trim(),
    registerType: payload.registerType,
    address: Number(payload.address),
    length: Number(payload.length),
    dataType: payload.dataType,
    scale: Number(payload.scale ?? 1),
    precision: Number(payload.precision ?? 0),
    unit: String(payload.unit || '').trim(),
    signed: Boolean(payload.signed),
    byteOrder: payload.byteOrder || 'big-endian',
    wordOrder: payload.wordOrder || 'big-endian',
    description: String(payload.description || '').trim(),
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  return { data: registerRepository.create(register) };
}

function updateRegister(id, payload) {
  const validation = validateRegister(payload);
  if (!validation.isValid) {
    return { errors: validation.errors };
  }

  const source = sourceRepository.getById(payload.sourceId);
  if (!source) {
    return { errors: ['sourceId does not reference an existing source'] };
  }

  const updated = registerRepository.update(id, (current) => ({
    ...current,
    sourceId: payload.sourceId,
    name: String(payload.name).trim(),
    registerType: payload.registerType,
    address: Number(payload.address),
    length: Number(payload.length),
    dataType: payload.dataType,
    scale: Number(payload.scale ?? 1),
    precision: Number(payload.precision ?? 0),
    unit: String(payload.unit || '').trim(),
    signed: Boolean(payload.signed),
    byteOrder: payload.byteOrder || 'big-endian',
    wordOrder: payload.wordOrder || 'big-endian',
    description: String(payload.description || '').trim(),
    updatedAt: new Date().toISOString(),
  }));

  if (!updated) return { notFound: true };
  return { data: updated };
}

function deleteRegister(id) {
  const deleted = registerRepository.remove(id);
  return { deleted };
}

module.exports = {
  listRegisters,
  getRegister,
  createRegister,
  updateRegister,
  deleteRegister,
};
