const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const { DEFAULT_WINDOW } = require("./constants");

const WINDOW_STATE_FILE = "window-state.json";

function statePath() {
  return path.join(app.getPath("userData"), WINDOW_STATE_FILE);
}

function loadWindowState() {
  try {
    const state = JSON.parse(fs.readFileSync(statePath(), "utf8"));
    if (
      Number.isFinite(state.width) &&
      Number.isFinite(state.height) &&
      Number.isFinite(state.x ?? 0) &&
      Number.isFinite(state.y ?? 0)
    ) {
      return state;
    }
  } catch {
    // Missing or corrupt state falls back to a safe default.
  }
  return { ...DEFAULT_WINDOW };
}

function saveWindowState(window) {
  try {
    fs.writeFileSync(statePath(), JSON.stringify(window.getBounds(), null, 2));
  } catch {
    // Window persistence must never prevent shutdown.
  }
}

module.exports = { loadWindowState, saveWindowState };
