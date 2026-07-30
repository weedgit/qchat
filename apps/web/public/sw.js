/* Qchat PWA + Web Push service worker — keep one root-scoped worker. */
const CACHE_NAME = "qchat-shell-v3";
const OFFLINE_URL = "/offline.html";
const APP_SHELL = [
  "/",
  "/login",
  "/offline.html",
  "/manifest.webmanifest",
  "/favicon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(APP_SHELL.map((path) => cache.add(path)))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event?.data?.type === "qchat-skip-waiting") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/v1/")
  ) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Only cache successful same-origin HTML navigations carefully —
          // avoid trapping users on a stale app shell after deploys.
          return response;
        })
        .catch(async () => {
          const offline = await caches.match(OFFLINE_URL);
          if (offline) return offline;
          return (await caches.match("/")) || Response.error();
        })
    );
    return;
  }

  if (
    url.pathname === OFFLINE_URL ||
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/favicon.png" ||
    url.pathname === "/manifest.webmanifest"
  ) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            }
            return response;
          })
      )
    );
  }
});

self.addEventListener("push", (event) => {
  let data = { title: "Rchat", body: "New message", tag: "qchat", type: "message", url: "/" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (_) {
    /* ignore */
  }
  event.waitUntil(
    (async () => {
      try {
        const list = await clients.matchAll({ type: "window", includeUncontrolled: true });
        const visible = list.some((c) => c.visibilityState === "visible");
        if (visible && data.type === "call") {
          return;
        }
        if (visible && data.type !== "call") {
          const focused = list.some((c) => c.focused);
          if (focused) return;
        }
      } catch (_) {
        /* show anyway */
      }
      await self.registration.showNotification(data.title || "Rchat", {
        body: data.body || "",
        tag: data.tag || "qchat",
        icon: data.icon || "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        renotify: true,
        data: {
          url: data.url || "/",
          type: data.type || "message",
          call_id: data.call_id || "",
          conversation_id: data.conversation_id || "",
        },
      });
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const meta = event.notification.data || {};
  const target = meta.url || "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          c.postMessage({ type: "qchat-notification-click", ...meta });
          return c.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(target);
    })
  );
});
