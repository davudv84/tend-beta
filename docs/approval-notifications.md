# Approvals that reach people: Web Push and Telegram

When an agent asks for something that needs a person, TEND tells that person where they are: a browser notification (Mac, Windows, Android,
and iPhone once TEND is on the Home Screen) and a Telegram message. Both lead to the same decision, made by one function on the server.

Both need an **account** (sign-in with an e-mail address). The admin-token operator has no account, so it can decide in the dashboard only.

## What is guaranteed, whatever the channel

Every decision, from the dashboard, a notification button or Telegram, goes through `resolveApproval()` in `src/server/approvals.ts`:

- **Who:** only a signed-in member of the approval's workspace (browser), or the Telegram account linked to such a member, pressing in the linked private chat.
- **Once:** the first decision wins. A later or simultaneous one gets the first result back and changes nothing.
- **Expiry:** an approval waits 10 minutes (`TEND_APPROVAL_TTL_MINUTES`, 1–1440). Unanswered, it is expired, which means not approved. The agent sees `expired`, as before.
- **Risk:** each approval is `low` or `high`. A **high**-risk one cannot be approved from a notification: it is confirmed on its page in TEND, signed in. It can be denied from anywhere.
- **Audit:** each decision is a `review.decided` event in the append-only log with `by`, `userId`, `via` (`dashboard`, `web-push`, `telegram`), `authorizationId` and the time.

The agent-facing API is unchanged.

## The approval API

| Call | What it does |
|---|---|
| `GET /api/v1/approvals` | Approvals waiting in the caller's workspace |
| `GET /api/v1/approvals/{id}` | One approval: what is asked, its risk, what became of it, who decided and through which channel |
| `POST /api/v1/approvals/{id}` | `{ "decision": "approve" \| "deny", "via": "dashboard" \| "web-push" \| "telegram" }` |

All three need a session cookie. A second `POST` answers 200 with the first result and `"alreadyDecided": true`. Approving a high-risk approval with
`via` other than `dashboard` answers `403 confirmation_required`. (`POST /api/v1/reviews/{id}`, which the dashboard and the command line use, goes through
the same function and still answers a second decision with `409`.)

## Risk: marking a rule low

An approval's risk comes from the policy rule that asked for it. Without anything said, it is **high**, so no approval has one-tap buttons until
you mark a rule `low`. Tools that spend money (`pay_invoice`) are always high; TEND refuses a policy that says otherwise. Where a central policy and
the agent's own rules both have a rule for a request, both must say `low`.

A rule is marked with `"risk": "low"`:

```json
[
  { "tool": "read_ticket", "action": "read", "effect": "approve", "risk": "low" },
  { "tool": "send_email", "action": "send", "effect": "approve" }
]
```

With the command line, add `:low` to the rule:

```bash
npm run tester:agent -- "My agent" --rule read_ticket:read:approve:low --rule send_email:send:approve
```

```bash
npm run tend -- policy create "Baseline" --rule read_ticket:read:approve:low --assign "My agent"
```

With the API (signed in as operator, see [api-examples.md](api-examples.md) for the cookie):

```bash
curl -sf -b $T/jar -H 'content-type: application/json' \
  -d '{"rules":[{"tool":"read_ticket","action":"read","effect":"approve","risk":"low"},{"tool":"send_email","action":"send","effect":"approve"}]}' \
  $URL/api/v1/agents/$AGENT/policy
```

