class AppSettings {
  constructor({
    defaultPollingIntervalMs = 5000,
    apiBasePath = '/api',
    uiEnabled = true,
    createdAt,
    updatedAt,
  } = {}) {
    this.defaultPollingIntervalMs = defaultPollingIntervalMs;
    this.apiBasePath = apiBasePath;
    this.uiEnabled = uiEnabled;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }
}

module.exports = AppSettings;
