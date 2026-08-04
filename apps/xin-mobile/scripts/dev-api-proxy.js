#!/usr/bin/env node
/**
 * Cleartext LAN API proxy for iPhone when the VPS uses a self-signed cert.
 * Phone → http://<mac-lan>:9080 → https://135.181.224.36
 * Also proxies WebSocket (/v1/ws) so call.ring / chat events reach the phone.
 *
 * Usage: node scripts/dev-api-proxy.js
 */
const http = require("http");
const https = require("https");
const { URL } = require("url");

const LISTEN = Number(process.env.QCHAT_API_PROXY_PORT || 9080);
const UPSTREAM = (
  process.env.QCHAT_API_UPSTREAM || "https://135.181.224.36"
).replace(/\/$/, "");

function quietSocket(sock) {
  if (!sock || typeof sock.on !== "function") return;
  sock.on("error", (err) => {
    console.warn("[dev-api-proxy] socket:", err.code || err.message);
  });
}

function forwardHttp(req, res) {
  quietSocket(req.socket);
  const target = new URL(req.url || "/", UPSTREAM);
  const payload = {
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port || (target.protocol === "https:" ? 443 : 80),
    path: target.pathname + target.search,
    method: req.method,
    headers: {
      ...req.headers,
      host: target.host,
    },
    rejectUnauthorized: false,
    timeout: 30_000,
  };
  const lib = target.protocol === "https:" ? https : http;
  const upstream = lib.request(payload, (up) => {
    quietSocket(up.socket);
    if (res.headersSent) {
      up.resume();
      return;
    }
    res.writeHead(up.statusCode || 502, up.headers);
    up.pipe(res);
  });
  upstream.on("timeout", () => {
    upstream.destroy(new Error("upstream timeout"));
  });
  upstream.on("error", (err) => {
    console.warn("[dev-api-proxy] upstream:", err.code || err.message);
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "text/plain" });
    }
    res.end(`proxy error: ${err.message}`);
  });
  req.on("error", () => upstream.destroy());
  res.on("error", () => upstream.destroy());
  req.pipe(upstream);
}

function writeUpgradeResponse(socket, upRes, head) {
  const lines = [`HTTP/1.1 ${upRes.statusCode || 101} Switching Protocols`];
  for (const [key, value] of Object.entries(upRes.headers || {})) {
    if (value == null) continue;
    if (Array.isArray(value)) {
      for (const v of value) lines.push(`${key}: ${v}`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push("", "");
  socket.write(lines.join("\r\n"));
  if (head?.length) socket.write(head);
}

function forwardUpgrade(req, socket, head) {
  quietSocket(socket);
  const target = new URL(req.url || "/", UPSTREAM);
  const isTls = target.protocol === "https:";
  const lib = isTls ? https : http;
  const upstreamReq = lib.request({
    hostname: target.hostname,
    port: Number(target.port || (isTls ? 443 : 80)),
    path: target.pathname + target.search,
    method: "GET",
    headers: {
      ...req.headers,
      host: target.host,
    },
    rejectUnauthorized: false,
    timeout: 30_000,
  });
  upstreamReq.on("upgrade", (upRes, upSocket, upHead) => {
    quietSocket(upSocket);
    try {
      writeUpgradeResponse(
        socket,
        upRes,
        Buffer.concat([
          head && head.length ? head : Buffer.alloc(0),
          upHead && upHead.length ? upHead : Buffer.alloc(0),
        ])
      );
      upSocket.pipe(socket);
      socket.pipe(upSocket);
      console.log(`[dev-api-proxy] ws ok ${target.pathname}`);
    } catch (err) {
      console.warn("[dev-api-proxy] ws pipe:", err.message);
      upSocket.destroy();
      socket.destroy();
    }
  });
  upstreamReq.on("response", (upRes) => {
    console.warn("[dev-api-proxy] ws refused:", upRes.statusCode);
    try {
      socket.write(
        `HTTP/1.1 ${upRes.statusCode || 502} Bad Gateway\r\nConnection: close\r\n\r\n`
      );
    } catch {
      /* ignore */
    }
    upRes.resume();
    socket.destroy();
  });
  upstreamReq.on("timeout", () => {
    upstreamReq.destroy(new Error("upstream timeout"));
  });
  upstreamReq.on("error", (err) => {
    console.warn("[dev-api-proxy] ws upstream:", err.code || err.message);
    try {
      socket.write("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
    } catch {
      /* ignore */
    }
    socket.destroy();
  });
  upstreamReq.end();
}

const server = http.createServer(forwardHttp);
server.on("upgrade", forwardUpgrade);

server.on("clientError", (err, socket) => {
  console.warn("[dev-api-proxy] clientError:", err.code || err.message);
  socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

server.on("error", (err) => {
  console.error("[dev-api-proxy] server:", err.message);
});

process.on("uncaughtException", (err) => {
  console.warn("[dev-api-proxy] uncaught (kept alive):", err.code || err.message);
});

server.listen(LISTEN, "0.0.0.0", () => {
  console.log(
    `[dev-api-proxy] http://0.0.0.0:${LISTEN} → ${UPSTREAM} (http + websocket)`
  );
});
