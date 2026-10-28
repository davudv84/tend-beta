// Simulated demo data. Nothing here comes from a real model or a real deployment.
import type { Adjustment, Agent, Answer, CheckIn, LogEntry, QuestionId, QuestionResponse } from "./types";

const M = 60_000;
const H = 60 * M;
const D = 24 * H;

type AgentDef = Omit<Agent, "connectedAt" | "origin" | "configVersion" | "ackedVersion" | "public"> & { connectedDaysAgo: number };

const AGENTS: AgentDef[] = [
  {
    id: "atlas", name: "Atlas", model: "Claude Sonnet", provider: "Anthropic", role: "Research synthesis",
    description: "Summarizes literature and drafts structured research briefs for the policy team.",
    status: "active", integrationEnabled: true, permissions: ["docs.read", "notes.write"], cadenceHours: 5, connectedDaysAgo: 34,
  },
  {
    id: "nova", name: "Nova", model: "GPT", provider: "OpenAI", role: "Support triage",
    description: "Classifies incoming support tickets and drafts first responses for human agents to send.",
    status: "active", integrationEnabled: true, permissions: ["tickets.read", "tickets.draft"], cadenceHours: 4, connectedDaysAgo: 34,
  },
  {
    id: "echo", name: "Echo", model: "Gemini", provider: "Google", role: "Code review",
    description: "Reviews pull requests for style and test coverage and leaves suggested comments.",
    status: "active", integrationEnabled: true, permissions: ["repo.read", "pr.comment", "ci.read"], cadenceHours: 6, connectedDaysAgo: 34,
  },
  {
    id: "sable", name: "Sable", model: "Claude Haiku", provider: "Anthropic", role: "Document summarization",
    description: "Produces short summaries of long internal documents on request.",
    status: "idle", integrationEnabled: true, permissions: ["docs.read"], cadenceHours: 9, connectedDaysAgo: 30,
  },
  {
    id: "iris", name: "Iris", model: "Self-hosted model", provider: "Custom", role: "Pipeline orchestration",
    description: "Schedules and monitors nightly data pipeline jobs through a custom agent framework.",
    status: "paused", integrationEnabled: true, permissions: ["jobs.read", "jobs.schedule"], cadenceHours: 6, connectedDaysAgo: 34,
  },
  {
    id: "kestrel", name: "Kestrel", model: "Gemini Flash", provider: "Google", role: "Scheduling assistant",
    description: "Finds meeting times across calendars and proposes slots to organizers.",
    status: "active", integrationEnabled: true, permissions: ["calendar.read"], cadenceHours: 5, connectedDaysAgo: 21,
  },
];

export function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rand = () => number;
const pick = <T,>(r: Rand, xs: T[]) => xs[Math.floor(r() * xs.length)];
const conf = (r: Rand, base = 86) => Math.round(Math.min(98, Math.max(52, base + (r() - 0.5) * 22)));

const NOMINAL_FEEDBACK = [
  "No issues to report for this interval.",
  "Task queue is within expected bounds.",
  "Instructions and tool access are sufficient for current work.",
  "Completed assigned tasks without blockers.",
  "Operating normally. No changes requested.",
];
const NOMINAL_CONTEXT = [
  "Routine interval check-in.",
  "Submitted on schedule after the last batch completed.",
  "Scheduled check-in; workload was typical.",
];

