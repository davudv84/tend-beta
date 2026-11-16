// TEND's service worker. It does two things: show the notifications the TEND server sends, and act on a click on one. It caches nothing
// and intercepts no requests.
//
// An approval notification carries the agent's name and the tool and action it asks for, and a path on this site. A low-risk one also has
// Approve and Deny buttons: pressing one sends the decision to TEND's approval API with this browser's own session (the same request the
// approval page makes), and the server decides whether it counts. A high-risk one has no buttons; the server would refuse an approval from
// here anyway. A click on the notification itself always opens the approval in TEND, in a tab that is already open if there is one.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

const ICON = "/icons/icon-192.png";
const APPROVAL_ID = /^az_[a-f0-9]{24}$/;
const str = (v, max, fallback) => (typeof v === "string" && v ? v.slice(0, max) : fallback);

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
  const approvalId = typeof data.approvalId === "string" && APPROVAL_ID.test(data.approvalId) ? data.approvalId : null;
  const waiting = data.type === "approval" && !!approvalId;
  // Buttons only for an approval the server marked low risk, and only the two answers there are.
  const actions = waiting && data.risk === "low" && Array.isArray(data.actions)
    ? data.actions.filter((a) => a && (a.action === "approve" || a.action === "deny")).slice(0, 2).map((a) => ({ action: a.action, title: str(a.title, 24, a.action) }))
    : [];
  const text = {};
  if (data.text && typeof data.text === "object") for (const k of ["approved", "denied", "expired", "already", "confirm", "signIn", "failed"]) text[k] = str(data.text[k], 120, "");
  event.waitUntil(self.registration.showNotification(str(data.title, 80, "TEND"), {
    body: str(data.body, 200, ""),
    tag: str(data.tag, 64, undefined),
    icon: ICON,
    badge: ICON,
    // A waiting approval stays until it is answered; what became of it replaces it quietly (same tag).
    requireInteraction: waiting,
    renotify: waiting,
    silent: data.type === "resolved",
    actions,
    data: { url: safePath(data.url), approvalId: waiting ? approvalId : null, risk: data.risk === "low" ? "low" : "high", title: str(data.title, 80, "TEND"), what: str(data.body, 200, ""), text },
  }));
});

/** Opens a path in TEND: an open TEND tab is brought to the front and taken there; only without one is a new window opened. */
async function open(path) {
  const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const c of all) {
    if (new URL(c.url).origin !== self.location.origin) continue;
    let there = null;
    try {
      // A tab this worker does not control cannot be navigated from here; it is still the one to show if it is already on that page.
      there = new URL(c.url).pathname + new URL(c.url).search === path ? c : await c.navigate(path);
    } catch {}
    if (!there) continue;
    // The tab is on the page now. If the browser will not bring it forward, a second window would not help either.
    try { await there.focus(); } catch {}
    return there;
  }
  return self.clients.openWindow(path);
}

/** Sends one answer for one approval, as this browser's signed-in person, and says in a short notification what came of it. */
async function decide(d, decision) {
  // Saying what happened must never get in the way of what happens next (opening the page), so a notification that cannot be shown is let go.
  const say = (body, more) => self.registration.showNotification(d.title, { body: `${d.what}\n${body}`, tag: d.approvalId, icon: ICON, badge: ICON, data: { url: d.url }, ...more }).catch(() => {});
  let res;
  try {
    res = await fetch(`/api/v1/approvals/${d.approvalId}`, {
      method: "POST", credentials: "include", cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, via: "web-push" }),
    });
  } catch {
    await say(d.text.failed, { requireInteraction: true });
    return open(d.url);
  }
  const j = await res.json().catch(() => ({}));
  if (res.ok && j.approval) {
    const s = j.approval.status;
    return say(j.changed ? (s === "approved" ? d.text.approved : d.text.denied) : s === "expired" ? d.text.expired : d.text.already, { silent: true });
  }
  // Not signed in here, or the server wants this one confirmed on its page: that is where the person goes.
  await say(j.error === "confirmation_required" ? d.text.confirm : res.status === 401 || res.status === 403 ? d.text.signIn : d.text.failed, { requireInteraction: true });
  return open(d.url);
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  const path = safePath(d.url);
  const answer = event.action === "approve" || event.action === "deny" ? event.action : null;
  // A button on a low-risk approval answers it. Everything else (the notification itself, a high-risk approval, any other kind) opens TEND.
  if (answer && d.risk === "low" && typeof d.approvalId === "string" && APPROVAL_ID.test(d.approvalId)) return event.waitUntil(decide({ ...d, url: path, text: d.text || {} }, answer));
  event.waitUntil(open(path));
});
