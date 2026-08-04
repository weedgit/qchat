#!/usr/bin/env node
/**
 * Start both iPhone-dev proxies: API (:9080) + LiveKit signaling (:7444).
 */
const { spawn } = require("child_process");
const path = require("path");

const dir = __dirname;
const kids = [
  spawn(process.execPath, [path.join(dir, "dev-api-proxy.js")], {
    stdio: "inherit",
  }),
  spawn(process.execPath, [path.join(dir, "dev-livekit-proxy.js")], {
    stdio: "inherit",
  }),
];

function shutdown(code) {
  for (const c of kids) {
    try {
      c.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  process.exit(code);
}

for (const c of kids) {
  c.on("exit", (code) => {
    if (code) shutdown(code);
  });
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
