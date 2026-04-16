const { v4: uuidv4 } = require('uuid');
const ProfileTemplate = require('../domain/ProfileTemplate');
const profileRepository = require('../repositories/profileRepository');
const sourceRepository = require('../repositories/sourceRepository');
const { validateProfile } = require('../validation/profileValidation');
const registerService = require('./registerService');

function listProfiles() {
  return profileRepository.list();
}

function getProfile(id) {
  return profileRepository.getById(id);
}

function createProfile(payload) {
  const validation = validateProfile(payload);
  if (!validation.isValid) {
    return { errors: validation.errors };
  }

  const timestamp = new Date().toISOString();
  const profile = new ProfileTemplate({
    id: uuidv4(),
    name: String(payload.name).trim(),
    providerKey: String(payload.providerKey).trim(),
    sourceDefaults: payload.sourceDefaults || {},
    registerTemplates: Array.isArray(payload.registerTemplates) ? payload.registerTemplates : [],
    description: String(payload.description || '').trim(),
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  return { data: profileRepository.create(profile) };
}

function updateProfile(id, payload) {
  const validation = validateProfile(payload);
  if (!validation.isValid) {
    return { errors: validation.errors };
  }

  const updated = profileRepository.update(id, (current) => ({
    ...current,
    name: String(payload.name).trim(),
    providerKey: String(payload.providerKey).trim(),
    sourceDefaults: payload.sourceDefaults || {},
    registerTemplates: Array.isArray(payload.registerTemplates) ? payload.registerTemplates : [],
    description: String(payload.description || '').trim(),
    updatedAt: new Date().toISOString(),
  }));

  if (!updated) return { notFound: true };
  return { data: updated };
}

function deleteProfile(id) {
  const deleted = profileRepository.remove(id);
  return { deleted };
}

function applyProfile(profileId, sourceId, options = {}) {
  const profile = profileRepository.getById(profileId);
  if (!profile) return { notFound: 'profile' };

  const source = sourceRepository.getById(sourceId);
  if (!source) return { notFound: 'source' };

  if (options.mergeSourceDefaults && profile.sourceDefaults && Object.keys(profile.sourceDefaults).length > 0) {
    const allowed = ['port', 'unitId', 'pollingIntervalMs', 'description'];
    const patch = Object.fromEntries(
      Object.entries(profile.sourceDefaults).filter(([k]) => allowed.includes(k))
    );
    if (Object.keys(patch).length > 0) {
      sourceRepository.update(sourceId, (current) => ({
        ...current,
        ...patch,
        updatedAt: new Date().toISOString(),
      }));
    }
  }

  const created = [];
  const skipped = [];

  for (const template of profile.registerTemplates || []) {
    const result = registerService.createRegister({ ...template, sourceId });
    if (result.errors) {
      skipped.push({ template, errors: result.errors });
    } else {
      created.push(result.data);
    }
  }

  return { created, skipped };
}

module.exports = {
  listProfiles,
  getProfile,
  createProfile,
  updateProfile,
  deleteProfile,
  applyProfile,
};
