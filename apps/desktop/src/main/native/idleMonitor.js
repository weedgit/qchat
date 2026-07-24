const { app, powerMonitor } = require("electron");
const { IPC } = require("../../shared/ipc/channels");

/**
 * AUTH-04 — Mattermost-style idle monitor (UserActivityMonitor).
 * Emits activity to the renderer; web bridges idle → away / active → online.
 */

const DEFAULTS = {
  /** Poll powerMonitor.getSystemIdleTime. */
  updateFrequencyMs: 1000,
  /** Idle seconds before considered inactive (5 minutes). */
  inactiveThresholdSec: 5 * 60,
};

/** @type {ReturnType<typeof setInterval> | null} */
let intervalId = null;
/** @type {boolean} */
let isActive = true;
/** @type {number} */
let idleTimeSec = 0;
/** @type {() => Electron.BrowserWindow | null} */
let getMainWindow = () => null;
/** @type {boolean} */
let powerHooksBound = false;

/**
 * @param {{ userIsActive: boolean, idleTime: number, isSystemEvent?: boolean }} payload
 */
function broadcast(payload) {
  const win = typeof getMainWindow === "function" ? getMainWindow() : null;
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents.send(IPC.USER_ACTIVITY_UPDATE, payload);
  } catch {
    /* ignore */
  }
}

/**
 * @param {boolean} nextActive
 * @param {boolean} [isSystemEvent]
 */
function setActivityState(nextActive, isSystemEvent = false) {
  if (nextActive === isActive && !isSystemEvent) return;
  isActive = nextActive;
  broadcast({
    userIsActive: isActive,
    idleTime: idleTimeSec,
    isSystemEvent: Boolean(isSystemEvent),
  });
}

function tick() {
  try {
    idleTimeSec = Number(powerMonitor.getSystemIdleTime()) || 0;
  } catch (err) {
    console.warn(
      "[qchat-desktop] getSystemIdleTime failed:",
      err?.message || err
    );
    return;
  }
  if (idleTimeSec >= DEFAULTS.inactiveThresholdSec) {
    setActivityState(false, false);
  } else {
    setActivityState(true, false);
  }
}

function bindPowerHooks() {
  if (powerHooksBound) return;
  powerHooksBound = true;
  const goInactive = () => {
    idleTimeSec = Math.max(idleTimeSec, DEFAULTS.inactiveThresholdSec);
    setActivityState(false, true);
  };
  const goActive = () => {
    idleTimeSec = 0;
    setActivityState(true, true);
  };
  try {
    powerMonitor.on("lock-screen", goInactive);
    powerMonitor.on("suspend", goInactive);
    powerMonitor.on("unlock-screen", goActive);
    powerMonitor.on("resume", goActive);
  } catch (err) {
    console.warn(
      "[qchat-desktop] powerMonitor hooks failed:",
      err?.message || err
    );
  }
}

/**
 * @param {object} deps
 * @param {() => Electron.BrowserWindow | null} deps.getMainWindow
 */
function startIdleMonitor(deps) {
  if (typeof deps?.getMainWindow === "function") {
    getMainWindow = deps.getMainWindow;
  }
  if (!app.isReady()) {
    app.whenReady().then(() => startIdleMonitor(deps));
    return;
  }
  if (intervalId != null) return;

  bindPowerHooks();
  intervalId = setInterval(tick, DEFAULTS.updateFrequencyMs);
  tick();
}

function stopIdleMonitor() {
  if (intervalId != null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

module.exports = {
  startIdleMonitor,
  stopIdleMonitor,
  DEFAULTS,
};
