class VpnConfig {
  constructor({
    type = 'openvpn',
    enabled = false,
    remoteHost = '',
    username = '',
    // uploadedProfile carries metadata about the stored .ovpn file — no content
    uploadedProfile = null,
    createdAt,
    updatedAt,
  } = {}) {
    this.type = type;
    this.enabled = enabled;
    this.remoteHost = remoteHost;
    this.username = username;
    this.uploadedProfile = uploadedProfile || {
      exists: false,
      filename: null,
      uploadedAt: null,
      sizeBytes: null,
    };
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }
}

module.exports = VpnConfig;
