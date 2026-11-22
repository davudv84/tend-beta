import assert from "node:assert/strict";
import { test } from "node:test";
import { pageNonce } from "./style-nonce.ts";

const doc = (el: { nonce?: string } | null) => ({ querySelector: (sel: string) => (sel === "script[nonce]" ? el : null) }) as unknown as Document;

test("the scroll-lock nonce is the one Next stamped on its scripts, and nothing when there is none", () => {
  assert.equal(pageNonce(doc({ nonce: "abc123==" })), "abc123==");
  assert.equal(pageNonce(doc({ nonce: "" })), undefined, "an empty nonce is not passed on");
  assert.equal(pageNonce(doc(null)), undefined, "no nonced script (policy off): nothing");
  assert.equal(pageNonce(undefined), undefined, "on the server: nothing");
});
