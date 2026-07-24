const {
  getNativeThemeState,
  setNativeThemeSource,
  normalizeThemeSource,
} = require("../../native/theme");

function createGetNativeThemeHandler() {
  return async () => getNativeThemeState();
}

function createSetNativeThemeSourceHandler() {
  return async (_event, source) => {
    const normalized = normalizeThemeSource(source);
    if (!normalized) return { ok: false };
    return { ok: setNativeThemeSource(normalized) };
  };
}

module.exports = {
  createGetNativeThemeHandler,
  createSetNativeThemeSourceHandler,
};
