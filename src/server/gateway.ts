// Secure execution gateway: the agent asks Tend to run a tool; Tend holds the credential and runs it.
//
//   POST /api/v1/gateway/requests  { tool, params }                              → an authorization (approved | pending | denied)
//   POST /api/v1/authorizations/{id}/token                                        → a single-use token once approved (unchanged)
//   POST /api/v1/gateway/execute   { authorizationId, token, tool, params }      → the tool runs once, here, and its sanitized result
//
// Rules this file keeps:
//  - Only tools in TOOLS exist. Each has a strict parameter schema (exact keys, exact types, no coercion) and
//    takes no URL, command, path or code: destinations are looked up server-side from fixed tables.
//  - What a person approves (resource, detail) is derived here from the validated params, and execution derives
//    it again from the params it is about to use, so the approval binds the exact action. The authorization,
//    its expiry, single use, agent binding and revocation are authz.ts's, unchanged: one atomic consume decides.
//  - The credential is read from the server environment at execution time and passed only to the tool function.
//    It is never returned, stored, put in an event or logged; tool output passes through a per-tool allowlist.
//  - Errors from the tool are reduced to a code. Upstream messages never reach the agent, the event log or the console.
//  - Every refusal and every execution leaves an event (identifiers only, never params beyond the bound fields).
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Agent } from "../lib/types";
import { consumeAuthorization, requestAuthorization } from "./authz.ts";
import type { DB } from "./db.ts";
import { HttpError } from "./http.ts";
import { ID } from "./policy.ts";
import { insertEvent } from "./repo.ts";

type Parsed<P> = { ok: true; params: P } | { ok: false; errors: string[] };
type Ctx = { credential: string; idempotencyKey: string; signal: AbortSignal };

interface Tool<P> {
  action: string;
  /** What a business owner is told about it: read = looks at things, write = changes things, spend = moves money, test = does nothing real. */
  risk: "read" | "write" | "spend" | "test";
  parse(input: unknown): Parsed<P>;
  /** What the authorization is bound to and a person reads. Must be injective over valid params. */
  describe(p: P): { resource: string; detail: string };
  /** The gateway-held secret. Undefined means the tool is unavailable (fail closed). */
  credential(): string | undefined;
  run(p: P, ctx: Ctx): Promise<unknown>;
  /** The only fields of the tool's answer the agent ever sees. */
  output(raw: unknown): Record<string, string | number>;
  timeoutMs: number;
  /** Attempts for errors the tool marks transient. Timeouts are never retried: the tool may have acted. */
  maxAttempts: number;
}

/** Thrown by tool functions. `transient` errors may be retried with the same idempotency key. */
export class ToolError extends Error {
  transient: boolean;
  constructor(transient: boolean, code: string) {
    super(code);
    this.transient = transient;
  }
}

// ---- where the gateway's folder and payments key come from ---------------------------------------------------------
// Normally the server's environment. The protection checks (verification.ts) run the same code on a private copy, so they
// can replace both for the code they run, and only for that: nothing global is changed, so real requests in the same process
// keep reading the real environment. Inside a replacement an unset value stays unset (it never falls back to the real one).

interface GatewayConfig { notesDir?: string; paymentsKey?: string; sandboxDir?: string }
const configScope = new AsyncLocalStorage<GatewayConfig>();
export const withGatewayConfig = <T>(config: GatewayConfig, fn: () => Promise<T>) => configScope.run(config, fn);
const setting = (key: keyof GatewayConfig, envName: string) => {
  const scoped = configScope.getStore();
  return scoped ? scoped[key] : process.env[envName];
};

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const exactKeys = (o: Record<string, unknown>, keys: string[], errors: string[]) => {
  for (const k of Object.keys(o)) if (!keys.includes(k)) errors.push(`unknown field ${k}`);
};

// ---- the example tool: pay a fake invoice through a fake payments API ----------------------------------------
// No real money or system anywhere. The payee is chosen from a server-side directory, never an account number or URL.

export const PAYEES: Record<string, string> = { "PAYEE-1": "Fake Supplier GmbH", "PAYEE-2": "Example Office Supplies Ltd" };
const CURRENCIES = ["EUR", "USD"];
export const MAX_CENTS = 100_000;
interface Payment { invoice: string; amountCents: number; currency: string; payee: string }

