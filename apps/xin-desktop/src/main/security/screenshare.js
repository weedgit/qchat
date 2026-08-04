const { desktopCapturer, session, systemPreferences } = require("electron");

/**
 * Enable Chromium getDisplayMedia inside the Electron shell (CALL-02).
 * LiveKit setScreenShareEnabled() uses navigator.mediaDevices.getDisplayMedia;
 * without this handler, screen share fails in desktop.
 *
 * Prefer the OS picker when Electron supports it; otherwise grant the primary
 * screen (or first window) via desktopCapturer.
 */
function registerScreenshareHandler() {
  const ses = session.defaultSession;
  if (typeof ses.setDisplayMediaRequestHandler !== "function") {
    console.warn(
      "[xinchat-desktop] setDisplayMediaRequestHandler unavailable; screen share will not work"
    );
    return;
  }

  const handler = async (request, callback) => {
    try {
      if (process.platform === "darwin" && systemPreferences.getMediaAccessStatus) {
        const status = systemPreferences.getMediaAccessStatus("screen");
        if (status === "denied") {
          console.warn("[xinchat-desktop] screen capture permission denied by macOS");
          callback({});
          return;
        }
      }

      const sources = await desktopCapturer.getSources({
        types: ["screen", "window"],
        // Skip thumbnails — faster and enough for auto-pick fallback.
        thumbnailSize: { width: 0, height: 0 },
      });
      if (!sources.length) {
        console.warn("[xinchat-desktop] no desktopCapturer sources");
        callback({});
        return;
      }

      const screen =
        sources.find((s) => String(s.id).startsWith("screen:")) || sources[0];
      /** @type {{ video: Electron.DesktopCapturerSource, audio?: string }} */
      const grant = { video: screen };
      // Loopback system audio when the page asked for it (best-effort).
      if (request?.audioRequested) {
        grant.audio = "loopback";
      }
      callback(grant);
    } catch (err) {
      console.warn(
        "[xinchat-desktop] display media handler failed:",
        err?.message || err
      );
      callback({});
    }
  };

  try {
    // Electron 32+: useSystemPicker uses the native picker when available
    // (handler may be skipped). Fallback handler covers Linux/Windows/older macOS.
    ses.setDisplayMediaRequestHandler(handler, { useSystemPicker: true });
  } catch {
    ses.setDisplayMediaRequestHandler(handler);
  }
}

module.exports = { registerScreenshareHandler };
