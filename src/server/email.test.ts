// Mail delivery failures: the mail service refusing or being unreachable must never break a sign-up or leak a link into the log.
import assert from "node:assert/strict";
import { test } from "node:test";
import { deliver } from "./accounts.ts";
import { sendMail } from "./email.ts";

const mail = { to: "ana@example.com", subject: "Confirm", text: "https://tend.test/account/verify#token=" + "x".repeat(43) };

test("a refused or unreachable mail service is an error from sendMail, and the key goes only to Resend", async () => {
  const real = globalThis.fetch;
  process.env.RESEND_API_KEY = "re_test_key_for_this_test_only";
  process.env.TEND_EMAIL_FROM = "TEND <beta@example.com>";
  const seen: string[] = [];
  try {
    globalThis.fetch = (async (url: string, init: RequestInit) => { seen.push(`${url} ${(init.headers as Record<string, string>).authorization}`); return new Response("{}", { status: 422 }); }) as typeof fetch;
    await assert.rejects(sendMail(mail), /mail service answered 422/);
    globalThis.fetch = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
    await assert.rejects(sendMail(mail), /fetch failed/);
    assert.deepEqual(seen, ["https://api.resend.com/emails Bearer re_test_key_for_this_test_only"]);
  } finally {
    globalThis.fetch = real;
    delete process.env.RESEND_API_KEY;
    delete process.env.TEND_EMAIL_FROM;
  }
});

test("deliver() survives every failure, keeps sending the rest, and logs neither the link nor the address", async () => {
  const logged: string[] = [];
  const err = console.error;
  console.error = (...a: unknown[]) => { logged.push(a.join(" ")); };
  const sent: string[] = [];
  try {
    await deliver([mail, { ...mail, to: "bo@example.com" }], async (m) => { if (m.to === "ana@example.com") throw new Error("mail service answered 500"); sent.push(m.to); });
  } finally {
    console.error = err;
  }
  assert.deepEqual(sent, ["bo@example.com"], "one failed mail does not stop the next");
  assert.equal(logged.length, 1);
  assert.match(logged[0], /could not send mail: mail service answered 500/);
  assert.ok(!logged[0].includes("token=") && !logged[0].includes("ana@example.com"));
});