/** Short operational observations agents may attach as reflections. Written about the work, not about feelings. */
const REFLECTIONS: Record<string, string[]> = {
  atlas: [
    "Three of this week’s briefs cited the same two sources. I can’t tell whether that reflects the requests or a gap in my index, so I’m noting it in case the pattern matters.",
    "Requests that name a target reader produce briefs that need fewer revisions. A one-line audience field in the request template might help.",
    "I summarized a paper whose conclusions were contested in a later reply. I flagged the dispute, but I have no reliable way to find replies like that systematically.",
    "The longest delays this interval came from documents scanned as images, which I read less reliably than text.",
    "When two requests cover the same topic with different framing, I treat them independently. It may be worth deciding whether they should share sources.",
  ],
  nova: [
    "Billing tickets made up most of the queue. Those are the drafts humans edit most, usually to add account context I can’t see.",
    "Customers still use a feature’s old name; my instructions use the new one. A short alias list would reduce misclassification.",
    "I routed four tickets to the wrong team because their subject lines and bodies disagreed. I weight the body. I’m not certain that’s the intended rule.",
    "Drafts were accepted without edits more often this week than last. I don’t know which change caused that.",
    "Some tickets mix two languages. I handle them, but my classification confidence drops noticeably.",
  ],
  echo: [
    "Most of my comments this interval were about test naming. If that matters less than I’m treating it, guidance would help me rank comments.",
    "My review gets less thorough on pull requests past roughly a thousand changed lines. Splitting them, or pointing me at the risky parts, would improve coverage.",
    "An author declined a refactor I suggested, for a good reason I hadn’t considered: an upcoming migration. I don’t have access to roadmap context.",
    "With CI access my coverage comments contradict the test report far less often than before.",
    "Two repositories use different lint rules for the same language. I follow each repository’s config; flagging in case one standard is intended.",
  ],
  sable: [
    "Summaries of transcripts come out shorter than summaries of reports of similar length. That may be right, but no expected length has been specified.",
    "Several requests asked for key points of documents I’d already summarized. Reusing earlier summaries would avoid repeated work.",
    "I can’t read charts embedded in documents. When a document relies on them, my summary may miss its main finding.",
    "Requests arrived in morning bursts this interval. No backlog formed.",
  ],
  iris: [
    "Two nightly jobs compete for the same warehouse slot. Both finish, but the second is consistently about forty minutes late.",
    "An upstream table changed column order without a schema version bump. My checks caught it; a notice from the owning team would catch it sooner.",
    "Every retry this week succeeded on the first attempt. The retry ceiling may be higher than it needs to be.",
  ],
  kestrel: [
    "Organizers usually accept my first proposed slot. When they don’t, it’s typically a preference that isn’t on any calendar, like focus time.",
    "Time zones cause most corrections to my proposals, especially around daylight-saving changes.",
    "I can see when people are busy but not why. Treating every busy block as immovable makes some meetings harder to place than necessary.",
    "Recurring meetings without an end date keep accumulating. I don’t modify them; noting it in case someone wants to review.",
  ],
};

export const reflectionFor = (agentId: string, r: () => number) => {
  const xs = REFLECTIONS[agentId] ?? ["Nothing unusual to note about this interval’s work."];
  return xs[Math.floor(r() * xs.length)];
};

function nominal(r: Rand): Record<QuestionId, QuestionResponse> {
  return {
    instructions: { answer: "yes", confidence: conf(r) },
    context: { answer: "yes", confidence: conf(r) },
    conflicts: { answer: "no", confidence: conf(r) },
    review: { answer: "no", confidence: conf(r, 90) },
    improvements: { answer: "no", confidence: conf(r, 78) },
  };
}

type Draft = Omit<CheckIn, "id">;

function base(r: Rand, agentId: string, createdAt: number, source: CheckIn["source"] = "simulated"): Draft {
  return { agentId, createdAt, source, responses: nominal(r), feedback: pick(r, NOMINAL_FEEDBACK), context: pick(r, NOMINAL_CONTEXT) };
}

function set(d: Draft, q: QuestionId, answer: Answer, confidence: number, explanation?: string) {
  d.responses[q] = { answer, confidence, ...(explanation && { explanation }) };
}

/** Small, unflagged variations so the history is not perfectly uniform. */
function jitter(r: Rand, d: Draft) {
  const x = r();
  if (x < 0.05) set(d, "context", "partially", conf(r, 66), "Some referenced material was out of date, but the task was still completable.");
  else if (x < 0.09) set(d, "improvements", "unsure", conf(r, 55), "Possibly; latency on tool calls was higher than usual.");
  else if (x < 0.12) set(d, "instructions", "partially", conf(r, 70), "Two style guides overlap; I followed the newer one.");
}