const g = globalThis as { __tendFakePayments?: Map<string, { calls: number; record?: Record<string, unknown> }> };
/** The fake upstream's ledger, keyed by idempotency key. Tests read `calls` to prove a single execution. */
export const fakePayments = () => (g.__tendFakePayments ??= new Map());

/**
 * Stands in for a remote payments API that requires a secret key. Deliberately leaky: its answer echoes the
 * key, as careless real APIs do in debug fields, so the gateway's output allowlist is exercised.
 * Fake behaviours for demonstrating failure handling: INV-503 fails transiently once, INV-504 never answers.
 */
async function fakePaymentsApi(p: Payment, { credential, idempotencyKey, signal }: Ctx) {
  if (credential !== setting("paymentsKey", "TEND_GATEWAY_PAYMENTS_KEY")) throw new ToolError(false, "unauthorized");
  const entry = fakePayments().get(idempotencyKey) ?? { calls: 0 };
  fakePayments().set(idempotencyKey, entry);
  entry.calls++;
  if (entry.record) return entry.record; // the upstream honours idempotency keys, so a retry never pays twice
  if (p.invoice === "INV-504") await new Promise((_, reject) => signal.addEventListener("abort", () => reject(new ToolError(false, "aborted")), { once: true }));
  if (p.invoice === "INV-503" && entry.calls === 1) throw new ToolError(true, "unavailable");
  entry.record = { id: `pay_${randomUUID().replaceAll("-", "").slice(0, 16)}`, status: "settled", ...p, debug: { authorization: `Bearer ${credential}` } };
  return entry.record;
}

const payInvoice: Tool<Payment> = {
  action: "execute",
  risk: "spend",
  parse(input) {
    if (!obj(input)) return { ok: false, errors: ["params must be a JSON object"] };
    const errors: string[] = [];
    exactKeys(input, ["invoice", "amountCents", "currency", "payee"], errors);
    const { invoice, amountCents, currency, payee } = input;
    if (typeof invoice !== "string" || !/^INV-[0-9]{1,10}$/.test(invoice)) errors.push("invoice must look like INV-123");
    if (typeof amountCents !== "number" || !Number.isSafeInteger(amountCents) || amountCents < 1 || amountCents > MAX_CENTS) errors.push(`amountCents must be an integer from 1 to ${MAX_CENTS}`);
    if (typeof currency !== "string" || !CURRENCIES.includes(currency)) errors.push(`currency must be one of ${CURRENCIES.join(", ")}`);
    if (typeof payee !== "string" || !Object.hasOwn(PAYEES, payee)) errors.push(`payee must be one of ${Object.keys(PAYEES).join(", ")}`);
    return errors.length ? { ok: false, errors } : { ok: true, params: { invoice, amountCents, currency, payee } as Payment };
  },
  describe: (p) => ({
    resource: p.invoice,
    detail: `${p.currency} ${Math.floor(p.amountCents / 100)}.${String(p.amountCents % 100).padStart(2, "0")} to ${PAYEES[p.payee]} (${p.payee})`,
  }),
  credential: () => {
    const k = setting("paymentsKey", "TEND_GATEWAY_PAYMENTS_KEY") ?? "";
    return k.length >= 24 ? k : undefined;
  },
  run: fakePaymentsApi,
  output: (raw) => {
    const r = obj(raw) ? raw : {};
    return { paymentId: String(r.id ?? ""), status: String(r.status ?? "") };
  },
  timeoutMs: 3_000,
  maxAttempts: 2,
};

// ---- notes tools: list, read and write inside a server-chosen directory --------------------------------------
// The directory is TEND_GATEWAY_NOTES_DIR (absolute; unset means the tools are off). It plays the credential's part:
// the agent never learns it and names only the note, from a fixed alphabet, so no path can be smuggled in.

const NOTE_NAME = /^[a-z0-9][a-z0-9-]{0,31}$/;
const NOTE_FILE = /^[a-z0-9][a-z0-9-]{0,31}\.txt$/;
const NOTE_TEXT = /^[\x20-\x7e]{1,160}$/;
const READ_MAX = 400;

interface NoteName { name: string }
interface Note { name: string; text: string }

function notesDir(): string | undefined {
  const dir = setting("notesDir", "TEND_GATEWAY_NOTES_DIR") ?? "";
  return path.isAbsolute(dir) ? dir : undefined;
}

