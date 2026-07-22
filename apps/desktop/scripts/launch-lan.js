const { networkInterfaces } = require("os");
const { launchElectron } = require("./launch");

/** First non-internal IPv4 address (LAN), for LiveKit-friendly same-network web URL. */
function detectLanIp() {
  if (process.env.QCHAT_LAN_IP) return process.env.QCHAT_LAN_IP.trim();
  const nets = networkInterfaces();
  for (const entries of Object.values(nets)) {
    for (const net of entries || []) {
      const family = typeof net.family === "string" ? net.family : String(net.family);
      if (family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "127.0.0.1";
}

const lanIp = detectLanIp();
const port = process.env.QCHAT_WEB_PORT || "3000";
const webUrl = `http://${lanIp}:${port}`;

console.log(`[qchat-desktop] loading web UI at ${webUrl} (same LAN as LiveKit)`);

const electron = launchElectron([`--url=${webUrl}`, ...process.argv.slice(2)]);
electron.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
