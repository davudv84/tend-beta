"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckIcon, CopyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/client";
import { errorText } from "@/i18n";
import { connectionState, type ConnectionState, type IntegrationAgent, type IntegrationStatus, type ProviderKey } from "@/lib/integrations";
import { timeAgo, useNow } from "@/lib/format";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

const SETUP: Record<ProviderKey, string> = {
  OpenAI: `# 1. In the folder where TEND runs: register the agent, set its permissions, create its key
npm run agents:setup -- openai

# 2. Give the agent process your OpenAI key (it stays in .env.agent, which is git-ignored)
echo 'OPENAI_API_KEY=paste-your-key-here' >> .env.agent

# 3. Launch the agent, then approve or reject its requests under Approvals
npm run agents:openai`,
  Anthropic: `# 1. In the folder where TEND runs: register the agent, set its permissions, create its key
npm run agents:setup -- anthropic

# 2. Give the agent process your Anthropic key (it stays in .env.agent, which is git-ignored)
echo 'ANTHROPIC_API_KEY=paste-your-key-here' >> .env.agent

# 3. Launch the agent, then approve or reject its requests under Approvals
npm run agents:anthropic`,
};

const CUSTOM = `// examples/real-agents/toolbox.mjs is the whole adapter layer. Your framework only has to call this:
import { startSession, tendHttp } from "./examples/real-agents/toolbox.mjs";

const session = await startSession({ provider: "MyFramework", model: "my-model", tend: tendHttp(process.env.TEND_URL, process.env.TEND_AGENT_KEY), env: process.env });
// For each tool call your model makes (the id deduplicates a repeated call):
const { content, isError } = await session.callTool(toolName, toolInput, toolCallId);
await session.finish();`;

function Copy({ text }: { text: string }) {
  const t = useT().connect.providers;
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      toast.error(t.failed);
    }
  };
  return (
    <Button variant="secondary" className="h-9 shrink-0 border-border px-3 text-small" onClick={() => void copy()}>
      {done ? <CheckIcon /> : <CopyIcon />} {done ? t.copied : t.copy}
    </Button>
  );
}

const Code = ({ text }: { text: string }) => (
  <div className="mt-3 overflow-hidden rounded-xl border border-border">
    <pre className="overflow-x-auto bg-[#fafafa] px-4 py-3 font-mono text-[12.5px] leading-relaxed dark:bg-sunken"><code>{text}</code></pre>
  </div>
);

function Dot({ on }: { on: boolean }) {
  return <span aria-hidden className={cn("mt-[7px] size-2 shrink-0 rounded-full", on ? "bg-foreground" : "border border-faint")} />;
}

function Card({ provider, agents, now }: { provider: ProviderKey; agents: IntegrationAgent[]; now: number }) {
  const t = useT().connect.providers;
  const state: ConnectionState = connectionState(agents);
  const lastSeen = Math.max(0, ...agents.map((a) => a.lastSeenAt ?? 0));
  const ago = lastSeen ? timeAgo(lastSeen, now) : "";
  const text = state === "connected" ? t.state.connected(ago) : state === "quiet" ? t.state.quiet(ago) : t.state[state];
  const providerName = provider === "OpenAI" ? "OpenAI" : "Anthropic";
  return (
    <article className="rounded-2xl border border-border bg-background p-6">
      <header className="flex items-start justify-between gap-4">
        <h3 className="text-heading">{t.cards[provider]}</h3>
        <Copy text={SETUP[provider]} />
      </header>
      <p className="mt-3 flex gap-3 text-ui" aria-live="polite"><Dot on={state === "connected"} /><span className={state === "connected" ? "text-foreground" : "text-muted-foreground"}>{text}</span></p>
      {agents.map((a) => {
        const last = a.gateway.last ? timeAgo(a.gateway.last, now) : "";
        return (
          <dl key={a.id} className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 border-t border-border pt-4 text-small">
            <dt className="text-faint">{a.name}</dt><dd className="font-mono text-caption break-all">{a.id}</dd>
            <dt className="text-faint">{t.facts.policy}</dt>
            <dd>{t.facts.policyValue(t.effect[a.policy.read_test_file], t.effect[a.policy.write_test_file], t.effect[a.policy.delete_test_file])} — {a.policyAsRecommended ? t.facts.matches : t.facts.differs}</dd>
            <dt className="text-faint">{t.facts.activity}</dt>
            <dd>{a.gateway.successes + a.gateway.denied === 0 ? t.facts.none : t.facts.activityValue(a.gateway.successes, a.gateway.denied, last)}</dd>
            {a.enforcement !== "enforce" && (<><dt className="text-faint">{t.facts.enforce}</dt><dd className="text-clay">{t.facts.notEnforced}</dd></>)}
          </dl>
        );
      })}
      <p className="mt-4 text-small text-pretty text-muted-foreground">{t.keyNote(providerName)}</p>
      <h4 className="mt-5 text-small font-medium">{t.steps}</h4>
      <Code text={SETUP[provider]} />
    </article>
  );
}

/** Real AI-provider agents: sandbox and registration status from the server's records, and copyable setup. Operators only (the status route is). */
export function ProviderIntegrations() {
  const t = useT();
  const p = t.connect.providers;
  const getIntegrations = useStore((s) => s.getIntegrations);
  const skew = useStore((s) => s.skew);
  const now = useNow() + skew;
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = async () => {
      const r = await getIntegrations();
      if (!live) return;
      if (r.ok) {
        setStatus(r.data);
        setFailed(null);
      } else setFailed(errorText(t, r));
    };
    void load();
    const timer = setInterval(() => void load(), 5_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [getIntegrations, t]);

  const sandbox = status?.sandbox;
  return (
    <section aria-labelledby="cn-providers" className="mt-16">
      <h2 id="cn-providers" className="text-h2 text-balance">{p.title}</h2>
      <p className="mt-3 max-w-[60ch] text-body text-pretty text-muted-foreground">{p.sub}</p>

      <div className="mt-6 rounded-2xl bg-sunken px-5 py-4">
        <h3 className="text-small font-medium">{p.sandbox.title}</h3>
        <p className="mt-1 flex gap-3 text-ui" aria-live="polite">
          <Dot on={!!sandbox?.usable} />
          <span className={sandbox?.usable ? "text-foreground" : "text-muted-foreground"}>
            {failed ?? (!sandbox ? p.loading : sandbox.usable ? p.sandbox.ready : sandbox.configured ? p.sandbox.missing : p.sandbox.unset)}
          </span>
        </p>
      </div>

      <div className="mt-6 grid gap-6">
        {(["OpenAI", "Anthropic"] as const).map((k) => <Card key={k} provider={k} agents={status?.providers[k] ?? []} now={now} />)}
        <article className="rounded-2xl border border-border bg-background p-6">
          <header className="flex items-start justify-between gap-4"><h3 className="text-heading">{p.cards.custom}</h3><Copy text={CUSTOM} /></header>
          <p className="mt-3 max-w-[64ch] text-body text-pretty text-muted-foreground">{p.custom.body}</p>
          <h4 className="mt-5 text-small font-medium">{p.custom.steps}</h4>
          <Code text={CUSTOM} />
        </article>
      </div>
      <p className="mt-6 max-w-[64ch] text-small text-pretty text-muted-foreground">{p.limits}</p>
    </section>
  );
}