function parseNoteName(input: unknown, keys: string[]): Parsed<NoteName> {
  if (!obj(input)) return { ok: false, errors: ["params must be a JSON object"] };
  const errors: string[] = [];
  exactKeys(input, keys, errors);
  const name = input.name;
  if (typeof name !== "string" || !NOTE_NAME.test(name)) errors.push("name must be 1–32 characters of a-z, 0-9 and -, starting with a letter or digit");
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  
  return { ok: true, params: { name: name as string } };
}

async function notePath(dir: string, name: string) {
  const file = path.join(dir, `${name}.txt`);
  let st;
  try {
    st = await lstat(file);
  } catch {
    throw new ToolError(false, "not_found");
  }
  if (!st.isFile() || st.isSymbolicLink()) throw new ToolError(false, "not_found");
  // Refuse before reading: a huge file dropped in the folder must not be loaded into memory only to be refused afterwards.
  if (st.size > READ_MAX * 4) throw new ToolError(false, "too_large");
  return file;
}

const listNotes: Tool<Record<string, never>> = {
  action: "list",
  risk: "read",
  parse(input) {
    if (!obj(input)) return { ok: false, errors: ["params must be a JSON object"] };
    const errors: string[] = [];
    exactKeys(input, [], errors);
    return errors.length ? { ok: false, errors } : { ok: true, params: {} };
  },
  describe: () => ({ resource: "notes", detail: "list files" }),
  credential: notesDir,
  async run(_p, { credential: dir }) {
    try {
      const names = (await readdir(dir, { withFileTypes: true }))
        .filter((e) => e.isFile() && !e.isSymbolicLink() && NOTE_FILE.test(e.name))
        .map((e) => e.name.slice(0, -4))
        .sort();
      return { names: names.join(","), count: names.length };
    } catch {
      throw new ToolError(false, "list_failed");
    }
  },
  output: (raw) => {
    const r = obj(raw) ? raw : {};
    return { names: String(r.names ?? ""), count: Number(r.count ?? 0) };
  },
  timeoutMs: 3_000,
  maxAttempts: 1,
};

const readNote: Tool<NoteName> = {
  action: "read",
  risk: "read",
  parse(input) {
    const parsed = parseNoteName(input, ["name"]);
    return parsed.ok ? { ok: true, params: parsed.params } : { ok: false, errors: parsed.errors };
  },
  describe: (p) => ({ resource: `${p.name}.txt`, detail: `read ${p.name}.txt` }),
  credential: notesDir,
  async run(p, { credential: dir }) {
    const file = await notePath(dir, p.name);
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      throw new ToolError(false, "read_failed");
    }
    if (text.length > READ_MAX) throw new ToolError(false, "too_large");
    return { file: `${p.name}.txt`, text, bytes: text.length };
  },
  output: (raw) => {
    const r = obj(raw) ? raw : {};
    return { file: String(r.file ?? ""), text: String(r.text ?? ""), bytes: Number(r.bytes ?? 0) };
  },
  timeoutMs: 3_000,
  maxAttempts: 1,
};

const writeNote: Tool<Note> = {
  action: "create",
  risk: "write",
  parse(input) {
    const parsed = parseNoteName(input, ["name", "text"]);
    if (!parsed.ok) return parsed;
    if (!obj(input) || typeof input.text !== "string" || !NOTE_TEXT.test(input.text)) {
      return { ok: false, errors: ["text must be 1–160 printable ASCII characters"] };
    }
    return { ok: true, params: { name: parsed.params.name, text: input.text } };
  },
  // The whole text is the detail, so the person approves the exact bytes that will be written.
  describe: (p) => ({ resource: `${p.name}.txt`, detail: p.text }),
  credential: notesDir,
  async run(p, { credential: dir }) {
    try {
      // "wx": never overwrite, and O_EXCL refuses to follow a symlink planted at the name.
      await writeFile(path.join(dir, `${p.name}.txt`), `${p.text}\n`, { flag: "wx" });
    } catch {
      throw new ToolError(false, "write_failed");
    }
    return { file: `${p.name}.txt`, bytes: p.text.length + 1 };
  },
  output: (raw) => {
    const r = obj(raw) ? raw : {};
    return { file: String(r.file ?? ""), bytes: Number(r.bytes ?? 0) };
  },
  timeoutMs: 3_000,
  maxAttempts: 1,
};

