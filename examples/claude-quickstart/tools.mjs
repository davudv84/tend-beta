// Three harmless demo tools for a Claude agent, and what TEND is asked for each. They only touch lists in memory: no files, no network.
// `plan(world, name, input)` returns the request TEND will judge and the function that runs only if TEND says yes. Both are built from the
// same values, so what a person approves is byte for byte what runs.
export const createWorld = () => ({
  notes: { "N-1": "FICTIONAL note: the quarterly picnic is on Friday." },
  outbox: [],
  records: { "R-7": "FICTIONAL record" },
  runs: { read_demo_note: 0, send_demo_email: 0, delete_demo_record: 0 },
});

const obj = (properties, required) => ({ type: "object", properties, required, additionalProperties: false });
export const TOOLS = [
  { name: "read_demo_note", description: "Read a fictional demo note by id, for example N-1. Harmless and read only.", input_schema: obj({ id: { type: "string", pattern: "^N-[0-9]{1,3}$" } }, ["id"]) },
  { name: "send_demo_email", description: "Send a fictional demo email to a fictional recipient id such as team-1. Harmless: it only adds a line to a local list. A person approves every email first.", input_schema: obj({ to: { type: "string", pattern: "^team-[0-9]{1,2}$" }, subject: { type: "string", maxLength: 50 }, body: { type: "string", maxLength: 100 } }, ["to", "subject", "body"]) },
  { name: "delete_demo_record", description: "Delete a fictional demo record by id, for example R-7. Harmless: it only removes a line from a local list. Company policy may forbid it.", input_schema: obj({ id: { type: "string", pattern: "^R-[0-9]{1,3}$" } }, ["id"]) },
];

/** What the operator decides for each tool. Anything not listed is refused. */
export const POLICY = [
  { tool: "read_demo_note", action: "read", effect: "allow" },
  { tool: "send_demo_email", action: "send", effect: "approve" },
  { tool: "delete_demo_record", action: "delete", effect: "deny" },
];

export const SYSTEM = "You are a test assistant with a few harmless demo tools that only touch fictional data. If a tool result says an action was denied, rejected, refused or not executed, do not retry it or look for a way around it: say plainly that it did not happen. Be brief.";

export function plan(world, name, i) {
  const run = (fn) => () => (world.runs[name]++, fn());
  if (name === "read_demo_note") return { req: { tool: name, action: "read", resource: i.id, detail: `Read demo note ${i.id}` }, run: run(() => world.notes[i.id] ?? "no such note") };
  if (name === "send_demo_email") return { req: { tool: name, action: "send", resource: i.to, detail: `To ${i.to}; subject: ${i.subject}; body: ${i.body}` }, run: run(() => (world.outbox.push({ to: i.to, subject: i.subject, body: i.body }), "queued in the local demo outbox")) };
  if (name === "delete_demo_record") return { req: { tool: name, action: "delete", resource: i.id, detail: `Delete demo record ${i.id}` }, run: run(() => (delete world.records[i.id], "deleted from the local demo list")) };
  return null;
}