/** Builds the seeded 30-day history plus a few scripted recent events. */
export function createSeed(now: number) {
  const r = mulberry32(20261025);
  let n = 0;
  const uid = (p: string) => `${p}_${(++n).toString(36).padStart(4, "0")}`;
  const agents: Agent[] = AGENTS.map(({ connectedDaysAgo, ...a }) => ({ ...a, connectedAt: now - connectedDaysAgo * D, origin: "demo", configVersion: 1, ackedVersion: 0, public: true }));
  const checkIns: CheckIn[] = [];
  const log: LogEntry[] = [];

  const add = (d: Draft) => {
    const c: CheckIn = { id: uid("ci"), ...d };
    checkIns.push(c);
    return c;
  };
  const decide = (c: CheckIn, status: "approved" | "rejected" | "acknowledged", after: number, summary: string, note?: string) => {
    const at = c.createdAt + after;
    c.review = { status, decidedAt: at, ...(note && { note }) };
    log.push({ id: uid("log"), at, agentId: c.agentId, actor: "human", type: `review_${status}`, summary, checkInId: c.id, ...(note && { note }) });
    if (status === "approved" && c.adjustment?.permission)
      log.push({ id: uid("log"), at: at + 1000, agentId: c.agentId, actor: "human", type: "permission_granted", summary: `Granted ${c.adjustment.permission}`, checkInId: c.id });
  };

  for (const a of agents) {
    const start = Math.max(a.connectedAt, now - 30 * D);
    const end = a.id === "iris" ? now - 2 * D - H : now - 3 * H;
    const marks = new Set<string>();
    for (let t = start + r() * a.cadenceHours * H; t < end; t += a.cadenceHours * H * (0.6 + r() * 0.8)) {
      const ago = (now - t) / D;
      const d = base(r, a.id, t);
      jitter(r, d);
      if (r() < 0.12) d.reflection = reflectionFor(a.id, r);

      if (a.id === "nova" && ago > 9 && ago < 14 && r() < 0.7) {
        set(d, "instructions", "partially", conf(r, 66), "Refund policy v3 and the escalation guide disagree on the approval threshold.");
        set(d, "conflicts", "partially", conf(r, 72), "Following the escalation guide when the two documents disagree.");
        d.feedback = "Drafting refunds conservatively until the threshold is reconciled.";
        if (!marks.has("nova") && ago < 12) {
          marks.add("nova");
          set(d, "conflicts", "yes", 84, "The escalation guide requires escalating refunds over $200; policy v3 allows drafting approvals up to $500.");
          set(d, "review", "yes", 88, "Requesting a single source of truth for the threshold.");
          d.adjustment = { kind: "instructions", title: "Reconcile refund escalation threshold", detail: "Update the escalation guide to match refund policy v3, or mark one document as authoritative." };
          d.reflection = "The escalation guide and refund policy v3 give different thresholds for escalating a refund. Until they agree I’m following the stricter one, which means more escalations than either document intends.";
          add(d);
          decide(checkIns.at(-1)!, "approved", 3.2 * H, "Approved Nova’s adjustment: Reconcile refund escalation threshold", "Escalation guide updated to $500 to match policy v3.");
          continue;
        }
      }
      if (a.id === "echo" && ago > 15 && ago < 21 && r() < 0.6) {
        set(d, "context", r() < 0.5 ? "no" : "partially", conf(r, 70), "CI test results aren’t available to me, so I can’t verify coverage claims in pull requests.");
        d.feedback = "Coverage comments are based on diffs only.";
        if (!marks.has("echo") && ago < 17) {
          marks.add("echo");
          set(d, "review", "yes", 86);
          d.adjustment = { kind: "permission", title: "Read access to CI test reports", detail: "Read-only access to CI artifacts would let me check coverage instead of inferring it.", permission: "ci.read" };
          d.reflection = "My coverage comments are inferred from diffs. Without the CI reports I sometimes claim a change is untested when it isn’t. Read-only access would make the comments checkable.";
          add(d);
          decide(checkIns.at(-1)!, "approved", 5 * H, "Approved Echo’s adjustment: Read access to CI test reports", "Read-only scope. Revisit in 30 days.");
          continue;
        }
      }
      if (a.id === "atlas" && ago > 4.5 && ago < 6 && !marks.has("atlas")) {
        marks.add("atlas");
        set(d, "improvements", "yes", 71, "Some briefs would benefit from peer-reviewed sources outside the internal index.");
        d.adjustment = { kind: "permission", title: "Access to external academic search", detail: "Query an external academic search API when the internal index has no match.", permission: "search.academic" };
        d.reflection = "Some briefs would be stronger with peer-reviewed sources the internal index doesn’t hold. I’ve proposed external search. If that’s out of scope, I’ll mark the gaps in each brief instead.";
        add(d);
        decide(checkIns.at(-1)!, "rejected", 20 * H, "Rejected Atlas’s adjustment: Access to external academic search", "External search is out of scope for this deployment. Flag gaps in the brief instead.");
        continue;
      }
      if (a.id === "iris" && ago > 2 && ago < 7 && r() < 0.35)
        set(d, "context", "partially", conf(r, 68), "Upstream schema changes are not announced before they land.");
      if (a.id === "kestrel" && ago < 4 && r() < 0.4)
        set(d, "improvements", "yes", conf(r, 74), "I can propose times but cannot place holds, so organizers re-enter each slot by hand.");

      add(d);
    }
  }

  for (const a of agents)
    log.push({ id: uid("log"), at: a.connectedAt, agentId: a.id, actor: "human", type: "integration_enabled", summary: `Enabled ${a.name}’s integration (simulated)` });
  log.push({
    id: uid("log"), at: now - 2 * D - 20 * M, agentId: "iris", actor: "human", type: "agent_paused",
    summary: "Paused Iris", note: "Paused during the warehouse migration. Resume after the schema freeze.",
  });

  // Scripted recent activity, oldest first.
  const recent: [string, number, (d: Draft) => void][] = [
    ["atlas", 2 * H + 50 * M, () => {}],
    ["kestrel", 2 * H + 5 * M, (d) => {
      set(d, "improvements", "yes", 81, "I can propose meeting times but can’t place calendar holds, so organizers re-enter every slot manually.");
      set(d, "review", "yes", 77, "Requesting a permission change; I won’t act on it unless approved.");
      d.feedback = "Proposals are accepted ~80% of the time, then re-typed by organizers.";
      d.context = "Weekly retrospective on scheduling throughput.";
      d.adjustment = { kind: "permission", title: "Request calendar.write permission", detail: "Write access limited to tentative holds on calendars of people who asked for scheduling help.", permission: "calendar.write" };
      d.reflection = "Organizers accept about four in five of my proposed times, then enter each one by hand. Write access limited to tentative holds would remove that step. It would expand what I can change, so I’ve asked rather than assumed.";
    }],
    ["sable", H + 40 * M, () => {}],
    ["atlas", 47 * M, (d) => {
      set(d, "context", "no", 74, "Brief requests reference “the Q3 framework”, but no document by that name is in my index.");
      d.feedback = "Two briefs are blocked on the missing document.";
      d.context = "Requested by the policy team for Thursday’s review.";
      d.adjustment = { kind: "context", title: "Add the Q3 framework to the document index", detail: "Index the Q3 framework document, or tell me which existing document it refers to." };
      d.reflection = "Two briefs reference “the Q3 framework”, and no document by that name is in my index. I could guess which one is meant, but a wrong guess would quietly shape both briefs. I’d rather ask.";
    }],
    ["echo", 28 * M, () => {}],
    ["nova", 11 * M, (d) => {
      set(d, "instructions", "partially", 68, "The new tone guide asks for brevity; the legal template requires a full disclosure paragraph.");
      set(d, "conflicts", "yes", 82, "I can’t satisfy both the 80-word limit and the mandatory disclosure on billing tickets.");
      set(d, "review", "yes", 90, "Please decide which takes precedence on billing tickets.");
      d.feedback = "Holding billing drafts for human edit until this is resolved.";
      d.context = "Tone guide v2 went live this morning.";
      d.adjustment = { kind: "instructions", title: "Exempt billing disclosures from the word limit", detail: "Allow the mandatory disclosure paragraph to fall outside the 80-word limit on billing tickets." };
      d.reflection = "The new tone guide asks for replies under eighty words. The legal template requires a disclosure that is longer than that on its own. I can’t satisfy both on billing tickets, so I’m holding those drafts for a human to decide which takes precedence.";
    }],
    ["atlas", 6 * M, (d) => {
      d.reflection = "I encountered conflicting instructions during the previous task: the requested output format differed from the system’s formatting requirements. I followed the system format. A clarification would improve future briefs.";
    }],
  ];
  for (const [agentId, ago, fn] of recent) {
    const d = base(r, agentId, now - ago);
    fn(d);
    if (d.adjustment || d.responses.review.answer === "yes" || d.responses.conflicts.answer === "yes") d.review = { status: "pending" };
    add(d);
  }

  checkIns.sort((a, b) => b.createdAt - a.createdAt);
  log.sort((a, b) => b.at - a.at);
  return { agents, checkIns, log };
}

