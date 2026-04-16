class ProfileTemplate {
  constructor({
    id,
    name,
    providerKey,
    sourceDefaults = {},
    registerTemplates = [],
    description = '',
    createdAt,
    updatedAt,
  }) {
    this.id = id;
    this.name = name;
    this.providerKey = providerKey;
    this.sourceDefaults = sourceDefaults;
    this.registerTemplates = registerTemplates;
    this.description = description;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }
}

module.exports = ProfileTemplate;
