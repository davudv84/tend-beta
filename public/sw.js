// TEND's service worker. It does one thing: show browser notifications the TEND server sends, and open TEND when one is clicked.
// It caches nothing and intercepts no requests. A notification carries fixed text and a path on this site; the page it opens asks for a
// session like any other, and deciding an approval still happens on that page.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

/** Only a path on this origin is ever opened. Anything else falls back to the Home page. */
function safePath(url) {
  try {
    const u = new URL(typeof url === "string" ? url : "/home", self.location.origin);
    return u.origin === self.location.origin ? u.pathname + u.search : "/home";
  } catch {
    return "/home";
  }
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {}
  const title = typeof data.title === "string" ? data.title.slice(0, 80) : "TEND";
  const body = typeof data.body === "string" ? data.body.slice(0, 200) : "";
  event.waitUntil(self.registration.showNotification(title, {
    body,
    tag: typeof data.tag === "string" ? data.tag.slice(0, 64) : undefined,
    icon: "/icon.svg",
    data: { url: safePath(data.url) },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = safePath(event.notification.data && event.notification.data.url);
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).origin !== self.location.origin) continue;
      // A tab this worker controls is reused; one it does not control cannot be navigated from here, so a new one is opened.
      try {
        const moved = await c.navigate(path);
        if (moved) return moved.focus();
      } catch {}
      break;
    }
    return self.clients.openWindow(path);
  })());
});
