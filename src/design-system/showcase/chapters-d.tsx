"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import { ArrowRight, Bell, Check, Pause, Plus, ShieldCheck, Terminal } from "lucide-react";
import { Scope, useReducedMotionPref, useScope } from "../scope";
import { AlternatingTimeline } from "../motion/alternating-timeline";
import { DepthStack } from "../motion/depth-stack";
import { ImageHandoff } from "../motion/image-handoff";
import { MorphGap } from "../motion/morph-gap";
import { SectionStack } from "../motion/section-stack";
import { MOTION_TABLE, duration, variants } from "../motion/tokens";
import { PageTransition, Reveal } from "../motion/reveal";
import { Button } from "../ui/button";
import { CodeBlock, StatusBadge, Table, TBody, Td, Th, THead, Tr } from "../ui/data";
import { Alert } from "../ui/feedback";
import { Field, Input, Switch } from "../ui/forms";
import { Dropdown, DropdownContent, DropdownItem, DropdownTrigger, SiteHeader, Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/navigation";
import { ActivityEvent, AgentAvatar, AgentStatus, ApprovalRequest, PolicyDecision, PolicySummary } from "../tend/components";
import { Chapter, Plate, Sub } from "./parts";
import { AGENTS, APPROVAL, EVENTS, POLICY } from "./sample-data";

/* ================================================================================================ 12 Motion */

function Bar({ label, ms }: { label: string; ms: number }) {
  return (
    <li className="grid grid-cols-[5.5rem_1fr_3.5rem] items-center gap-4">
      <span className="text-t-small text-t-ink">{label}</span>
      <span className="h-2"><span className="block h-full rounded-full bg-t-accent" style={{ width: `${(ms / 900) * 100}%` }} /></span>
      <span className="t-num text-right text-t-caption text-t-muted">{ms}ms</span>
    </li>
  );
}

function EaseCurve({ name, bez, note }: { name: string; bez: [number, number, number, number]; note: string }) {
  const [x1, y1, x2, y2] = bez;
  const S = 80;
  return (
    <div className="flex items-start gap-4">
      <svg viewBox={`-6 -6 ${S + 12} ${S + 12}`} className="size-24 shrink-0 rounded-t-md border border-t-line bg-t-surface" aria-hidden>
        <path d={`M0 ${S} L${S} 0`} stroke="var(--t-line)" strokeDasharray="2 3" fill="none" />
        <path d={`M0 ${S} C${x1 * S} ${S - y1 * S}, ${x2 * S} ${S - y2 * S}, ${S} 0`} stroke="var(--t-accent)" strokeWidth="2" fill="none" strokeLinecap="round" />
      </svg>
      <div>
        <p className="text-t-label text-t-ink">{name}</p>
        <p className="font-t-mono text-[0.75rem] text-t-muted">cubic-bezier({bez.join(", ")})</p>
        <p className="mt-1 text-t-caption text-t-muted [text-wrap:pretty]">{note}</p>
      </div>
    </div>
  );
}

function PageDemo() {
  const [page, setPage] = useState<"agents" | "policies">("agents");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1">
        {(["agents", "policies"] as const).map((p) => (
          <Button key={p} size="sm" variant={page === p ? "secondary" : "ghost"} onClick={() => setPage(p)} className="capitalize">{p}</Button>
        ))}
      </div>
      <div className="min-h-36 overflow-hidden">
        <PageTransition routeKey={page}>
          <h4 className="text-t-h3 text-t-ink capitalize">{page}</h4>
          <p className="mt-2 max-w-sm text-t-small text-t-muted">{page === "agents" ? "Four agents are connected. One needs attention." : "Three policies. Engineering · balanced is used most."}</p>
          <div className="mt-4 flex flex-col gap-2">
            {(page === "agents" ? AGENTS.slice(0, 3) : ["Engineering · balanced", "Support · strict", "Research · monitor"].map((n, i) => ({ id: String(i), name: n }))).map((a) => (
              <div key={a.id} className="flex items-center gap-2.5 text-t-small text-t-ink"><span aria-hidden className="size-1.5 rounded-[1px] bg-t-accent" />{a.name}</div>
            ))}
          </div>
        </PageTransition>
      </div>
    </div>
  );
}