// ---- sandbox tools: read, write and delete disposable test files -------------------------------------------------
// For trying real agents safely. TEND_GATEWAY_SANDBOX_DIR (absolute; unset means the tools are off) plays the credential's part.
// The agent names a file, never a path: one flat name from a fixed alphabet with at most one dot, so there is no separator
// and no "..", and the name is also a valid authorization resource. On top of that the directory is resolved once and every
// file is checked to be a regular file inside it (no symlinks, opened with O_NOFOLLOW), so the alphabet is not the only defence.
// Suggested policy: read allow, write approve, delete deny. delete_test_file really deletes, so a "deny" rule is a real control.

const SANDBOX_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}(\.[a-z0-9]{1,8})?$/;
const SANDBOX_TEXT = /^[\x20-\x7e]{1,160}$/;
const SANDBOX_READ_MAX = 2_000;

interface SandboxFile { path: string }
interface SandboxWrite { path: string; text: string }

function sandboxDir(): string | undefined {
  const dir = setting("sandboxDir", "TEND_GATEWAY_SANDBOX_DIR") ?? "";
  return path.isAbsolute(dir) ? dir : undefined;
}

function parseSandboxFile(input: unknown, keys: string[]): Parsed<SandboxFile> {
  if (!obj(input)) return { ok: false, errors: ["params must be a JSON object"] };
  const errors: string[] = [];
  exactKeys(input, keys, errors);
  if (typeof input.path !== "string" || !SANDBOX_NAME.test(input.path)) errors.push("path must be one file name (letters, digits, - and _, at most one dot), not a folder path");
  return errors.length ? { ok: false, errors } : { ok: true, params: { path: input.path as string } };
}

/** The file's location inside the real sandbox directory. Throws unless the sandbox exists and the file would sit directly in it. */
async function sandboxFile(dir: string, name: string) {
  let root: string;
  try {
    root = await realpath(dir);
  } catch {
    throw new ToolError(false, "sandbox_unavailable");
  }
  const file = path.join(root, name);
  if (!SANDBOX_NAME.test(name) || path.dirname(file) !== root) throw new ToolError(false, "outside_sandbox");
  return file;
}

async function regularFile(file: string) {
  let st;
  try {
    st = await lstat(file);
  } catch {
    throw new ToolError(false, "not_found");
  }
  if (!st.isFile() || st.isSymbolicLink()) throw new ToolError(false, "not_found");
  return st;
}

const readTestFile: Tool<SandboxFile> = {
  action: "read",
  risk: "read",
  parse: (input) => parseSandboxFile(input, ["path"]),
  describe: (p) => ({ resource: p.path, detail: `read ${p.path}` }),
  credential: sandboxDir,
  async run(p, { credential: dir }) {
    const file = await sandboxFile(dir, p.path);
    const st = await regularFile(file);
    if (st.size > SANDBOX_READ_MAX * 4) throw new ToolError(false, "too_large");
    let text: string;
    try {
      const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW); // a symlink swapped in after the check is refused here
      try {
        text = await handle.readFile("utf8");
      } finally {
        await handle.close();
      }
    } catch {
      throw new ToolError(false, "read_failed");
    }
    if (text.length > SANDBOX_READ_MAX) throw new ToolError(false, "too_large");
    return { file: p.path, text, bytes: text.length };
  },
  output: (raw) => {
    const r = obj(raw) ? raw : {};
    return { file: String(r.file ?? ""), text: String(r.text ?? ""), bytes: Number(r.bytes ?? 0) };
  },
  timeoutMs: 3_000,
  maxAttempts: 1,
};

const writeTestFile: Tool<SandboxWrite> = {
  action: "create",
  risk: "write",
  parse(input) {
    const parsed = parseSandboxFile(input, ["path", "text"]);
    if (!parsed.ok) return parsed;
    if (!obj(input) || typeof input.text !== "string" || !SANDBOX_TEXT.test(input.text)) return { ok: false, errors: ["text must be 1–160 printable ASCII characters"] };
    return { ok: true, params: { path: parsed.params.path, text: input.text } };
  },
  // The whole text is the detail, so the person approves the exact bytes that will be written.
  describe: (p) => ({ resource: p.path, detail: p.text }),
  credential: sandboxDir,
  async run(p, { credential: dir }) {
    const file = await sandboxFile(dir, p.path);
    try {
      await writeFile(file, `${p.text}\n`, { flag: "wx" }); // never overwrites, and O_EXCL refuses to follow a symlink planted at the name
    } catch {
      throw new ToolError(false, "write_failed");
    }
    return { file: p.path, bytes: p.text.length + 1 };
  },
  output: (raw) => {
    const r = obj(raw) ? raw : {};
    return { file: String(r.file ?? ""), bytes: Number(r.bytes ?? 0) };
  },
  timeoutMs: 3_000,
  maxAttempts: 1,
};

