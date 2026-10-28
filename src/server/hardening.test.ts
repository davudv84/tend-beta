// Fixes from the overnight security review, each pinned by a test that failed before the fix (or, for the body limit and the
// fetch-metadata check, exercises the exact path the review described).
import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanText } from "../lib/clean.ts";
import { signedIn } from "./test-support.ts";
import { memoryDb } from "./db.ts";
import { HttpError, readJson, requireOperator } from "./http.ts";
import { getAgent, ingestEvents, recentEvents, registerAgent } from "./repo.ts";

process.env.TEND_ADMIN_TOKEN = "test-admin-token-0123456789abcdef";
process.env.TEND_DEMO = "0";
const SID = "0123456789abcdef";

test("text from an agent loses NUL, control and bidirectional-override characters, and keeps newlines, tabs, emoji and joiners", () => {
  assert.equal(cleanText("a\u0000b"), "ab");
  assert.equal(cleanText("pay ‮EUR 5 to X‬ now"), "pay EUR 5 to X now");
  assert.equal(cleanText("line1\nline2\tx\r"), "line1\nline2\tx\r");
  assert.equal(cleanText("👨‍👩‍👧 ok"), "👨‍👩‍👧 ok", "the zero-width joiner in an emoji sequence stays");
  assert.equal(cleanText("x\u0007\u001b[31my"), "x[31my");
});

test("an agent cannot store a NUL or a text-reversing character in what it reports", async () => {
  const db = await memoryDb();
  try {
    const { agent } = await registerAgent(db, { name: "Poisoner", model: "m", provider: "Custom" }, SID);
    await ingestEvents(db, (await getAgent(db, agent.id))!, [{ type: "tool.called", data: { tool: "send_mail", action: "send", outcome: "failure", detail: "a\u0000b‮c", error: "x\u0000y" } }]);
    const stored = JSON.stringify(await recentEvents(db, 0, 50));
    assert.equal(stored.includes("\\u0000"), false, "NUL reached the database");
    assert.equal(stored.includes("\\u202e") || stored.includes("‮"), false, "an override character reached the database");
    assert.ok(stored.includes("abc"), "the rest of the text is kept");
  } finally {
    await db.close();
  }
});

const chunked = (size: number) => new Request("http://x/", { method: "POST", duplex: "half", body: new ReadableStream({ start(c) { for (let i = 0; i < size; i += 10_000) c.enqueue(new TextEncoder().encode("a".repeat(Math.min(10_000, size - i)))); c.close(); } }) } as RequestInit);

test("a request body sent in chunks, with no declared length, is cut off at the limit instead of being read whole", async () => {
  await assert.rejects(() => readJson(chunked(200_000)), (e) => e instanceof HttpError && e.status === 413);
  await assert.rejects(() => readJson(new Request("http://x/", { method: "POST", body: "{not json" })), (e) => e instanceof HttpError && e.status === 400);
  await assert.rejects(() => readJson(new Request("http://x/", { method: "POST" })), (e) => e instanceof HttpError && e.status === 400);
  assert.deepEqual(await readJson(new Request("http://x/", { method: "POST", body: '{"a":1}' })), { a: 1 });
  assert.deepEqual(await readJson(new Request("http://x/", { method: "POST", body: JSON.stringify({ t: "é".repeat(30_000) }) })), { t: "é".repeat(30_000) }, "multi-byte text under the limit still parses");
});

test("an operator request that the browser says came from another site is refused, even with a valid session", async () => {
  const db = await memoryDb();
  try {
    const me = await signedIn(db);
    const req = (extra: Record<string, string>) => me.request(extra, "http://tend.test/api/v1/x");
    assert.ok(await requireOperator(req({}), db), "no fetch metadata (a script, curl): allowed with a session");
    assert.ok(await requireOperator(req({ "sec-fetch-site": "same-origin" }), db));
    assert.ok(await requireOperator(req({ "sec-fetch-site": "none" }), db));
    for (const site of ["cross-site", "same-site"])
      await assert.rejects(() => requireOperator(req({ "sec-fetch-site": site }), db), (e) => e instanceof HttpError && e.status === 403 && e.code === "bad_origin", site);
    await assert.rejects(() => requireOperator(req({ origin: "http://evil.example" }), db), (e) => e instanceof HttpError && e.code === "bad_origin");
  } finally {
    await db.close();
  }
});
