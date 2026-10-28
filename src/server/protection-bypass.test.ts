import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { tendHttp } from "../../examples/real-agents/toolbox.mjs";

test("the agent client sends the deployment-protection bypass header only when TEND_PROTECTION_BYPASS is set, and never mixes it up with the key", async () => {
  const seen: Record<string, string | undefined>[] = [];
  const names = ["TEND_PROTECTION_BYPASS", "TEND_CF_ACCESS_CLIENT_ID", "TEND_CF_ACCESS_CLIENT_SECRET"];
  const saved = Object.fromEntries(names.map((n) => [n, process.env[n]]));
  const server = createServer((req, res) => {
    seen.push({ bypass: req.headers["x-vercel-protection-bypass"] as string | undefined, cfId: req.headers["cf-access-client-id"] as string | undefined, cfSecret: req.headers["cf-access-client-secret"] as string | undefined, auth: req.headers.authorization });
    res.setHeader("content-type", "application/json");
    res.end("{}");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    for (const n of names) delete process.env[n];
    await tendHttp(url, "tend_sk_KEY")("/x");
    process.env.TEND_PROTECTION_BYPASS = "bypass-secret-123";
    await tendHttp(url, "tend_sk_KEY")("/x");
    process.env.TEND_CF_ACCESS_CLIENT_ID = "cf-id.access";
    await tendHttp(url, "tend_sk_KEY")("/x"); // the id alone is not enough: both halves or nothing
    process.env.TEND_CF_ACCESS_CLIENT_SECRET = "cf-secret-456";
    await tendHttp(url, "tend_sk_KEY")("/x");
    assert.deepEqual(seen, [
      { bypass: undefined, cfId: undefined, cfSecret: undefined, auth: "Bearer tend_sk_KEY" },
      { bypass: "bypass-secret-123", cfId: undefined, cfSecret: undefined, auth: "Bearer tend_sk_KEY" },
      { bypass: "bypass-secret-123", cfId: undefined, cfSecret: undefined, auth: "Bearer tend_sk_KEY" },
      { bypass: "bypass-secret-123", cfId: "cf-id.access", cfSecret: "cf-secret-456", auth: "Bearer tend_sk_KEY" },
    ]);
  } finally {
    for (const n of names) if (saved[n] === undefined) delete process.env[n]; else process.env[n] = saved[n];
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});
