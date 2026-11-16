// Tells Telegram where to deliver the bot's updates, with the secret TEND checks on every one of them.
//
//   node --env-file=.env.local scripts/telegram-webhook.mjs                      register https://tendhq.dev/api/telegram/webhook
//   node --env-file=.env.local scripts/telegram-webhook.mjs https://my.host      another address (the path is added)
//   node --env-file=.env.local scripts/telegram-webhook.mjs info                 what Telegram has on record
//   node --env-file=.env.local scripts/telegram-webhook.mjs delete               stop deliveries
//
// Needs TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET in the environment (the same values the server has). Neither is printed.
// The one-liner this replaces:
//   curl -sS "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" -d "url=https://tendhq.dev/api/telegram/webhook" \
//     -d "secret_token=$TELEGRAM_WEBHOOK_SECRET" -d 'allowed_updates=["message","callback_query"]' -d "drop_pending_updates=true"
const token = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "", secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim() ?? "";
const die = (m) => { console.error(m); process.exit(1); };
if (!/^\d{3,20}:[A-Za-z0-9_-]{20,100}$/.test(token)) die("TELEGRAM_BOT_TOKEN is missing or is not a bot token (get one from @BotFather).");

const call = async (method, body) => {
  let res;
  try {
    res = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}), signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    die(`Telegram could not be reached: ${e.cause?.code ?? e.name}.`); // never e.message: it can contain the address, and the address the token
  }
  const j = await res.json().catch(() => ({}));
  if (!j.ok) die(`Telegram refused ${method}: ${res.status} ${j.description ?? ""}`.trim());
  return j.result;
};

const arg = process.argv[2] ?? "https://tendhq.dev";
if (arg === "info") {
  const i = await call("getWebhookInfo");
  console.log(i.url ? `Webhook: ${i.url}\nWaiting updates: ${i.pending_update_count}${i.last_error_message ? `\nLast error: ${i.last_error_message}` : ""}` : "No webhook is registered.");
} else if (arg === "delete") {
  await call("deleteWebhook", { drop_pending_updates: true });
  console.log("Webhook removed. Telegram no longer delivers updates.");
} else {
  if (!/^[A-Za-z0-9_-]{16,256}$/.test(secret)) die("TELEGRAM_WEBHOOK_SECRET is missing. Use 16–256 letters, digits, _ or -, e.g.: node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\"");
  let url;
  try { url = new URL(arg); } catch { die(`"${arg}" is not an address. Use https://your-tend-host`); }
  if (url.protocol !== "https:") die("Telegram only delivers to https addresses.");
  if (url.pathname === "/" || url.pathname === "") url.pathname = "/api/telegram/webhook";
  await call("setWebhook", { url: url.toString(), secret_token: secret, allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
  const me = await call("getMe");
  console.log(`Webhook registered: ${url}\nBot: @${me.username}  (set TELEGRAM_BOT_USERNAME=${me.username})`);
}