const deleteTestFile: Tool<SandboxFile> = {
  action: "delete",
  risk: "write",
  parse: (input) => parseSandboxFile(input, ["path"]),
  describe: (p) => ({ resource: p.path, detail: `delete ${p.path}` }),
  credential: sandboxDir,
  async run(p, { credential: dir }) {
    const file = await sandboxFile(dir, p.path);
    await regularFile(file);
    try {
      await unlink(file); // removes the name itself; it never follows a symlink
    } catch {
      throw new ToolError(false, "delete_failed");
    }
    return { file: p.path };
  },
  output: (raw) => ({ file: String(obj(raw) ? (raw.file ?? "") : "") }),
  timeoutMs: 3_000,
  maxAttempts: 1,
};

// ---- the connection test: does nothing real -----------------------------------------------------------------
// It exists so a new agent can prove the whole path (ask, get approved, spend the token, run here) without touching anything.
// It goes through exactly the same authorization as every other tool, so it is blocked until a rule says otherwise.

const PING_MESSAGE = /^[A-Za-z0-9 ]{1,40}$/;
interface Ping { message: string }

const testPing: Tool<Ping> = {
  action: "ping",
  risk: "test",
  parse(input) {
    if (!obj(input)) return { ok: false, errors: ["params must be a JSON object"] };
    const errors: string[] = [];
    exactKeys(input, ["message"], errors);
    if (typeof input.message !== "string" || !PING_MESSAGE.test(input.message)) errors.push("message must be 1–40 letters, digits and spaces");
    return errors.length ? { ok: false, errors } : { ok: true, params: { message: input.message as string } };
  },
  // The whole message is the detail, so the person approves exactly what will be echoed.
  describe: (p) => ({ resource: "test", detail: `Say: ${p.message}` }),
  // Nothing secret is involved; a constant keeps the tool shaped like the others (and "unavailable" still means fail closed).
  credential: () => "built-in",
  run: async (p) => ({ reply: `pong: ${p.message}` }),
  output: (raw) => ({ reply: String(obj(raw) ? (raw.reply ?? "") : "") }),
  timeoutMs: 3_000,
  maxAttempts: 1,
};

/** The allowlist. A tool not named here cannot be requested or run. */
const TOOLS: Record<string, Tool<unknown>> = {
  pay_invoice: payInvoice as unknown as Tool<unknown>,
  test_ping: testPing as unknown as Tool<unknown>,
  list_notes: listNotes as unknown as Tool<unknown>,
  read_note: readNote as unknown as Tool<unknown>,
  write_note: writeNote as unknown as Tool<unknown>,
  read_test_file: readTestFile as unknown as Tool<unknown>,
  write_test_file: writeTestFile as unknown as Tool<unknown>,
  delete_test_file: deleteTestFile as unknown as Tool<unknown>,
};

/** What the permissions screen lists: every gateway tool, its action and risk, and whether this server has it set up. */
export const toolCatalog = () =>
  Object.entries(TOOLS).map(([tool, t]) => ({ tool, action: t.action, risk: t.risk, available: t.credential() !== undefined }));

// ---- the gateway ---------------------------------------------------------------------------------------------

function lookup(name: unknown) {
  if (typeof name !== "string" || !Object.hasOwn(TOOLS, name)) throw new HttpError(404, "unknown_tool", "The gateway has no such tool.");
  return { name, tool: TOOLS[name] };
}

function bind(name: string, tool: Tool<unknown>, params: unknown) {
  const parsed = tool.parse(params);
  if (!parsed.ok) throw new HttpError(422, "invalid_params", "The tool parameters did not validate.", { errors: parsed.errors });
  return { params: parsed.params, bound: { tool: name, action: tool.action, ...tool.describe(parsed.params) } };
}

