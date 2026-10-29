// The files TEND serves at /sdk/ (scripts/build-sdk.mjs): up to date with the examples they are built from, complete, and runnable.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { files } from "../../scripts/build-sdk.mjs";

const root = path.resolve(import.meta.dirname, "../..");

test("public/sdk is exactly what build-sdk.mjs makes from the examples (run node scripts/build-sdk.mjs after changing them)", () => {
  for (const [name, text] of Object.entries(files())) assert.equal(readFileSync(path.join(root, "public/sdk", name), "utf8"), text, name);
});

test("tend.mjs is one self-contained file: every adapter, no import of another file, and the MCP proxy runs from it", async () => {
  const src = readFileSync(path.join(root, "public/sdk/tend.mjs"), "utf8");
  assert.deepEqual([...src.matchAll(/^import [^;]* from "([^"]+)";$/gm)].map((m) => m[1]).filter((m) => !m.startsWith("node:")), [], "only Node built-ins are imported");
  assert.ok(!/import\("\.\.?\//.test(src));
  const m = await import(path.join(root, "public/sdk/tend.mjs"));
  for (const name of ["connectTend", "createGate", "guardTool", "notDone", "runChatAgent", "toRequest", "startProxy"]) assert.equal(typeof m[name], "function", name);
  const usage = spawnSync(process.execPath, [path.join(root, "public/sdk/tend.mjs")], { encoding: "utf8" });
  assert.equal(usage.status, 2);
  assert.match(usage.stderr, /Usage: node tend-mcp-proxy\.mjs -- <mcp server command>/);
  assert.ok(!/tend_sk_[A-Za-z0-9_-]{20}|sk-ant-|\/Users\//.test(src + readFileSync(path.join(root, "public/sdk/tend_gate.py"), "utf8")), "no key and no local path");
});