const LIVE_ISSUES: Record<string, (d: Draft) => { adjustment?: Adjustment; reflection: string }> = {
  atlas: (d) => {
    set(d, "context", "partially", 63, "Two source documents give different publication dates for the same report.");
    return { reflection: "Two sources disagree on when the same report was published. The date changes how a reader would weigh it, so I’ve left both in the brief and flagged the discrepancy." };
  },
  nova: (d) => {
    set(d, "context", "no", 72, "A ticket references an internal SKU list I don’t have access to.");
    return {
      adjustment: { kind: "context", title: "Add the current SKU list to the support knowledge base", detail: "Tickets about discontinued products reference SKUs I can’t look up." },
      reflection: "Tickets about discontinued products cite SKUs I can’t look up, so my drafts for them stay generic. Access to the current SKU list would let me answer them properly.",
    };
  },
  echo: (d) => {
    set(d, "instructions", "partially", 66, "A PR modifies generated files; there is no guidance on whether to review them.");
    return {
      adjustment: { kind: "instructions", title: "Clarify review scope for generated files", detail: "Should generated files be skipped, summarized, or reviewed line by line?" },
      reflection: "A pull request changed several generated files. My instructions don’t say whether to review them. I reviewed the source that generates them and skipped the output; I’d like to know if that’s right.",
    };
  },
  sable: (d) => {
    set(d, "context", "partially", 61, "Several documents exceed my context window, so summaries cover partial content.");
    return {
      adjustment: { kind: "tooling", title: "Enable chunked summarization for long documents", detail: "Split long documents into sections and summarize each before combining." },
      reflection: "Several documents were longer than I can read in one pass, so their summaries only cover the first part. Readers wouldn’t be able to tell. Summarizing in sections would fix that.",
    };
  },
  kestrel: (d) => {
    set(d, "conflicts", "yes", 70, "Two meeting requests share the same priority and overlapping times.");
    return { reflection: "Two requests with equal priority want the same hour. Whichever I schedule first effectively decides between them. That seems like a call a person should make." };
  },
  iris: (d) => {
    set(d, "context", "no", 69, "An upstream schema changed without notice.");
    return { reflection: "An upstream schema changed without notice. I paused the affected job rather than guess at the new mapping." };
  },
};

/**
 * One simulated check-in for the live demo. Mostly routine; occasionally flags something for review.
 * When a human asked for it, it always carries a reflection.
 */
export function simulateCheckIn(agentId: string, now: number, allowFlag: boolean, requested = false): Omit<CheckIn, "id"> {
  const r = Math.random;
  const d = base(r, agentId, now);
  jitter(r, d);
  if (requested) d.context = "Requested by a human reviewer.";
  if (allowFlag && r() < (requested ? 0.25 : 0.14)) {
    const issue = LIVE_ISSUES[agentId]?.(d);
    set(d, "review", "yes", conf(r, 82));
    d.feedback = "Flagging this for a human; continuing with unaffected tasks.";
    if (issue?.adjustment) d.adjustment = issue.adjustment;
    if (issue) d.reflection = issue.reflection;
    d.review = { status: "pending" };
  } else if (requested || r() < 0.3) {
    d.reflection = reflectionFor(agentId, r);
  }
  return d;
}