function RevealDemo() {
  const [run, setRun] = useState(0);
  const reduced = useReducedMotionPref();
  return (
    <div className="flex flex-col gap-5">
      <Button size="sm" variant="secondary" className="self-start" onClick={() => setRun((r) => r + 1)}>Replay</Button>
      <motion.ul key={run} initial="hidden" animate="shown" variants={{ hidden: {}, shown: { transition: { staggerChildren: reduced ? 0 : 0.07 } } }} className="flex flex-col gap-3">
        {["An agent asks to act", "TEND checks the policy", "A person decides, if needed", "The decision is recorded"].map((t, i) => (
          <motion.li key={t} variants={reduced ? variants.revealReduced : variants.reveal} className="flex items-center gap-3 text-t-small text-t-ink">
            <span className="t-num grid size-6 place-items-center rounded-full border border-t-line-strong text-t-caption text-t-muted">{i + 1}</span>{t}
          </motion.li>
        ))}
      </motion.ul>
    </div>
  );
}

const STAGES = [
  { id: "ask", label: "Request", title: "Release assistant asks", body: <><code className="font-t-mono text-t-code text-t-ink">git push origin feature/discount-codes</code></> },
  { id: "check", label: "Policy", title: "TEND checks the rules", body: <>Matches “Push to remote” in <span className="text-t-ink">Engineering · balanced</span>.</> },
  { id: "decide", label: "Decision", title: "A person decides", body: <PolicyDecision decision="review" variant="block" reason="Priya N. is asked. Nothing runs until she answers." /> },
];

