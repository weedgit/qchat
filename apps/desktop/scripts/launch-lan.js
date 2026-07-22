const http = require("http");
const { networkInterfaces } = require("os");
const { launchElectron } = require("./launch");

/** Skip VPN / tunnel / docker-style addresses that are not the LAN used by LiveKit. */
function isSkippedAddress(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return true;
  const [a, b] = parts;
  // Loopback handled separately.
  if (a === 127) return true;
  // Docker / libvirt bridges commonly 172.17–172.18; keep other 172.16/12 as possible LAN.
  if (a === 172 && (b === 17 || b === 18)) return true;
  // Cisco Umbrella / some VPN "internet" ranges (198.18.0.0/15).
  if (a === 198 && (b === 18 || b === 19)) return true;
  // CGNAT / carrier (100.64.0.0/10) — often Tailscale/VPN-ish; skip unless forced.
  if (a === 100 && b >= 64 && b <= 127) return true;
  // Link-local.
  if (a === 169 && b === 254) return true;
  return false;
}

function isPreferredLan(ip) {
  const parts = ip.split(".").map(Number);
  const [a, b] = parts;
  if (a === 192 && b === 168) return 3; // best for typical home/lab LAN
  if (a === 10) return 2;
  if (a === 172 && b >= 16 && b <= 31) return 1;
  return 0;
}

function isIPv4(net) {
  return net.family === "IPv4" || net.family === 4 || String(net.family) === "4";
}

function listCandidateIps() {
  if (process.env.QCHAT_LAN_IP) {
    return [process.env.QCHAT_LAN_IP.trim()];
  }

  /** @type {{ address: string, score: number }[]} */
  const found = [];
  const nets = networkInterfaces();
  for (const [name, entries] of Object.entries(nets)) {
    const lower = String(name || "").toLowerCase();
    if (
      lower.startsWith("docker") ||
      lower.startsWith("br-") ||
      lower.startsWith("veth") ||
      lower.includes("vpn") ||
      lower.includes("tun") ||
      lower.includes("tap") ||
      lower.includes("wg")
    ) {
      continue;
    }
    for (const net of entries || []) {
      if (!isIPv4(net) || net.internal) continue;
      if (isSkippedAddress(net.address)) continue;
      const score = isPreferredLan(net.address);
      if (score <= 0) continue;
      found.push({ address: net.address, score });
    }
  }

  found.sort((a, b) => b.score - a.score);
  const unique = [];
  for (const item of found) {
    if (!unique.includes(item.address)) unique.push(item.address);
  }
  return unique;
}

function canReachWeb(ip, port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: ip, port, path: "/", timeout: timeoutMs },
      (res) => {
        res.resume();
        resolve(true);
      }
    );
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

async function resolveWebUrl() {
  const port = process.env.QCHAT_WEB_PORT || "3000";
  const candidates = [...listCandidateIps(), "127.0.0.1"];

  for (const ip of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await canReachWeb(ip, Number(port));
    if (ok) {
      return { webUrl: `http://${ip}:${port}`, ip, port };
    }
    console.warn(`[qchat-desktop] web UI not reachable at http://${ip}:${port}`);
  }

  return null;
}

async function main() {
  const resolved = await resolveWebUrl();
  if (!resolved) {
    console.error(
      "[qchat-desktop] Could not reach apps/web on LAN or localhost:3000.\n" +
        "Start the web app first: cd apps/web && npm run dev\n" +
        "Or force an IP: QCHAT_LAN_IP=192.168.1.124 npm run start:lan"
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `[qchat-desktop] loading web UI at ${resolved.webUrl} (LAN-friendly for LiveKit)`
  );

  const electron = launchElectron([`--url=${resolved.webUrl}`, ...process.argv.slice(2)]);
  electron.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
