"use client";

import { ArrowRight, Check, X } from "lucide-react";
import { BrandMark } from "@/ui/brand-mark";
import { cx } from "../cx";
import { contrast, grade } from "../contrast";
import { Reveal } from "../motion/reveal";
import { Button } from "../ui/button";
import { StatusBadge } from "../ui/data";
import { Icon } from "../ui/icons";
import { Cap, Chapter, CopyChip, Facts, Plate, SampleTag, Sub, useToken } from "./parts";

/* ================================================================================================ 01 Overview */

export function Overview() {
  const principles = [
    ["Calm by default", "Most of what TEND shows is good news: an agent did its job inside its limits. The interface stays quiet, and only raises its voice when a person is needed."],
    ["Plain words", "“Requires review”, not “policy exception”. Every status is a word first. Colour supports the word; it never carries the meaning alone."],
    ["Precise, never loud", "Hairlines instead of boxes. One accent. Small, exact movements that explain what just happened. If it is decorative, it goes."],
  ];
  return (
    <section id="overview" aria-labelledby="overview-h" className="scroll-mt-24 py-16 md:py-24">
      <Reveal className="flex flex-col gap-8">
        <p className="flex items-center gap-3 text-t-label text-t-muted">
          <SampleTag>Version 2.0</SampleTag>
          Foundations, components and motion
        </p>
        <h1 id="overview-h" className="text-t-display text-t-ink [text-wrap:balance]">
          Powerful technology.
          <br />
          <span className="text-t-muted">Effortless control.</span>
        </h1>
        <p className="max-w-2xl text-t-lead text-t-muted [text-wrap:pretty]">
          TEND lets people run AI agents without watching every step. The design system is how that feels: warm paper, charcoal ink and a single muted
          cobalt; one typeface; restrained shapes; and motion that only ever explains cause and effect.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Button variant="primary" size="lg" trailing={ArrowRight} onClick={() => document.getElementById("colors")?.scrollIntoView({ behavior: "smooth" })}>
            Start with colour
          </Button>
          <Button variant="secondary" size="lg" onClick={() => document.getElementById("compositions")?.scrollIntoView({ behavior: "smooth" })}>
            See it in a page
          </Button>
        </div>
      </Reveal>

      <div className="mt-20 grid gap-x-12 gap-y-10 border-t border-t-line pt-10 md:grid-cols-3">
        {principles.map(([t, b], i) => (
          <Reveal key={t} delay={i * 0.07} className="flex flex-col gap-3">
            <p className="t-num text-t-caption text-t-accent-text">{String(i + 1).padStart(2, "0")}</p>
            <h3 className="text-t-h3 text-t-ink">{t}</h3>
            <p className="text-t-small text-t-muted [text-wrap:pretty]">{b}</p>
          </Reveal>
        ))}
      </div>

      <div className="mt-16 grid gap-x-12 gap-y-8 border-t border-t-line pt-10 md:grid-cols-[1fr_1.4fr]">
        <h3 className="text-t-h4 text-t-ink">What is real here, and what is not</h3>
        <ul className="flex flex-col gap-3 text-t-small text-t-muted [text-wrap:pretty]">
          <li className="flex gap-3"><Icon icon={Check} size="md" className="mt-0.5 text-t-ok" /><span>Tokens, components and motion are real, reusable code under <code className="font-t-mono text-t-code text-t-ink">src/design-system</code>.</span></li>
          <li className="flex gap-3"><Icon icon={Check} size="md" className="mt-0.5 text-t-ok" /><span>Integration names, logos and status words come from TEND’s own catalogue and product vocabulary.</span></li>
          <li className="flex gap-3"><Icon icon={X} size="md" className="mt-0.5 text-t-warn" /><span>Agents, requests, events and numbers are illustrative. Anything marked <SampleTag /> is not a claim about a real deployment, and no integration status here is a verification result.</span></li>
        </ul>
      </div>
    </section>
  );
}

/* ================================================================================================ 02 Brand */

function Gate({ className }: { className?: string }) {
  return (
    <div className={cx("relative flex h-8 items-center", className)} aria-hidden>
      <div className="t-gate w-full" />
      <span className="absolute left-[calc(50%-28px-3px)] size-1.5 bg-t-accent" />
    </div>
  );
}

