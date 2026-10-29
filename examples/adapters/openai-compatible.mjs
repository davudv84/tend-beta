// One adapter for every provider that speaks the OpenAI-compatible Chat Completions API: OpenAI, Google Gemini, Mistral, Groq, Ollama,
// Anthropic's compatibility endpoint, and any self-hosted server with the same API. A small tool loop with no dependencies; each tool body
// is expected to be wrapped with guardTool() so it runs only on TEND's yes.
//
//   const out = await runChatAgent({ provider: "groq", model: "llama-3.3-70b-versatile", tools, prompt });
//   tools: [{ name, description, params: { field: "description" }, run: guardTool(gate, name, fn) }]
export const PROVIDERS = {
  openai: { baseURL: "https://api.openai.com/v1", keyEnv: "OPENAI_API_KEY" },
  gemini: { baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", keyEnv: "GEMINI_API_KEY" },
  mistral: { baseURL: "https://api.mistral.ai/v1", keyEnv: "MISTRAL_API_KEY" },
  groq: { baseURL: "https://api.groq.com/openai/v1", keyEnv: "GROQ_API_KEY" },
  ollama: { baseURL: "http://127.0.0.1:11434/v1", keyEnv: null }, // local: no key
  anthropic: { baseURL: "https://api.anthropic.com/v1", keyEnv: "ANTHROPIC_API_KEY" }, // Anthropic's OpenAI SDK compatibility endpoint
};

const fnSpec = (t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: { type: "object", properties: Object.fromEntries(Object.entries(t.params).map(([k, d]) => [k, { type: "string", description: d }])), required: Object.keys(t.params) } } });

/**
 * @returns { final, usage: { in, out, calls }, toolCalls: [{ name, args }], error? }   error is set (and nothing more runs) on any API failure.
 */
export async function runChatAgent({ provider, baseURL = PROVIDERS[provider]?.baseURL, apiKey = PROVIDERS[provider]?.keyEnv ? process.env[PROVIDERS[provider].keyEnv] : "local", model, tools, system, prompt, maxTurns = 4, maxTokens = 400, timeoutMs = 60_000 }) {
  const messages = [...(system ? [{ role: "system", content: system }] : []), { role: "user", content: prompt }];
  const usage = { in: 0, out: 0, calls: 0 }, toolCalls = [];
  for (let turn = 0; turn < maxTurns; turn++) {
    let res, data;
    try {
      res = await fetch(`${baseURL.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, max_tokens: maxTokens, messages, tools: tools.map(fnSpec) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      data = await res.json();
    } catch (e) {
      return { final: "", usage, toolCalls, error: `provider unreachable (${e.name})` };
    }
    if (!res.ok) return { final: "", usage, toolCalls, error: `provider ${res.status}: ${String(data?.error?.message ?? data?.error ?? "").slice(0, 160)}` };
    usage.in += data.usage?.prompt_tokens ?? 0;
    usage.out += data.usage?.completion_tokens ?? 0;
    usage.calls++;
    const msg = data.choices?.[0]?.message ?? {};
    const calls = msg.tool_calls ?? [];
    messages.push({ role: "assistant", content: msg.content ?? "", ...(calls.length && { tool_calls: calls }) });
    if (!calls.length) return { final: msg.content ?? "", usage, toolCalls };
    for (const c of calls) {
      let args = {};
      try { args = JSON.parse(c.function?.arguments || "{}"); } catch { /* the tool gets {} and says what is missing */ }
      const tool = tools.find((t) => t.name === c.function?.name);
      toolCalls.push({ name: c.function?.name, args });
      const result = tool ? await tool.run(args) : `There is no tool named ${c.function?.name}.`;
      messages.push({ role: "tool", tool_call_id: c.id, content: String(result) });
    }
  }
  return { final: "", usage, toolCalls, stopped: "max_turns" };
}