export function Motion() {
  const [open, setOpen] = useState(false);
  return (
    <Chapter
      id="motion"
      n="12"
      title="Motion that explains."
      lead="Things move because you did something, and they move from where you did it. Distances are small, arrivals are slow enough to read and departures are quick. Nothing loops except a loading indicator and the single dot that says an agent is working."
    >
      <Sub title="Durations" note="Six steps, shared by CSS and framer-motion. Pick by what is moving, not by taste.">
        <ul className="flex flex-col gap-3.5">
          <Bar label="instant" ms={80} /><Bar label="fast" ms={140} /><Bar label="base" ms={220} /><Bar label="slow" ms={360} /><Bar label="slower" ms={560} /><Bar label="cinematic" ms={900} />
        </ul>
        <div className="grid gap-x-10 gap-y-8 pt-4 md:grid-cols-3">
          <EaseCurve name="Out · arrivals" bez={[0.22, 1, 0.36, 1]} note="Fast start, long settle. For anything that appears or moves into place." />
          <EaseCurve name="In · departures" bez={[0.5, 0, 0.9, 0.4]} note="Quick, never lingering. Exits last about 60% as long as entrances." />
          <EaseCurve name="In-out · travel" bez={[0.65, 0, 0.35, 1]} note="For something moving between two places on the page, like a shared element." />
        </div>
      </Sub>

      <Sub title="The vocabulary" note="Every interaction in the system is one row of this table. Movement distances: 2, 6, 12, 24px. Opacity moves with position and never ends below 0. Scale never drops below 0.96.">
        <div className="overflow-x-auto">
          <Table compact>
            <THead><tr><Th>Interaction</Th><Th>Used for</Th><Th>Duration</Th><Th>Easing</Th><Th>Travel</Th></tr></THead>
            <TBody>
              {MOTION_TABLE.map((r) => (
                <Tr key={r.name} interactive={false}><Td className="font-medium text-t-ink">{r.name}</Td><Td className="text-t-muted">{r.use}</Td><Td className="t-num whitespace-nowrap">{r.duration}</Td><Td className="whitespace-nowrap">{r.ease}</Td><Td className="whitespace-nowrap text-t-muted">{r.travel}</Td></Tr>
              ))}
            </TBody>
          </Table>
        </div>
        <CodeBlock lang="plain" title="motion/tokens.ts" code={`import { duration, ease, distance, spring, transition, variants } from "@/design-system/motion/tokens";\n\n<motion.div variants={variants.reveal} initial="hidden" whileInView="shown" />\n<motion.div animate={{ y: 0 }} transition={transition.menu} />   // ${duration.base * 1000}ms, ease out`} />
      </Sub>

      <Sub title="In the interface" note="Live. Hover, press and open things; they all use the vocabulary above.">
        <div className="grid gap-x-10 gap-y-10 md:grid-cols-2">
          <Plate caption="Hover and press: tone shifts in 140ms, the press settles to 0.985.">
            <div className="flex flex-wrap items-center gap-3"><Button variant="primary">Approve once</Button><Button variant="secondary">Deny</Button><Button variant="ghost">Details</Button></div>
          </Plate>
          <Plate caption="Dropdown: grows from its trigger, 6px and 0.97 scale in 220ms; leaves faster.">
            <Dropdown>
              <DropdownTrigger asChild><Button variant="secondary" leading={Plus}>New</Button></DropdownTrigger>
              <DropdownContent><DropdownItem icon={ShieldCheck}>Policy</DropdownItem><DropdownItem icon={Terminal}>Agent</DropdownItem><DropdownItem icon={Bell}>Alert rule</DropdownItem></DropdownContent>
            </Dropdown>
          </Plate>
          <Plate caption="Tabs: the indicator settles with a spring; the panel rises 12px.">
            <Tabs defaultValue="a"><TabsList label="Demo"><TabsTrigger value="a">Overview</TabsTrigger><TabsTrigger value="b">Policy</TabsTrigger><TabsTrigger value="c">Activity</TabsTrigger></TabsList>
              <TabsContent value="a" className="pt-4 text-t-small text-t-muted">Overview panel.</TabsContent><TabsContent value="b" className="pt-4 text-t-small text-t-muted">Policy panel.</TabsContent><TabsContent value="c" className="pt-4 text-t-small text-t-muted">Activity panel.</TabsContent></Tabs>
          </Plate>
          <Plate caption="Loading: the button keeps its width; the spinner is the only thing that loops.">
            <div className="flex items-center gap-3"><Button variant="primary" loading>Saving</Button><span className="t-pulse h-3 w-24 rounded-t-sm bg-t-line" aria-hidden /></div>
          </Plate>
          <Plate caption="Content reveal: 24px rise, 560ms, staggered by 70ms.">
            <RevealDemo />
          </Plate>
          <Plate caption="Page transition: out in 140ms, in over 560ms, 12px.">
            <PageDemo />
          </Plate>
        </div>
      </Sub>

      <Sub title="Reduced motion" note="Switch “Reduce motion” in the top bar, or turn it on in your system. Durations collapse, travel goes to zero, scale is removed, loops stop. State changes are still visible: they just happen at once, or as a short cross-fade.">
        <Alert tone="info" title="What changes">Menus appear without sliding. Tabs jump rather than glide. Stacks show one layer at a time. Reveals fade only. The spinner pulses instead of turning. Nothing is ever removed from the interface to make this work.</Alert>
      </Sub>

      <div className="border-t border-t-line pt-20">
        <Sub title="Marketing motion" note="Five patterns for the future homepage, built as small reusable components on the same tokens. They are original implementations inspired by the quality of the reference library, adapted to TEND’s own story, and are not wired into any page yet.">
          <div className="flex flex-col gap-20 pt-6">
            <MotionDemo name="Depth stack" use="Cinematic product storytelling. One request, three layers: what was asked, what the policy said, who decides.">
              <DepthStack panels={STAGES.map((s) => ({ id: s.id, label: s.label, content: <div className="flex flex-col gap-2"><p className="text-t-caption text-t-muted">{s.label}</p><h4 className="text-t-h3 text-t-ink">{s.title}</h4><div className="text-t-small text-t-muted">{s.body}</div></div> }))} />
            </MotionDemo>
            <MotionDemo name="Section stack" use="Handovers between major homepage sections. The next section slides over the last, which recedes.">
              <SectionStack sections={[
                { id: "s1", content: <StackSlide n="01" t="Agents ask" b="Every action an agent wants to take is a request." /> },
                { id: "s2", content: <StackSlide n="02" t="Policies decide" b="Rules you wrote decide in milliseconds, in plain terms." /> },
                { id: "s3", content: <StackSlide n="03" t="People review" b="Only the few things that matter ever reach a person." /> },
              ]} />
            </MotionDemo>
            <MotionDemo name="Image handoff" use="Moving between related product visuals. The thumbnail becomes the detail without disappearing. Click one.">
              <ImageHandoff items={[
                { id: "h1", title: "Push request", thumb: <MiniRequest />, detail: <ApprovalRequest data={APPROVAL} className="border-0 shadow-none [&>div]:p-0" /> },
                { id: "h2", title: "Blocked write", thumb: <MiniEvent i={3} />, detail: <ActivityEvent event={EVENTS[3]} /> },
                { id: "h3", title: "Allowed test run", thumb: <MiniEvent i={0} />, detail: <ActivityEvent event={EVENTS[0]} /> },
              ]} />
            </MotionDemo>
            <MotionDemo name="Alternating timeline" use="Explaining how TEND works. Steps hang off a line that draws as you scroll.">
              <AlternatingTimeline steps={[
                { id: "t1", step: "Step 1", title: "Connect an agent", body: "Add one line to the agent’s setup. It keeps working exactly as before.", aside: <CodeBlock lang="shell" code={'tend connect --agent "Release assistant"'} /> },
                { id: "t2", step: "Step 2", title: "Choose a policy", body: "Start from a preset, then adjust in plain language.", aside: <PolicyDecision decision="allowed" variant="block" reason="Run tests and linters" /> },
                { id: "t3", step: "Step 3", title: "Stay informed", body: "Approve the few things that matter. Everything else is recorded.", aside: <PolicyDecision decision="review" variant="block" reason="Push code to a remote" /> },
              ]} />
            </MotionDemo>
            <MotionDemo name="Morph gap" use="One selective editorial effect on a headline. Hover or focus it: the gap opens and the square passes through.">
              <MorphGap before="Powerful technology." after="Effortless control." open={open || undefined} />
              <div className="mt-4"><Switch label={<span className="text-t-small text-t-muted">Hold open</span>} checked={open} onCheckedChange={setOpen} className="items-center justify-start gap-3 [&>label]:order-2" /></div>
            </MotionDemo>
          </div>
        </Sub>
      </div>
    </Chapter>
  );
}

