const {
  isEncryptionAvailable,
  getSecureSession,
  setSecureSession,
  clearSecureSession,
} = require("../../secureStorage");

/**
 * @param {string} webUrl
 */
function createSecureStorageHandlers(webUrl) {
  return {
    available: async () => ({
      available: true,
      encryption: isEncryptionAvailable(),
    }),
    get: async () => getSecureSession(webUrl),
    set: async (_event, payload) => {
      const accessToken = String(payload?.accessToken || "").trim();
      const refreshToken = String(payload?.refreshToken || "").trim();
      if (!accessToken) {
        clearSecureSession(webUrl);
        return { ok: true };
      }
      setSecureSession(webUrl, { accessToken, refreshToken });
      return { ok: true };
    },
    clear: async () => {
      clearSecureSession(webUrl);
      return { ok: true };
    },
  };
}

module.exports = { createSecureStorageHandlers };
