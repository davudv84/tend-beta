// `npm run agents:doctor` (scripts/agents-doctor.mjs) against a FAKE repository in a temp directory. The real .env.local is never touched.
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { diagnose } from "../../scripts/agents-doctor.mjs";

const make = () => {
  const root = mkdtempSync(path.join(tmpdir(), "tend-doctor-"));
  writeFileSync(path.join(root, ".gitignore"), ".env*\n!.env.example\n.agent-sandbox/\n");
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
};
const levels = (f: { level: string; text: string }[], needle: RegExp) => f.filter((x) => needle.test(x.text)).map((x) => x.level);

test("the doctor flags loose permissions, server secrets in the agent's file, a missing ignore rule and a shell that exports secrets", () => {
  const { root, cleanup } = make();
  try {
    const sandbox = path.join(root, "sbx");
    writeFileSync(path.join(root, ".env.local"), `TEND_ADMIN_TOKEN=fake\nTEND_GATEWAY_SANDBOX_DIR=${sandbox}\n`);
    chmodSync(path.join(root, ".env.local"), 0o644);
    writeFileSync(path.join(root, ".env.agent"), "TEND_OPENAI_AGENT_KEY=fake\nTEND_ADMIN_TOKEN=fake\n");
    chmodSync(path.join(root, ".env.agent"), 0o600);
    mkdirSync(sandbox, { mode: 0o755 });
    chmodSync(sandbox, 0o755);
    writeFileSync(path.join(root, ".gitignore"), "node_modules\n");
    const f = diagnose({ root, env: { TEND_ADMIN_TOKEN: "x" }, platform: "linux", confinement: false });
    assert.deepEqual(levels(f, /\.env\.local is readable/), ["warn"]);
    assert.deepEqual(levels(f, /holds server-only variables \(TEND_ADMIN_TOKEN\)/), ["fail"]);
    assert.deepEqual(levels(f, /sandbox folder is accessible/), ["warn"]);
    assert.deepEqual(levels(f, /confinement is not available on linux/i), ["warn"]);
    assert.deepEqual(levels(f, /shell exports server-only/), ["warn"]);
    assert.equal(f.filter((x) => x.level === "fail" && /not git-ignored/.test(x.text)).length, 2);
    assert.ok(f.every((x) => !x.text.includes("fake")), "no value is ever printed");
  } finally {
    cleanup();
  }
});

test("a clean setup has no warning and no failure except the standing same-user note", () => {
  const { root, cleanup } = make();
  try {
    const sandbox = path.join(root, "sbx");
    writeFileSync(path.join(root, ".env.local"), `TEND_GATEWAY_SANDBOX_DIR=${sandbox}\n`);
    writeFileSync(path.join(root, ".env.agent"), "TEND_OPENAI_AGENT_KEY=fake\n");
    mkdirSync(sandbox, { mode: 0o700 });
    for (const p of [".env.local", ".env.agent"]) chmodSync(path.join(root, p), 0o600);
    chmodSync(sandbox, 0o700);
    const f = diagnose({ root, env: {}, platform: "darwin", confinement: true });
    assert.deepEqual(f.filter((x) => x.level === "warn" || x.level === "fail"), []);
    assert.ok(f.some((x) => x.level === "info" && /can read all of the above/.test(x.text)), "the standing limitation is always stated");
  } finally {
    cleanup();
  }
});
