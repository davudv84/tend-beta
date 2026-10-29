#!/usr/bin/env node
// A harmless MCP stdio server for trying TEND's MCP proxy with a real MCP host: three tools over fictional notes held in memory.
// Nothing touches the network or your files, except the optional ledger: a file, given as the first argument, that gets one JSON line
// per tool that actually ran. The integration verification suite reads it to see what ran; you can ignore it.
//
//   node examples/mcp-proxy/tend-mcp-proxy.mjs -- node examples/mcp-proxy/notes-server.mjs
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const ledger = process.argv[2];
const notes = { "N-1": "Buy oat milk.", "N-2": "Team lunch on Friday." };
export const NOTE_TOOLS = [
  { name: "read_note", description: "Read a note by its id.", params: { id: "The note id, for example N-1" } },
  { name: "delete_note", description: "Delete a note by its id.", params: { id: "The note id, for example N-1" } },
  { name: "send_note", description: "Send a note to a recipient.", params: { id: "The note id, for example N-1", to: "The recipient, for example team-1" } },
];
const schema = (t) => ({ type: "object", properties: Object.fromEntries(Object.entries(t.params).map(([k, d]) => [k, { type: "string", description: d }])), required: Object.keys(t.params) });

/** What each tool does. Only in-memory notes change; the ledger line is written only when a tool really ran. */
export function runNoteTool(name, args, ledgerFile = ledger) {
  if (ledgerFile) appendFileSync(ledgerFile, `${JSON.stringify({ ev: "ran", tool: name, args })}\n`);
  const note = notes[args?.id];
  if (!note) return `There is no note ${args?.id}.`;
  if (name === "read_note") return `Note ${args.id}: ${note}`;
  if (name === "delete_note") return delete notes[args.id], `Deleted note ${args.id}.`;
  if (name === "send_note") return `Sent note ${args.id} to ${args.to}.`;
  return `Unknown tool ${name}.`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = (id, r) => process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, ...r })}\n`);
  createInterface({ input: process.stdin }).on("line", (line) => {
    let m;
    try { m = JSON.parse(line); } catch { return; }
    if (m.id === undefined) return; // notifications need no answer
    if (m.method === "initialize") return out(m.id, { result: { protocolVersion: m.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "tend-notes", version: "1.0.0" } } });
    if (m.method === "tools/list") return out(m.id, { result: { tools: NOTE_TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: schema(t) })) } });
    if (m.method === "tools/call") return out(m.id, { result: { content: [{ type: "text", text: runNoteTool(m.params?.name, m.params?.arguments ?? {}) }] } });
    if (m.method === "ping") return out(m.id, { result: {} });
    out(m.id, { error: { code: -32601, message: `Method not found: ${m.method}` } });
  });
}