export function Brand() {
  const voice: [string, string][] = [
    ["Requires review", "Policy violation detected"],
    ["Claude Code wants to push to main", "Unauthorised agent action"],
    ["Nothing runs until you decide", "Execution is blocked pending human-in-the-loop approval"],
    ["Allowed by your policy", "Compliant"],
  ];
  return (
    <Chapter
      id="brand"
      n="02"
      title="An open frame, and one square passing through."
      lead="The mark is the product in one picture: a request meets the boundary, and a decision lets it through. Everything else in the identity is quieter than the mark, so it can stay recognisable."
    >
      <Sub title="The mark" note="Three straight strokes, so it holds at 16px. It keeps its existing form; this system changes how it is coloured and how much room it gets.">
        <div className="grid overflow-hidden rounded-t-lg border border-t-line sm:grid-cols-3">
          {[
            ["bg-t-surface text-t-accent", "text-t-ink", "On paper"],
            ["bg-t-accent text-t-accent-fg", "text-t-accent-fg", "On cobalt"],
            ["bg-t-inverse text-t-inverse-text", "text-t-inverse-text", "On charcoal"],
          ].map(([bg, , label], i) => (
            <div key={label} className={cx("flex h-60 flex-col items-center justify-center gap-6", bg, i > 0 && "sm:border-l sm:border-t-line")}>
              <BrandMark className="size-20" />
              <span className="inline-flex items-center gap-2.5">
                <span className="text-[1.125rem] font-semibold tracking-[0.12em]">TEND</span>
              </span>
              <span className="sr-only">{label}</span>
            </div>
          ))}
        </div>
        <div className="grid gap-x-12 gap-y-8 md:grid-cols-2">
          <Facts
            items={[
              ["Clear space", "Half the mark’s height on every side"],
              ["Smallest size", "16px mark alone, 72px with wordmark"],
              ["Colour", "Cobalt on paper, paper on cobalt or charcoal"],
              ["Wordmark", "Geist 600, tracked +0.12em, always capitals"],
            ]}
          />
          <div className="flex flex-col gap-3 text-t-small text-t-muted">
            <p className="text-t-label text-t-ink">Never</p>
            <p>Add a glow, gradient or shadow. Rotate or outline the mark. Put the square on its own. Use the accent for anything the mark is not.</p>
          </div>
        </div>
      </Sub>

      <Sub title="The gate" note="One graphic idea, used sparingly: a hairline with an opening, and a single square. It divides content, marks a decision point, and is the object the motion system moves. It replaces decorative illustration.">
        <Plate caption="The gate, as a divider. The square is the only thing that ever sits in the opening.">
          <Gate />
          <div className="mt-6 flex items-center justify-between gap-6 text-t-small text-t-muted">
            <span>A request</span>
            <span>A decision</span>
          </div>
        </Plate>
      </Sub>

      <Sub title="Voice" note="Plain, specific and calm. The interface talks like a capable colleague, not an alarm.">
        <div className="grid gap-px overflow-hidden rounded-t-lg border border-t-line bg-t-line md:grid-cols-2">
          <div className="bg-t-canvas p-6">
            <p className="mb-4 flex items-center gap-2 text-t-label text-t-ok-ink"><Icon icon={Check} size="md" /> We say</p>
            <ul className="flex flex-col gap-3.5 text-t-small text-t-ink">{voice.map(([a]) => <li key={a}>{a}</li>)}</ul>
          </div>
          <div className="bg-t-canvas p-6">
            <p className="mb-4 flex items-center gap-2 text-t-label text-t-danger-ink"><Icon icon={X} size="md" /> We avoid</p>
            <ul className="flex flex-col gap-3.5 text-t-small text-t-muted">{voice.map(([, b]) => <li key={b}>{b}</li>)}</ul>
          </div>
        </div>
      </Sub>
    </Chapter>
  );
}

/* ================================================================================================ 03 Colour */

const COBALT = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const PAPER = [0, 25, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

function ScaleStrip({ scale, prefix }: { scale: number[]; prefix: string }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex overflow-hidden rounded-t-lg border border-t-line">
        {scale.map((s) => (
          <div key={s} className="h-24 flex-1" style={{ background: `var(--t-${prefix}-${s})` }} />
        ))}
      </div>
      <div className="flex">
        {scale.map((s) => (
          <div key={s} className="flex flex-1 flex-col items-start gap-0.5 pr-1">
            <span className="t-num text-t-caption text-t-ink">{s}</span>
            <ScaleHex name={`--t-${prefix}-${s}`} />
          </div>
        ))}
      </div>
    </div>
  );
}
function ScaleHex({ name }: { name: string }) {
  const v = useToken(name);
  return <span className="hidden font-t-mono text-[0.6875rem] text-t-muted xl:block">{v.replace("#", "")}</span>;
}

