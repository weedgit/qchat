#!/usr/bin/env node
/**
 * LiveKit signaling proxy for iPhone (WebRTC media still goes phone → VPS).
 * Phone → ws://<mac-lan>:7444/... → ws://135.181.224.36:7880/...
 *
 * Usage: node scripts/dev-livekit-proxy.js
 */
const http = require("http");
const { URL } = require("url");

const LISTEN = Number(process.env.QCHAT_LIVEKIT_PROXY_PORT || 7444);
const UPSTREAM = (
  process.env.QCHAT_LIVEKIT_UPSTREAM || "ws://135.181.224.36:7880"
).replace(/\/$/, "");

function quietSocket(sock) {
  if (!sock || typeof sock.on !== "function") return;
  sock.on("error", (err) => {
    console.warn("[dev-livekit-proxy] socket:", err.code || err.message);
  });
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
  const upstreamBase = UPSTREAM.replace(/^ws/i, "http");
  const target = new URL(req.url || "/", upstreamBase);
  const isTls = /^https:/i.test(target.protocol);
  const lib = isTls ? require("https") : require("http");
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
    timeout: 60_000,
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
      console.log(`[dev-livekit-proxy] ws ok ${target.pathname}`);
    } catch (err) {
      console.warn("[dev-livekit-proxy] pipe:", err.message);
      upSocket.destroy();
      socket.destroy();
    }
  });
  upstreamReq.on("response", (upRes) => {
    console.warn("[dev-livekit-proxy] non-upgrade:", upRes.statusCode);
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
    console.warn("[dev-livekit-proxy] upstream:", err.code || err.message);
    try {
      socket.write("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
    } catch {
      /* ignore */
    }
    socket.destroy();
  });
  upstreamReq.end();
}

const server = http.createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end(`qchat livekit proxy → ${UPSTREAM}\n`);
});

server.on("upgrade", forwardUpgrade);
server.on("clientError", (_err, socket) => {
  socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});
server.on("error", (err) => {
  console.error("[dev-livekit-proxy] server:", err.message);
});
process.on("uncaughtException", (err) => {
  console.warn("[dev-livekit-proxy] uncaught:", err.code || err.message);
});

server.listen(LISTEN, "0.0.0.0", () => {
  console.log(
    `[dev-livekit-proxy] ws://0.0.0.0:${LISTEN} → ${UPSTREAM} (signaling only)`
  );
});
