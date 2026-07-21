/* Qchat Web Push service worker — messages + incoming call wake. */
self.addEventListener("push", (event) => {
  let data = { title: "Qchat", body: "New message", tag: "qchat", type: "message", url: "/" };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch (_) {
    /* ignore */
  }
  event.waitUntil(
    (async () => {
      // If a visible Qchat tab is open, skip OS notify — WS overlay / in-tab Notification handles it.
      // Still wake when all windows are hidden/closed (Mattermost Calls background notify).
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
      await self.registration.showNotification(data.title || "Qchat", {
        body: data.body || "",
        tag: data.tag || "qchat",
        icon: data.icon || undefined,
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