function TokenRow({ token, role }: { token: string; role: string }) {
  const v = useToken(`--t-${token}`);
  return (
    <li className="flex items-center gap-4 py-2.5">
      <span aria-hidden className="size-9 shrink-0 rounded-t-md border border-t-line" style={{ background: `var(--t-${token})` }} />
      <span className="flex min-w-0 flex-1 flex-col">
        <CopyChip value={`--t-${token}`} className="self-start !text-t-ink">{`--t-${token}`}</CopyChip>
        <span className="text-t-caption text-t-muted">{role}</span>
      </span>
      <span className="hidden font-t-mono text-[0.75rem] text-t-muted sm:block">{v}</span>
    </li>
  );
}

function TokenGroup({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div>
      <h4 className="mb-1 border-b border-t-line pb-2 text-t-label text-t-ink">{title}</h4>
      <ul className="divide-y divide-t-line">{rows.map(([t, r]) => <TokenRow key={t} token={t} role={r} />)}</ul>
    </div>
  );
}

const PAIRS: [string, string, string][] = [
  ["ink", "canvas", "Headings on page"],
  ["text", "canvas", "Body on page"],
  ["muted", "canvas", "Secondary text on page"],
  ["muted", "sunken", "Secondary text, sunken"],
  ["accent-text", "canvas", "Links on page"],
  ["accent-fg", "accent", "Primary button label"],
  ["ok-ink", "ok-soft", "Success badge"],
  ["warn-ink", "warn-soft", "Warning badge"],
  ["danger-ink", "danger-soft", "Error badge"],
  ["info-ink", "info-soft", "Info badge"],
  ["subtle", "canvas", "Placeholder (decorative only)"],
];

function PairRow({ fg, bg, label }: { fg: string; bg: string; label: string }) {
  const a = useToken(`--t-${fg}`);
  const b = useToken(`--t-${bg}`);
  const r = a && b ? contrast(a, b) : 0;
  const g = grade(r);
  const ok = r >= 4.5;
  return (
    <tr>
      <td className="py-3 pr-4">
        <span className="inline-flex h-9 min-w-24 items-center justify-center rounded-t-md border border-t-line px-3 text-t-label" style={{ color: `var(--t-${fg})`, background: `var(--t-${bg})` }}>
          Aa
        </span>
      </td>
      <td className="py-3 pr-4 text-t-small text-t-ink">{label}</td>
      <td className="hidden py-3 pr-4 font-t-mono text-[0.75rem] text-t-muted sm:table-cell">{fg} on {bg}</td>
      <td className="t-num py-3 pr-4 text-right text-t-small text-t-ink">{r ? r.toFixed(2) : "–"}:1</td>
      <td className="py-3 text-right"><StatusBadge tone={ok ? "ok" : r >= 3 ? "warn" : "danger"}>{g}</StatusBadge></td>
    </tr>
  );
}