**A low-risk example to test one-tap buttons** (TEND's built-in test tool, which does nothing):

```bash
npm run tester:agent -- "Push test" --rule test_ping:ping:approve:low
```

```bash
curl -sf -H "authorization: Bearer $(grep '^TEND_AGENT_KEY=' .env.agent | cut -d= -f2)" -H 'content-type: application/json' \
  -d '{"tool":"test_ping","params":{"message":"hello"}}' ${TEND_URL:-http://localhost:3000}/api/v1/gateway/requests
```

The second command makes the agent ask once. The notification that arrives has Approve and Deny buttons. Remove `:low` and it has none.

The Permissions screen has no control for risk. Changing a tool there keeps the risk a rule already had while the tool still asks.

## Environment variables

| Name | What |
|---|---|
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Web Push public key (the only one a browser sees) |
| `VAPID_PRIVATE_KEY` | Web Push private key. Secret. |
| `VAPID_SUBJECT` | `mailto:you@yourdomain` (push services use it to reach you) |
| `TELEGRAM_BOT_TOKEN` | From @BotFather. Secret. |
| `TELEGRAM_WEBHOOK_SECRET` | 16–256 letters, digits, `_` or `-`. Secret. Telegram repeats it on every call to the webhook. |
| `TELEGRAM_BOT_USERNAME` | The bot's username, without `@` |
| `TEND_APP_URL` | `https://tendhq.dev` (already needed for accounts). Telegram buttons link here. |
| `TEND_APPROVAL_TTL_MINUTES` | Optional. How long an approval waits. Default 10. |

The older `TEND_VAPID_PUBLIC_KEY`, `TEND_VAPID_PRIVATE_KEY` and `TEND_VAPID_SUBJECT` are still read. Web Push needs all three VAPID values and Telegram
all three Telegram values; with a set missing, that channel is off and Settings says so.

## Setup

**1. VAPID keys**

```bash
node scripts/vapid-keys.mjs
```

It prints the three lines to set. `npx web-push generate-vapid-keys` gives the same kind of pair. A new pair means everyone turns notifications on again.

**2. The Telegram bot**

1. In Telegram, open **@BotFather**, send `/newbot`, choose a name and a username ending in `bot`. Copy the token: that is `TELEGRAM_BOT_TOKEN`; the username is `TELEGRAM_BOT_USERNAME`.
2. Make a webhook secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

**3. Set the variables in Vercel** (Project → Settings → Environment Variables), then deploy. The database migration runs by itself on the first request.

**4. Register the webhook** (after the deploy, with the same token and secret in `.env.local` or your shell):

```bash
npm run telegram:webhook
```

That registers `https://tendhq.dev/api/telegram/webhook`. For another host: `npm run telegram:webhook -- https://your.host`. To check: `npm run telegram:webhook -- info`.
The one-liner it replaces:

```bash
curl -sS "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" -d "url=https://tendhq.dev/api/telegram/webhook" -d "secret_token=$TELEGRAM_WEBHOOK_SECRET" -d 'allowed_updates=["message","callback_query"]' -d "drop_pending_updates=true"
```

## Using it

- **Browser:** Settings → Notifications → *Enable browser notifications*. On a Mac, also allow notifications for the browser in System Settings → Notifications. On an iPhone, first add TEND to the Home Screen (Share → Add to Home Screen), open it from there, then enable.
- **Telegram:** Settings → Notifications → *Connect Telegram*, then press **Start** in the bot. The link works once, for 15 minutes. `/disconnect` in the chat, or *Disconnect* in Settings, ends it.

What each shows:

| | Low risk | High risk |
|---|---|---|
| Browser notification | Agent, tool · action, **Approve / Deny** buttons | Agent, tool · action, no buttons; a click opens the approval page |
| Telegram | Agent, tool · action, item and detail, **Approve / Deny** and *Open in TEND* | The same text, only *Open TEND to confirm* |

A browser notification never contains the detail text or the arguments. Once an approval is decided, expires or is withdrawn, the Telegram message is
edited and the browser notification replaced: "✅ Approved by ana@example.com via web push".

Safari on a Mac and iPhone Home Screen apps do not show buttons on notifications, so there a tap always opens the approval page. Buttons appear in Chrome, Edge and on Android.

## Testing end to end

Use the low-risk example above for buttons, and the same rule without `:low` for the high-risk path.

1. **Mac, Chrome:** sign in, enable notifications, make the agent ask. A notification stays on screen with Approve and Deny. Press Approve: a short "Approved" replaces it, and the agent's request is approved. Ask again and click the notification body: the open TEND tab comes forward on `/approvals/<id>`.
2. **Mac, Safari:** File → Add to Dock (or just Safari), enable notifications, make the agent ask. The notification has no buttons; clicking it opens the approval page, where you approve.
3. **iPhone:** in Safari open TEND → Share → Add to Home Screen → open TEND from the Home Screen → sign in → enable notifications. Lock the phone, make the agent ask, tap the notification, approve on the page.
4. **Telegram:** connect, make the agent ask. Low risk: press ✅ Approve; the message changes to "✅ Approved by … via Telegram". High risk: only *Open TEND to confirm*.
5. **Once only:** with both channels on, approve in one. The other's message or notification updates, and pressing its old button answers "already decided".
6. **Expiry:** let one wait past its time. The agent gets `expired`; the Telegram message says so the next time TEND handles any request.
7. **Audit:** `npm run tend -- audit --last 5` lists each decision with its channel ("a person approved a held request (via telegram)").

## Adding a channel later

`src/server/notify/channels/` has one file per channel, each exporting a `Channel` (`types.ts`): `configured`, `carries`, `send`, `resolved`. Add a file
(Slack, APNs for a native app), list it in `CHANNELS` in `src/server/notify/index.ts`, and let its button or webhook call `resolveApproval()` with a new `via`.
