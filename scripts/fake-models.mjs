// Local stand-ins for the OpenAI Responses API and the Anthropic Messages API that play back scripted tool calls.
// They let the real SDKs and the real example agents run end to end WITHOUT an API key or any network access.
// Used by src/server/real-agents.test.ts and `npm run agents:try`. They are not models: they do not read the prompt.
//
//   script = { turns: [[{ name, input, id? }, …], …], final: "text" }   one array per model turn, then the closing text
//   fake.told   every tool result the SDK sent back to the "model" (what the model would have seen)
import { createServer } from "node:http";

export function listen(handler) {
  const server = createServer(handler);
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((r) => (server.closeAllConnections(), server.close(() => r()))),
      })));
}

const readJson = async (req) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString() || "{}");
};

/** Anthropic Messages API stand-in. Each request is one turn. */
export async function fakeAnthropic({ turns, final }) {
  const told = [];
  let n = 0;
  const s = await listen(async (req, res) => {
    const body = await readJson(req);
    for (const m of body.messages ?? []) if (Array.isArray(m.content)) for (const b of m.content) if (b.type === "tool_result") told.push(String(b.content));
    const calls = turns[n++];
    const content = calls
      ? calls.map((c, i) => ({ type: "tool_use", id: c.id ?? `toolu_${n}_${i}`, name: c.name, input: c.input }))
      : [{ type: "text", text: final }];
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: `msg_${n}`, type: "message", role: "assistant", model: body.model, content, stop_reason: calls ? "tool_use" : "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } }));
  });
  return Object.assign(s, { told });
}

/** OpenAI Responses API stand-in. */
export async function fakeOpenAI({ turns, final }) {
  const told = [];
  let n = 0;
  const s = await listen(async (req, res) => {
    const body = await readJson(req);
    for (const it of body.input ?? []) if (it.type === "function_call_output") told.push(String(typeof it.output === "string" ? it.output : JSON.stringify(it.output)));
    const calls = turns[n++];
    const output = calls
      ? calls.map((c, i) => ({ type: "function_call", id: `fc_${n}_${i}`, call_id: c.id ?? `call_${n}_${i}`, name: c.name, arguments: JSON.stringify(c.input), status: "completed" }))
      : [{ type: "message", id: `msg_${n}`, role: "assistant", status: "completed", content: [{ type: "output_text", text: final, annotations: [] }] }];
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: `resp_${n}`, object: "response", created_at: Math.floor(Date.now() / 1000), status: "completed", model: body.model, output, parallel_tool_calls: true, tool_choice: "auto", tools: [],
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
    }));
  });
  return Object.assign(s, { told });
}