export function Colors() {
  return (
    <Chapter
      id="colors"
      n="03"
      title="Paper, charcoal, and one cobalt."
      lead="Warm off-white and deep charcoal carry almost everything. A muted, ink-leaning cobalt marks what you can act on. Status colours are reserved for status, and always arrive with a word."
    >
      <Sub title="Brand cobalt" note="Hue 228°, deliberately duller and darker than a typical product blue. 600 is the action colour on paper; 300 takes over in the dark theme.">
        <ScaleStrip scale={COBALT} prefix="cobalt" />
      </Sub>
      <Sub title="Paper to charcoal" note="A warm neutral. White (0) is for floating surfaces only; the page is 50. No pure black anywhere.">
        <ScaleStrip scale={PAPER} prefix="paper" />
      </Sub>

      <Sub title="Semantic tokens" note="Components only ever use these. They change with the theme; the scales above do not. Click a name to copy it.">
        <div className="grid gap-x-14 gap-y-10 md:grid-cols-2">
          <TokenGroup title="Surfaces" rows={[["canvas", "The page"], ["sunken", "Wells, hover, inputs at rest"], ["surface", "Plates and panels on the page"], ["raised", "Menus, dialogs, drawers"], ["inverse", "Tooltips"]]} />
          <TokenGroup title="Text" rows={[["ink", "Headings and values"], ["text", "Body copy"], ["muted", "Secondary copy and labels"], ["subtle", "Placeholders, disabled"]]} />
          <TokenGroup title="Borders" rows={[["line", "Hairlines and dividers"], ["line-strong", "Control borders"], ["focus", "Keyboard focus ring"]]} />
          <TokenGroup title="Interactive" rows={[["accent", "Primary actions, selected"], ["accent-hover", "Hover"], ["accent-press", "Pressed"], ["accent-soft", "Selected row, info background"], ["accent-text", "Links and emphasis"]]} />
        </div>
      </Sub>

      <Sub title="Status" note="Success and error are the only colours that read as verdicts, and neither is ever used decoratively. Warning is the colour of a person being needed.">
        <div className="grid gap-px overflow-hidden rounded-t-lg border border-t-line bg-t-line sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ["Success", "ok", "Allowed, connected", "ok"],
              ["Warning", "warn", "Requires review", "warn"],
              ["Error", "danger", "Denied, failed", "danger"],
              ["Information", "info", "Notes, selected", "info"],
            ] as const
          ).map(([name, key, use, tone]) => (
            <div key={key} className="flex flex-col gap-4 bg-t-canvas p-5">
              <div>
                <p className="text-t-label text-t-ink">{name}</p>
                <p className="text-t-caption text-t-muted">{use}</p>
              </div>
              <div className="flex h-14 overflow-hidden rounded-t-md border border-t-line">
                {["", "-soft", "-ink", "-line"].map((s) => <div key={s} className="flex-1" style={{ background: `var(--t-${key}${s})` }} title={`--t-${key}${s}`} />)}
              </div>
              <div className="flex flex-wrap items-center gap-2"><StatusBadge tone={tone}>{name === "Information" ? "Info" : name}</StatusBadge></div>
              <p className="font-t-mono text-[0.6875rem] text-t-muted">{key} · soft · ink · line</p>
            </div>
          ))}
        </div>
      </Sub>

      <Sub title="Interactive states" note="One accent, five states. The focus ring is a 2px outline, offset 2px, and is never removed.">
        <Plate>
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-5">
            {[
              ["Default", "bg-t-accent"],
              ["Hover", "bg-t-accent-hover"],
              ["Pressed", "bg-t-accent-press"],
              ["Focus", "bg-t-accent outline-2 outline-offset-2 outline-t-focus"],
              ["Disabled", "bg-t-accent opacity-45"],
            ].map(([n, c]) => (
              <div key={n}>
                <Cap>{n}</Cap>
                <div className={cx("h-10 rounded-t-md shadow-t-button", c)} />
              </div>
            ))}
          </div>
        </Plate>
      </Sub>

      <Sub title="Contrast, measured" note="Calculated live from the tokens in the current theme. Text pairs meet WCAG AA (4.5:1). Placeholder text is decorative: the label above a field always carries the meaning.">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-t-line text-t-caption text-t-muted">
              <th className="pb-2 font-normal">Sample</th><th className="pb-2 font-normal">Used for</th><th className="hidden pb-2 font-normal sm:table-cell">Pair</th>
              <th className="pb-2 text-right font-normal">Ratio</th><th className="pb-2 text-right font-normal">Grade</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-t-line">{PAIRS.map(([f, b, l]) => <PairRow key={f + b} fg={f} bg={b} label={l} />)}</tbody>
        </table>
      </Sub>
    </Chapter>
  );
}

/* ================================================================================================ 04 Typography */

const SCALE = [
  { cls: "text-t-display", name: "Display", spec: "48 → 96 · 0.98 · −0.055em · 500", use: "One per marketing page", sample: "Effortless control." },
  { cls: "text-t-hero", name: "Hero", spec: "40 → 72 · 1.02 · −0.045em · 500", use: "Page headlines", sample: "Let agents work. Stay in charge." },
  { cls: "text-t-h1", name: "Heading 1", spec: "32 → 48 · 1.08 · −0.036em · 500", use: "Section titles, app page titles", sample: "Agents and their policies" },
  { cls: "text-t-h2", name: "Heading 2", spec: "24 → 32 · 1.15 · −0.028em · 500", use: "Subsections", sample: "What the policy allows" },
  { cls: "text-t-h3", name: "Heading 3", spec: "20 → 24 · 1.25 · −0.022em · 500", use: "Panels, dialog titles", sample: "Approve this request?" },
  { cls: "text-t-h4", name: "Heading 4", spec: "18 · 1.35 · −0.016em · 560", use: "Component titles", sample: "Release assistant wants to push code" },
  { cls: "text-t-lead", name: "Body large", spec: "17 → 20 · 1.6 · −0.014em · 400", use: "Intros, marketing paragraphs", sample: "TEND sits between your agents and the things they touch, and asks you only when it matters." },
  { cls: "text-t-body", name: "Body", spec: "16 · 1.625 · −0.008em · 400", use: "Reading text", sample: "Policies decide what an agent can do on its own, what needs a person, and what is never allowed." },
  { cls: "text-t-small", name: "Body small", spec: "14 · 1.5 · −0.004em · 400", use: "Application text, tables", sample: "Last changed by Dana Reyes, 12 minutes ago." },
  { cls: "text-t-label", name: "Label", spec: "14 · 20px · −0.004em · 500", use: "Buttons, form labels, tabs", sample: "Approve once" },
  { cls: "text-t-caption", name: "Caption", spec: "13 · 1.4 · 0 · 400", use: "Metadata, hints, timestamps", sample: "Requested 2 minutes ago · 3 agents affected" },
  { cls: "font-t-mono text-t-code", name: "Code", spec: "13 · 1.65 · 0 · Geist Mono 400", use: "Commands, identifiers, paths, data", sample: "git push origin feature/discount-codes" },
];

