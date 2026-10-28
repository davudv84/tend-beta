#!/usr/bin/env node
// Rehearses local beta hosting WITHOUT any tunnel or internet: three instances started exactly as `beta:local start` starts them (own port and folders, private,
// confined), each behind a small proxy that behaves like a Cloudflare Tunnel (public hostname in Host, X-Forwarded-Proto https, the caller's address appended to
// X-Forwarded-For), then checked from outside. Everything lives in a temp folder and is removed at the end.
//
//   npm run build && npm run beta:local:rehearse
import { createServer, request } from "node:http";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { liveCheck } from "./beta-live-check.mjs";
import { loadAll, provision, startAll } from "./beta-local.mjs";

const root = path.resolve(import.meta.dirname, "..");
const work = realpathSync(mkdtempSync(path.join(tmpdir(), "tend-localrehearsal-")));
const names = ["alice", "bob", "carol"];
const results = [];
const rec = (ok, text) => results.push([ok, text]);
const proxies = [];

/** What cloudflared + Cloudflare's edge would do: public Host, https, and the edge-observed client address as the LAST X-Forwarded-For entry. */
function tunnel(name, port) {
  return new Promise((resolve) => {
    const s = createServer((req, res) => {
      const edgeIp = req.headers["x-test-ip"] ?? "198.51.100.1";
      const headers = { ...req.headers, host: `${name}.beta.test`, "x-forwarded-proto": "https", "x-forwarded-for": [req.headers["x-forwarded-for"], edgeIp].filter(Boolean).join(", ") };
      delete headers["x-test-ip"];
      const up = request({ host: "127.0.0.1", port, method: req.method, path: req.url, headers }, (r) => {
        res.writeHead(r.statusCode, r.headers);
        r.pipe(res);
      });
      up.on("error", () => { res.statusCode = 502; res.end(); });
      req.pipe(up);
    });
    s.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${s.address().port}`, close: () => new Promise((r) => (s.closeAllConnections(), s.close(r))) }));
  });
}

let run;
try {
  provision(work, names);
  const { instances } = loadAll(work);
  run = await startAll({ root, work, confined: true, log: () => {} });
  rec(true, `3 instances started, confined, on ports ${names.map((n) => instances[n].PORT).join(", ")}`);
  const sites = {};
  for (const n of names) {
    const p = await tunnel(n, Number(instances[n].PORT));
    proxies.push(p);
    sites[n] = p.url;
  }

  const live = await liveCheck({ allowHttp: true, expectStorage: "embedded", instances: names.map((n) => ({ name: n, url: sites[n], token: instances[n].TEND_ADMIN_TOKEN })) });
  for (const r of live) rec(r.ok, `[${r.instance}] ${r.text}`);

  // Behind the tunnel: a browser-style operator request (Origin = the public hostname) passes the same-site check.
  const tok = (n) => instances[n].TEND_ADMIN_TOKEN;
  const login = await fetch(`${sites.alice}/api/operator/session`, { method: "POST", headers: { "content-type": "application/json", origin: "https://alice.beta.test" }, body: JSON.stringify({ token: tok("alice") }) });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const reg = await fetch(`${sites.alice}/api/v1/agents`, { method: "POST", headers: { cookie, "content-type": "application/json", origin: "https://alice.beta.test" }, body: JSON.stringify({ name: "Tunnel agent", model: "m", provider: "OpenAI" }) });
  rec(reg.status === 201, `an operator request from the public hostname passes the same-site check (${reg.status})`);
  const wrongOrigin = await fetch(`${sites.alice}/api/v1/agents`, { method: "POST", headers: { cookie, "content-type": "application/json", origin: "https://evil.example" }, body: JSON.stringify({ name: "x", model: "m", provider: "OpenAI" }) });
  rec(wrongOrigin.status === 403, `a request claiming another origin is refused (${wrongOrigin.status})`);

  // The real file tool, end to end, inside the confinement: an approved write lands in THIS instance's sandbox and nowhere else.
  const op = (m, p, b) => fetch(sites.alice + p, { method: m, headers: { cookie, "content-type": "application/json" }, body: b && JSON.stringify(b) }).then((r) => r.json());
  const agent = (await op("GET", "/api/v1/state")).projection.agents.find((a) => a.name === "Tunnel agent");
  await op("POST", `/api/v1/agents/${agent.id}/policy`, { rules: [{ tool: "write_test_file", action: "create", effect: "approve" }, { tool: "read_test_file", action: "read", effect: "allow" }], enforcement: "enforce" });
  const key = (await (await fetch(`${sites.alice}/api/v1/agents/${agent.id}/keys`, { method: "POST", headers: { cookie } })).json()).apiKey;
  const A = (p, b) => fetch(sites.alice + p, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(b ?? {}) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const ask = (await A("/api/v1/gateway/requests", { tool: "write_test_file", params: { path: "from-tester.txt", text: "written under confinement" } })).body;
  await op("POST", `/api/v1/reviews/${ask.id}`, { status: "approved" });
  const claim = await A(`/api/v1/authorizations/${ask.id}/token`);
  const exec = await A("/api/v1/gateway/execute", { authorizationId: ask.id, token: claim.body.token, tool: "write_test_file", params: { path: "from-tester.txt", text: "written under confinement" } });
  const mine = path.join(work, "beta-data/alice/sandbox/from-tester.txt");
  rec(exec.status === 200 && existsSync(mine) && readFileSync(mine, "utf8") === "written under confinement\n" && !names.slice(1).some((n) => existsSync(path.join(work, "beta-data", n, "sandbox/from-tester.txt"))), `an approved file write works under confinement and lands only in alice's own sandbox (ask ${ask.status}, claim ${claim.status}, execute ${exec.status} ${JSON.stringify(exec.body).slice(0, 160)})`);
  rec(existsSync(path.join(work, "beta-data/alice/db")) && readFileSync(path.join(work, "beta-envs/alice/local.env"), "utf8").includes("TEND_ADMIN_TOKEN"), "alice's database lives in her own folder");

  // Caller addresses come from the tunnel's X-Forwarded-For (the LAST entry), so limits are per real caller and cannot be dodged by a forged prefix.
  const wrong = (ip, spoof) => fetch(`${sites.carol}/api/operator/session`, { method: "POST", headers: { "content-type": "application/json", "x-test-ip": ip, "x-forwarded-for": spoof }, body: JSON.stringify({ token: "not-the-token-0123456789abcdefghijklmnop" }) }).then((r) => r.status);
  const codes = [];
  for (let i = 0; i < 13; i++) codes.push(await wrong("203.0.113.50", `10.0.0.${i}`)); // a different forged prefix each time
  rec(codes.slice(0, 10).every((c) => c === 401) && codes.slice(10).every((c) => c === 429), `one caller is limited after 10 wrong tokens however it forges X-Forwarded-For (${codes.join(" ")})`);
  const other = await fetch(`${sites.carol}/api/operator/session`, { method: "POST", headers: { "content-type": "application/json", "x-test-ip": "203.0.113.51" }, body: JSON.stringify({ token: tok("carol") }) });
  rec(other.status === 200, `another caller is unaffected and signs in (${other.status})`);
} catch (e) {
  rec(false, `rehearsal error: ${e.message}`);
} finally {
  for (const p of proxies) await p.close();
  await run?.stop();
  rmSync(work, { recursive: true, force: true });
}
for (const [ok, text] of results) console.log(`${ok ? "ok  " : "FAIL"} ${text}`);
const failed = results.filter((r) => !r[0]).length;
console.log(`\nlocal rehearsal: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