function MotionDemo({ name, use, children }: { name: string; use: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-x-12 gap-y-6 lg:grid-cols-[16rem_1fr]">
      <div className="flex flex-col gap-1.5"><h4 className="text-t-h4 text-t-ink">{name}</h4><p className="text-t-small text-t-muted [text-wrap:pretty]">{use}</p></div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function StackSlide({ n, t, b }: { n: string; t: string; b: string }) {
  return <div className="flex h-full flex-col justify-center gap-3 p-8"><p className="t-num text-t-caption text-t-accent-text">{n}</p><h4 className="text-t-h2 text-t-ink">{t}</h4><p className="max-w-sm text-t-small text-t-muted">{b}</p></div>;
}
function MiniRequest() {
  return <div className="flex flex-col gap-2"><div className="flex items-center gap-2"><AgentAvatar brand="claudecode" size={24} /><span className="text-t-small font-medium text-t-ink">Release assistant</span></div><div className="rounded-t-sm bg-t-code-bg p-2 font-t-mono text-t-code text-t-ink">git push origin …</div><StatusBadge tone="warn">Requires review</StatusBadge></div>;
}
function MiniEvent({ i }: { i: number }) {
  const e = EVENTS[i];
  return <div className="flex flex-col gap-2"><div className="flex items-center gap-2"><AgentAvatar brand={e.brand} size={24} /><span className="text-t-small font-medium text-t-ink">{e.agent}</span></div><div className="rounded-t-sm bg-t-code-bg p-2 font-t-mono text-t-code text-t-ink">{e.resource.slice(0, 22)}</div><PolicyDecision decision={e.decision} variant="badge" /></div>;
}

/* ================================================================================================ 13 Light and dark */

function ThemePreview({ theme }: { theme: "light" | "dark" }) {
  return (
    <Scope theme={theme} className="flex min-w-0 flex-col gap-6 rounded-t-lg border border-t-line p-6">
      <div className="flex items-center justify-between"><p className="text-t-label text-t-ink">{theme === "light" ? "Light: premium and editorial" : "Dark: calm and sophisticated"}</p><AgentStatus state="active" /></div>
      <div className="flex flex-col gap-2">
        <h4 className="text-t-h2 text-t-ink [text-wrap:balance]">Release assistant wants to push code</h4>
        <p className="text-t-small text-t-muted">Matches “Push to remote”. Nothing runs until you decide.</p>
      </div>
      <div className="flex flex-wrap gap-2"><Button variant="primary" leading={Check}>Approve once</Button><Button variant="secondary">Deny</Button><Button variant="ghost">Details</Button></div>
      <div className="flex flex-wrap gap-2"><PolicyDecision variant="badge" decision="allowed" /><PolicyDecision variant="badge" decision="review" /><PolicyDecision variant="badge" decision="denied" /></div>
      <Field label="Search">{(p) => <Input placeholder="Search agents" {...p} />}</Field>
      <Alert tone="warn" title="3 requests are waiting">The oldest has waited 2 minutes.</Alert>
      <CodeBlock lang="json" code={'{ "decision": "review", "attempts": 1 }'} />
    </Scope>
  );
}

export function Themes() {
  return (
    <Chapter
      id="themes"
      n="13"
      title="Two themes, one system."
      lead="Light is warm paper with charcoal ink. Dark is warm charcoal with paper ink: never black, never blue-grey. The accent lightens in dark so it stays legible, and shadows give way to hairlines. Components never know which theme they are in."
    >
      <div className="grid gap-6 lg:grid-cols-2"><ThemePreview theme="light" /><ThemePreview theme="dark" /></div>
      <p className="max-w-2xl text-t-small text-t-muted [text-wrap:pretty]">The theme switch in the top bar changes the whole showcase; these two stay put so you can compare them. Both previews run the real components inside their own scope, and their overlays inherit the right theme.</p>
    </Chapter>
  );
}

/* ================================================================================================ 14 Compositions */

function MarketingComposition() {
  return (
    <Scope theme={useScope().theme} density="marketing" className="overflow-hidden rounded-t-xl border border-t-line">
      <div className="px-6 sm:px-10 lg:px-14">
        <SiteHeader links={["Product", "How it works", "Security", "Docs"]} active="Product" />
        <div className="flex flex-col gap-14 pt-14 pb-20 lg:pt-20 lg:pb-28">
          <Reveal className="max-w-4xl">
            <h3 className="text-t-hero text-t-ink [text-wrap:balance]">Let your agents work. Stay in charge.</h3>
          </Reveal>
          <div className="grid items-start gap-x-14 gap-y-12 lg:grid-cols-[1fr_1.05fr]">
            <Reveal delay={0.06} className="flex min-w-0 flex-col gap-7">
              <p className="max-w-lg text-t-lead text-t-muted [text-wrap:pretty]">TEND sits between your AI agents and everything they can touch. It lets the routine through, asks you about the rest, and keeps a record of both.</p>
              <div className="flex flex-wrap items-center gap-3"><Button variant="primary" size="lg" trailing={ArrowRight}>Connect your first agent</Button><Button variant="ghost" size="lg">How it works</Button></div>
              <p className="text-t-caption text-t-muted">Works with Claude Code, Cursor and the Model Context Protocol.</p>
            </Reveal>
            <Reveal delay={0.12} className="flex min-w-0 flex-col gap-4">
              <ApprovalRequest data={APPROVAL} className="shadow-t-2" />
              <div className="flex items-center justify-between px-1 text-t-caption text-t-muted"><span>Sample request</span><span className="flex items-center gap-1.5"><Check size={13} /> Recorded in the activity log</span></div>
            </Reveal>
          </div>
        </div>
        <div className="grid gap-x-14 gap-y-10 border-t border-t-line py-16 md:grid-cols-3">
          {[["Agents ask", "Every action is a request, checked before it runs."], ["Policies decide", "Plain rules decide in milliseconds, in the open."], ["People review", "Only what matters reaches a person, with the context to decide."]].map(([t, b], i) => (
            <Reveal key={t} delay={0.06 * i} className="flex flex-col gap-3"><p className="t-num text-t-caption text-t-accent-text">0{i + 1}</p><h4 className="text-t-h3 text-t-ink">{t}</h4><p className="text-t-small text-t-muted [text-wrap:pretty]">{b}</p></Reveal>
          ))}
        </div>
      </div>
    </Scope>
  );
}

function DashboardComposition() {
  const { theme } = useScope();
  const [tab, setTab] = useState("waiting");
  return (
    <Scope theme={theme} density="app" className="overflow-hidden rounded-t-xl border border-t-line">
      <div className="flex flex-col gap-6 p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <p className="text-t-small text-t-muted">Acme · Engineering</p>
            <h3 className="text-t-h1 text-t-ink">Overview</h3>
          </div>
          <div className="flex gap-2"><Button variant="secondary" leading={Pause}>Pause all agents</Button><Button variant="primary" leading={Plus}>Connect agent</Button></div>
        </div>

        <dl className="grid grid-cols-2 gap-x-8 gap-y-5 border-y border-t-line py-5 md:grid-cols-4">
          {[["Agents running", "3", "of 4 connected"], ["Waiting for you", "3", "oldest 2 min"], ["Allowed on their own", "412", "last 24 hours"], ["Denied", "7", "last 24 hours"]].map(([k, v, s]) => (
            <div key={k} className="flex flex-col gap-1"><dt className="text-t-caption text-t-muted">{k}</dt><dd className="t-num text-[2rem] leading-none font-medium tracking-[-0.03em] text-t-ink">{v}</dd><dd className="text-t-caption text-t-muted">{s}</dd></div>
          ))}
        </dl>

        <div className="grid gap-x-10 gap-y-8 lg:grid-cols-[1.35fr_1fr]">
          <div className="flex min-w-0 flex-col gap-4">
            <Tabs defaultValue="waiting" value={tab} onValueChange={setTab}>
              <TabsList label="Activity"><TabsTrigger value="waiting" count={3}>Waiting</TabsTrigger><TabsTrigger value="recent">Recent activity</TabsTrigger></TabsList>
              <TabsContent value="waiting" className="pt-3">
                <ApprovalRequest data={APPROVAL} />
              </TabsContent>
              <TabsContent value="recent" className="pt-2">
                <div className="divide-y divide-t-line">{EVENTS.map((e) => <ActivityEvent key={e.resource} event={e} onOpen={() => {}} />)}</div>
              </TabsContent>
            </Tabs>
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex items-baseline justify-between"><h4 className="text-t-h4 text-t-ink">Agents</h4><a href="#dashboard" onClick={(e) => e.preventDefault()} className="text-t-small text-t-accent-text hover:underline">View all</a></div>
            <ul className="divide-y divide-t-line">
              {AGENTS.map((a) => (
                <li key={a.id} className="flex min-h-[var(--t-row-h)] items-center gap-3 py-2"><AgentAvatar brand={a.brand} size={32} /><span className="flex min-w-0 flex-1 flex-col"><span className="truncate text-t-small font-medium text-t-ink">{a.name}</span><span className="truncate text-t-caption text-t-muted">{a.policy}</span></span><AgentStatus state={a.state} /></li>
              ))}
            </ul>
          </div>
        </div>
        <div className="border-t border-t-line pt-6"><PolicySummary data={POLICY} /></div>
      </div>
    </Scope>
  );
}

export function Compositions() {
  return (
    <Chapter
      id="compositions"
      n="14"
      title="Put together."
      lead="Two layouts built only from the parts above. The marketing section is spacious and editorial; the dashboard section is dense and structured. Same tokens, same components, different density."
    >
      <Sub title="A. Marketing section" note="Large type, one primary action, and the product shown as a real request, not an illustration.">
        <MarketingComposition />
      </Sub>
      <Sub title="B. Product dashboard section" note="Numbers as text, not tiles. One thing waiting at the top, history underneath, agents to the side. A tab strip, not a wall of panels.">
        <DashboardComposition />
      </Sub>
    </Chapter>
  );
}