export function Typography() {
  return (
    <Chapter
      id="typography"
      n="04"
      title="One typeface, set with care."
      lead="Geist carries everything: headlines, interface, tables. It is geometric without being cold, has true tabular figures, and ships with a matching mono, so code never needs a second personality. The mono appears only for code, identifiers and technical data."
    >
      <Sub title="Geist" note="Variable weight, used at 400, 500, 560 and 600. Headlines sit at 500, never bold, with tracking pulled in as size grows.">
        <div className="grid items-end gap-x-12 gap-y-8 border-y border-t-line py-10 md:grid-cols-[auto_1fr]">
          <p className="text-[8.5rem] leading-[0.8] font-medium tracking-[-0.06em] text-t-ink md:text-[11rem]" aria-hidden>Aa</p>
          <div className="flex flex-col gap-4">
            <p className="text-t-h3 text-t-ink [text-wrap:balance]">Agents ask. Policies decide. People review what matters.</p>
            <p className="font-t-sans text-t-small break-all text-t-muted">ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789 &amp;@#%→</p>
            <p className="font-t-mono text-t-code break-all text-t-muted">Geist Mono: shell.run  file.write  0x4f2a  {"{ \"decision\": \"allow\" }"}</p>
          </div>
        </div>
      </Sub>

      <Sub title="The scale" note="Each role is one utility class that sets size, line height, tracking and weight together. Display sizes scale fluidly with the viewport; running text is fixed so the measure stays predictable. Nothing is smaller than 13px.">
        <div className="divide-y divide-t-line border-y border-t-line">
          {SCALE.map((s) => (
            <div key={s.name} className="grid gap-x-10 gap-y-3 py-7 md:grid-cols-[13rem_1fr]">
              <div className="flex flex-col gap-1">
                <p className="text-t-label text-t-ink">{s.name}</p>
                <p className="font-t-mono text-[0.75rem] leading-5 text-t-muted">{s.spec}</p>
                <p className="text-t-caption text-t-muted">{s.use}</p>
              </div>
              <p className={cx(s.cls, "min-w-0 text-t-ink [text-wrap:balance]")}>{s.sample}</p>
            </div>
          ))}
        </div>
      </Sub>

      <Sub title="Setting headlines" note="Line breaks are part of the design.">
        <div className="grid gap-x-12 gap-y-10 md:grid-cols-2">
          <div className="flex flex-col gap-3">
            <Cap>Balanced: lines of similar length</Cap>
            <p className="text-t-h2 text-t-ink [text-wrap:balance]">Your agents work. You decide when it matters.</p>
          </div>
          <div className="flex flex-col gap-3">
            <Cap>Unbalanced: a stranded last word</Cap>
            <p className="text-t-h2 text-t-muted [text-wrap:wrap]" style={{ maxWidth: "20ch" }}>Your agents work. You decide when it matters.</p>
          </div>
        </div>
        <Facts
          items={[
            ["Headlines", "text-wrap: balance, 12 to 18 words at most, never ending on a single short word"],
            ["Paragraphs", "text-wrap: pretty, 60 to 68 characters per line (max-width 40rem)"],
            ["Labels", "Sentence case. No uppercase labels, no letter-spaced eyebrows"],
            ["Numbers", "Tabular figures in tables, timestamps and counters"],
          ]}
        />
      </Sub>
    </Chapter>
  );
}
