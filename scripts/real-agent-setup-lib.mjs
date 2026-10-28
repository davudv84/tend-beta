// The logic of `npm run agents:setup`, with the server and the disk passed in so it can be tested against a real database without a network.
//
// Why the order matters. TEND issues an agent's key once and a rotation destroys the old key in the same step. So a setup that rotates a
// key and then fails to save the new one leaves a dead key on disk, and every later agent run answers 401 invalid_key although setup
// "worked". The rules here:
//   1. Prove the key file can be written BEFORE changing anything on the server.
//   2. Never rotate a key that still works (a re-run must not break agents or shells that hold the current key). `rotate: true` forces it.
//   3. Save each key the moment it is issued, before any later step can fail.
//   4. At the end, read the file back the way the agents do and authenticate with it. If TEND refuses it, say so now, not at the first agent run.
import { explainRejectedKey, keyPrefix } from "../examples/real-agents/env.mjs";

/**
 * @param api     { url, signIn(), state(), register(body), rotate(id), setPolicy(id, rules), policyView(id), keyStatus(key, url?) → HTTP status }
 * @param files   { writable(), read() → object, write(object) }   the agent key file (.env.agent)
 * @param resolve (provider) → { key, source, url, warnings } exactly as the agent will resolve it, reading the disk again
 */
export async function setupAgents({ api, files, resolve, agents, policy, wanted, rotate = false, log = () => {} }) {
  files.writable(); // 1
  await api.signIn();
  const known = (await api.state())?.projection?.agents ?? [];
  const results = [];
  for (const provider of wanted) {
    const a = agents[provider];
    const existing = known.find((x) => x.name === a.name && x.origin === "connected");
    const keys = files.read();
    let id = existing?.id, key = keys[a.envVar], action = "kept";

    let usable = false;
    if (existing && key && !rotate) {
      const status = await api.keyStatus(key);
      usable = status === 200;
      // Only a definite "no" justifies destroying a key. A timeout, a rate limit or a server error says nothing about it.
      if (!usable && status !== 401) throw new Error(`Could not tell whether the saved ${a.envVar} still works (TEND answered HTTP ${status || "nothing"}). It was not rotated. Try again when TEND is healthy.`);
    }
    if (!usable) { // 2
      if (existing) {
        key = await api.rotate(existing.id);
        action = "rotated";
      } else {
        const reg = await api.register({ name: a.name, model: a.model, provider: a.provider, role: "Disposable test agent for the sandbox" });
        id = reg.id;
        key = reg.apiKey;
        action = "registered";
      }
      files.write({ ...files.read(), [a.envVar]: key, TEND_URL: api.url }); // 3
    } else if (keys.TEND_URL !== api.url) {
      files.write({ ...keys, TEND_URL: api.url });
    }
    await api.setPolicy(id, policy);
    const view = await api.policyView(id);
    const tools = view.tools.filter((t) => t.tool.endsWith("_test_file"));
    results.push({ provider, id, action, prefix: keyPrefix(key), tools });
    log(`${{ registered: "Registered", rotated: "Issued a new key for", kept: "Kept the working key of" }[action]} ${a.name} (${id}, key ${keyPrefix(key)}); policy: ${tools.map((t) => `${t.tool}=${t.effect}`).join(", ")}`);
    if (tools.some((t) => !t.available)) log("  ! The server does not have the sandbox switched on yet (the tools show \"not set up\").");
  }

  // 4: what the agents will use, read back from disk, must authenticate
  for (const r of results) {
    const got = resolve(r.provider);
    const status = got.key ? await api.keyStatus(got.key, got.url) : 0; // where the AGENT will send it, which may not be where setup talked
    if (status !== 200) {
      throw new Error(got.key ? explainRejectedKey(got, r.provider) : `No ${agents[r.provider].envVar} could be read back from .env.agent after saving it.`);
    }
    r.verified = true;
    for (const w of got.warnings) log(`  Warning: ${w}`);
  }
  return results;
}

/** `--check`: test the keys exactly as the agents resolve them. Changes nothing on the server or the disk. */
export async function checkAgents({ api, resolve, agents, wanted }) {
  const out = [];
  for (const provider of wanted) {
    const got = resolve(provider);
    const status = got.key ? await api.keyStatus(got.key, got.url) : 0;
    out.push({
      provider, ok: status === 200, status, warnings: got.warnings,
      text: status === 200 ? `${provider}: key ${keyPrefix(got.key)} from ${got.source} is accepted by ${got.url}.`
        : !got.key ? `${provider}: no key found (${agents[provider].envVar}). Run \`npm run agents:setup\`.`
        : status === 401 ? `${provider}: ${explainRejectedKey(got, provider)}`
        : `${provider}: TEND at ${got.url} did not answer sensibly (HTTP ${status || "no answer"}). Is it running?`,
    });
  }
  return out;
}