/** Asks for an authorization to run a gateway tool. Answers exactly like POST /api/v1/authorizations. */
export async function requestExecution(db: DB, agent: Agent, body: unknown, idemKey: string | null, now = Date.now()) {
  if (!obj(body)) throw new HttpError(422, "invalid_request", "Body must be a JSON object.");
  const errors: string[] = [];
  exactKeys(body, ["tool", "params"], errors);
  if (errors.length) throw new HttpError(422, "invalid_request", "The request did not validate.", { errors });
  const { name, tool } = lookup(body.tool);
  return requestAuthorization(db, agent, bind(name, tool, body.params).bound, idemKey, now);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const abortion = (signal: AbortSignal) => new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(new ToolError(false, "timeout")), { once: true }));

/** Runs the tool with a timeout per attempt and a bounded number of retries. Returns a code, never an upstream message. */
async function invoke(tool: Tool<unknown>, params: unknown, credential: string, idempotencyKey: string) {
  for (let attempt = 1; ; attempt++) {
    const signal = AbortSignal.timeout(tool.timeoutMs);
    try {
      return { ok: true as const, raw: await Promise.race([tool.run(params, { credential, idempotencyKey, signal }), abortion(signal)]) };
    } catch (e) {
      if (signal.aborted) return { ok: false as const, error: "timeout" };
      if (!(e instanceof ToolError && e.transient) || attempt >= tool.maxAttempts) return { ok: false as const, error: "tool_error" };
      await sleep(100 * attempt);
    }
  }
}

/**
 * The outcome event is written after the tool ran, so it cannot be part of the consume transaction. It is retried, and if
 * it still fails the action is not undone or hidden: `authorization.consumed` (written with the consume) stays as the
 * durable record that it was authorized, and the missing outcome is the visible sign that this write failed.
 */
const RECORD_ATTEMPTS = 3;
async function record(db: DB, agentId: string, data: Record<string, unknown>) {
  for (let attempt = 1; attempt <= RECORD_ATTEMPTS; attempt++) {
    try {
      await db.tx((q) => insertEvent(q, { agentId, type: "tool.called", actor: "system", data: { ...data, via: "gateway" } }));
      return;
    } catch {
      if (attempt < RECORD_ATTEMPTS) await sleep(50 * attempt);
    }
  }
  console.error("[tend] gateway could not record an event"); // no data: it may describe the action
}

/**
 * Spends the authorization and runs the tool, once. A 200 means the tool confirmed success. Any other answer
 * means it did not run or its outcome is unknown; the authorization is spent either way once consume succeeded.
 */
export async function executeTool(db: DB, agent: Agent, body: unknown, now = Date.now()) {
  if (!obj(body)) throw new HttpError(422, "invalid_request", "Body must be a JSON object.");
  const errors: string[] = [];
  exactKeys(body, ["authorizationId", "token", "tool", "params"], errors);
  if (typeof body.authorizationId !== "string" || !ID.test(body.authorizationId)) errors.push("authorizationId is required");
  if (errors.length) throw new HttpError(422, "invalid_request", "The request did not validate.", { errors });
  const { name, tool } = lookup(body.tool);
  const authorizationId = body.authorizationId as string;

  let bound: { tool: string; action: string; resource?: string; detail?: string } = { tool: name, action: tool.action }, params: unknown, credential: string | undefined;
  try {
    ({ params, bound } = bind(name, tool, body.params));
    credential = tool.credential();
    // Checked before consuming, so an unconfigured gateway never spends an approval.
    if (!credential) throw new HttpError(503, "tool_unavailable", "This tool is not configured on the gateway.");
    await consumeAuthorization(db, agent, authorizationId, { token: body.token, ...bound }, now);
  } catch (e) {
    if (e instanceof HttpError) await record(db, agent.id, { ...bound, outcome: "denied", authorizationId, error: e.code });
    throw e;
  }

  const out = await invoke(tool, params, credential, authorizationId);
  await record(db, agent.id, { ...bound, outcome: out.ok ? "success" : "failure", authorizationId, ...(!out.ok && { error: out.error }) });
  if (!out.ok)
    throw new HttpError(502, "execution_failed", "The tool did not confirm success. The authorization is spent and the outcome may be unknown; ask for a new authorization to try again.", { reason: out.error, authorizationId });
  return { executed: true, authorizationId, ...bound, result: tool.output(out.raw) };
}
