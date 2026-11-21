import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server.js";
import { proxy } from "../proxy.ts";
import { buildCsp, cspMode, newNonce, STYLE_HASHES } from "./csp.ts";

const directive = (policy: string, name: string) => policy.split("; ").find((d) => d === name || d.startsWith(`${name} `));

test("the production policy: nonce-only scripts, no unsafe-inline or unsafe-eval, nothing may frame, plug in, rebase or post elsewhere", () => {
  const p = buildCsp({ nonce: "N0NCE" });
  assert.equal(directive(p, "script-src"), "script-src 'self' 'nonce-N0NCE' 'strict-dynamic'");
  assert.ok(!/script-src[^;]*'unsafe-(inline|eval)'/.test(p), "scripts: no unsafe-inline, no unsafe-eval");
  assert.ok(!/style-src(-elem)? [^;]*'unsafe-inline'/.test(p), "no inline style elements: only nonced ones and two known hashes")
  assert.equal(directive(p, "style-src-attr"), "style-src-attr 'unsafe-inline'", "style attributes (rendered by React) may be inline")
  assert.match(directive(p, "style-src-elem")!, /'nonce-N0NCE'/);
  for (const d of ["default-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'", "connect-src 'self'"]) assert.ok(p.includes(d), d);
  assert.ok(!/ws:|http:|https:|\*/.test(p.replace(/'self'/g, "")), "no scheme or wildcard source in production");
});

test("development alone may use eval and websockets (hot reload)", () => {
  const dev = buildCsp({ nonce: "x", dev: true }), prod = buildCsp({ nonce: "x" });
  assert.match(dev, /'unsafe-eval'/);
  assert.match(dev, /connect-src 'self' ws: wss:/);
  assert.ok(!/unsafe-eval|ws:/.test(prod));
});

test("every request gets its own unguessable nonce", () => {
  const seen = new Set(Array.from({ length: 200 }, newNonce));
  assert.equal(seen.size, 200);
  for (const n of seen) assert.match(n, /^[A-Za-z0-9+/]{22}==$/, "128 bits, base64");
});

test("the mode is enforce unless explicitly report or off", () => {
  assert.deepEqual([undefined, "", "enforce", "garbage", "report", "off"].map((v) => cspMode(v)), ["enforce", "enforce", "enforce", "enforce", "report", "off"]);
});

test("the proxy sets the policy on the response and hands the same nonce to Next through the request", () => {
  const before = process.env.TEND_CSP;
  try {
    delete process.env.TEND_CSP;
    const a = proxy(new NextRequest("http://localhost/home")), b = proxy(new NextRequest("http://localhost/home"));
    const pa = a.headers.get("content-security-policy")!, pb = b.headers.get("content-security-policy")!;
    assert.ok(pa && pb && pa !== pb, "a different nonce each time");
    const nonce = /'nonce-([^']+)'/.exec(pa)![1];
    assert.ok(a.headers.get("x-middleware-override-headers")!.split(",").includes("content-security-policy"), "the request header Next reads the nonce from is set");
    assert.ok(a.headers.get("x-middleware-request-content-security-policy")!.includes(`'nonce-${nonce}'`), "and it carries the same nonce");
    assert.equal(a.headers.get("content-security-policy-report-only"), null);

    process.env.TEND_CSP = "report";
    const r = proxy(new NextRequest("http://localhost/home"));
    assert.equal(r.headers.get("content-security-policy"), null);
    assert.match(r.headers.get("content-security-policy-report-only")!, /script-src/);

    process.env.TEND_CSP = "off";
    const o = proxy(new NextRequest("http://localhost/home"));
    assert.equal(o.headers.get("content-security-policy") ?? o.headers.get("content-security-policy-report-only"), null);
  } finally {
    if (before === undefined) delete process.env.TEND_CSP;
    else process.env.TEND_CSP = before;
  }
});


test("the allowed style hash is the toast library's actual CSS (an upgrade that changes it fails here, not silently in browsers)", async () => {
  const { readFileSync } = await import("node:fs");
  const { createHash } = await import("node:crypto");
  const src = readFileSync(new URL("../../node_modules/sonner/dist/index.mjs", import.meta.url), "utf8");
  const css = JSON.parse(`"${/__insertCSS\("((?:[^"\\]|\\.)*)"\);/.exec(src)![1]}"`);
  assert.ok(STYLE_HASHES.includes(`'sha256-${createHash("sha256").update(css).digest("base64")}'`));
  assert.ok(STYLE_HASHES.includes(`'sha256-${createHash("sha256").update("").digest("base64")}'`), "the empty element it creates first");
  assert.equal(STYLE_HASHES.length, 2, "nothing else");
});
