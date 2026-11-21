"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRightIcon, CheckIcon, CopyIcon, MinusIcon } from "lucide-react";
import { useT } from "@/i18n/client";
import { BRAND_ICONS } from "@/lib/brand-icons";
import { INTEGRATIONS, statusOf, verificationOf } from "@/lib/integrations-catalog";
import { cn } from "@/lib/utils";
import { DemoButton } from "@/ui/demo-button";
import { ExploreLink, PrimaryLink, QuietLink, useSeen } from "../kit";
import { Reveal } from "../reveal";
import SCREENS from "../screens.json";
import { SITE } from "../site";

// The homepage after the passage. Each section has its own visual: a reach diagram, a protocol sequence, real screenshots of the app,
// rule specimens, the repository's own code, and a plain list of what TEND does and doesn't do. Everything shown as working is
// working in the repository; examples are marked as examples.

type ShotName = keyof typeof SCREENS;
/** A screenshot in the app's dark theme: the homepage is always dark, so its screens are too. */
function DarkShot({ name, alt, sizes, className, eager }: { name: ShotName; alt: string; sizes: string; className?: string; eager?: boolean }) {
  const s = SCREENS[name];
  const set = (ext: string) => s.widths.map((w) => `/screens/${name}-dark-${w}.${ext} ${w}w`).join(", ");
  const mid = s.widths[Math.min(3, s.widths.length - 1)];
  return (
    <picture className="contents">
      <source type="image/avif" srcSet={set("avif")} sizes={sizes} />
      <img src={`/screens/${name}-dark-${mid}.webp`} srcSet={set("webp")} sizes={sizes} alt={alt} width={s.w} height={s.h} loading={eager ? "eager" : "lazy"} decoding="async" draggable={false} className={cn("block h-auto w-full select-none", className)} />
    </picture>
  );
}

function Wrap({ children, className }: { children: React.ReactNode; className?: string }) {
  // Its children never grow past their grid track because of a long line of code inside them.
  return <div className={cn("mx-auto w-full max-w-[1240px] px-5 sm:px-8 [&>*]:min-w-0", className)}>{children}</div>;
}
function Kicker({ n, children }: { n: string; children: React.ReactNode }) {
  return <p className="flex items-center gap-3 font-mono text-[12px] text-[var(--kick)]"><span className="text-[var(--ink-3)]">{n}</span>{children}</p>;
}
function Title({ id, children, className }: { id?: string; children: React.ReactNode; className?: string }) {
  return <h2 id={id} className={cn("mt-5 text-[clamp(2.1rem,4.4vw,3.9rem)] leading-[1.02] font-normal tracking-[-0.045em] text-balance text-[var(--ink)]", className)}>{children}</h2>;
}
const VERDICT = { allow: "var(--v-allow)", ask: "var(--v-ask)", never: "var(--v-never)" } as const;
type Verdict = keyof typeof VERDICT;
function VerdictTag({ v, label }: { v: Verdict; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[11.5px]" style={{ color: VERDICT[v] }}>
      <span className="size-[6px] rounded-full" style={{ background: VERDICT[v] }} />{label}
    </span>
  );
}

// ——— A. The problem: an agent's reach, without and with a checkpoint ———

const SPOKES: { tool: string; target: string; v: Verdict; noRule?: boolean }[] = [
  { tool: "send_email", target: "clients", v: "ask" },
  { tool: "issue_refund", target: "cards", v: "ask" },
  { tool: "git push", target: "main", v: "ask" },
  { tool: "delete_record", target: "crm", v: "never" },
  { tool: "export_table", target: "customers", v: "never", noRule: true },
  { tool: "read_docs", target: "wiki", v: "allow" },
];

export function Problem() {
  const p = useT().land.problem;
  const [ref, seen] = useSeen<HTMLDivElement>("0px 0px -25% 0px");
  const [withTend, setWithTend] = useState(false);
  const [touched, setTouched] = useState(false);
  // Once seen, the diagram shows the difference by itself, once; after that the visitor decides.
  useEffect(() => {
    if (!seen || touched || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setTimeout(() => setWithTend(true), 2600);
    return () => clearTimeout(id);
  }, [seen, touched]);
  const choose = (v: boolean) => { setTouched(true); setWithTend(v); };
  const C = 300, R = 228, G = 138;
  return (
    <section aria-labelledby="problem-title" className="tone-light relative z-10 -mt-8 rounded-t-[28px] py-24 md:py-36">
      <Wrap className="grid items-center gap-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-20">
        <div>
          <Kicker n="01">{p.kicker}</Kicker>
          <Title id="problem-title">{p.title}</Title>
          <p className="mt-6 max-w-[52ch] text-[17px] leading-[1.55] text-[var(--ink-2)]">{p.body}</p>
          <dl className="mt-10 grid gap-6 sm:grid-cols-3 sm:gap-6">
            {p.points.map((pt) => (
              <div key={pt.title} className="border-t border-[var(--rule)] pt-4">
                <dt className="text-[15px] text-[var(--ink)]">{pt.title}</dt>
                <dd className="mt-1.5 text-[14px] leading-[1.5] text-[var(--ink-2)]">{pt.body}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-10 text-[19px] leading-[1.4] tracking-[-0.01em] text-[var(--ink)]">{p.answer}</p>
        </div>

        <div ref={ref} className={cn("pb-reach", seen && "is-seen", withTend && "is-with")}>
          <div role="group" aria-label={p.kicker} className="mb-6 inline-flex rounded-full border border-[var(--rule)] p-1 text-[13px]">
            {[false, true].map((v) => (
              <button key={String(v)} type="button" aria-pressed={withTend === v} onClick={() => choose(v)}
                className={cn("mk-press h-8 rounded-full px-4 outline-none pointer-coarse:h-10", withTend === v ? "bg-[var(--ink)] text-[var(--panel)]" : "text-[var(--ink-2)] hover:text-[var(--ink)]")}>
                {v ? p.with : p.without}
              </button>
            ))}
          </div>
          <svg viewBox="0 0 600 600" className="block h-auto w-full max-w-[600px]" role="img" aria-label={withTend ? p.withCaption : p.caption}>
            <circle cx={C} cy={C} r={R + 40} className="pb-ring-faint" />
            <circle cx={C} cy={C} r={G} className="pb-gate-ring" pathLength={1} />
            {SPOKES.map((s, i) => {
              const a = (-90 + i * 60) * (Math.PI / 180);
              const x1 = C + Math.cos(a) * 52, y1 = C + Math.sin(a) * 52;
              const gx = C + Math.cos(a) * G, gy = C + Math.sin(a) * G;
              const x2 = C + Math.cos(a) * R, y2 = C + Math.sin(a) * R;
              const lx = C + Math.cos(a) * (R + 14), ly = C + Math.sin(a) * (R + 14);
              const anchor = Math.abs(Math.cos(a)) < 0.2 ? "middle" : Math.cos(a) > 0 ? "start" : "end";
              const dy = Math.sin(a) < -0.5 ? -22 : Math.sin(a) > 0.5 ? 18 : -4;
              return (
                <g key={s.tool} className={cn("pb-spoke", `pb-${s.v}`)} style={{ ["--i" as string]: i, ["--c" as string]: VERDICT[s.v] }}>
                  <line x1={x1} y1={y1} x2={gx} y2={gy} pathLength={1} className="pb-in" />
                  <line x1={gx} y1={gy} x2={x2} y2={y2} pathLength={1} className="pb-out" />
                  <circle cx={x2} cy={y2} r={4.5} className="pb-end" />
                  <g className="pb-gate">
                    <circle cx={gx} cy={gy} r={9} />
                    <circle cx={gx} cy={gy} r={3.5} className="pb-gate-dot" />
                  </g>
                  <text x={lx} y={ly + dy} textAnchor={anchor} className="pb-tool">{s.tool}</text>
                  <text x={lx} y={ly + dy + 16} textAnchor={anchor} className="pb-target">→ {s.target}</text>
                  <text x={lx} y={ly + dy + 32} textAnchor={anchor} className="pb-verdict">{s.noRule ? "no rule · refused" : s.v === "ask" ? "approve" : s.v === "allow" ? "allow" : "deny"}</text>
                </g>
              );
            })}
            <circle cx={C} cy={C} r={46} className="pb-core" />
            <text x={C} y={C + 5} textAnchor="middle" className="pb-core-label">{p.center}</text>
            <text x={C + G * 0.72} y={C - G * 0.72 - 8} className="pb-gate-label">TEND</text>
          </svg>
          <p className="mt-4 max-w-[46ch] text-[13.5px] leading-[1.5] text-[var(--ink-3)]" aria-live="polite">{withTend ? p.withCaption : p.caption}</p>
        </div>
      </Wrap>
    </section>
  );
}

// ——— B. How it works: three steps, and the protocol as a sequence ———

const LANE_X = [110, 370, 630, 870];
const MSGS: [from: number, to: number][] = [[0, 1], [1, 1], [1, 2], [2, 1], [1, 0], [0, 1], [0, 3], [0, 1]];

export function HowItWorks() {
  const h = useT().land.how;
  const [ref, seen] = useSeen<HTMLDivElement>("0px 0px -20% 0px");
  return (
    <section aria-labelledby="how-title" className="tone-dark relative py-24 md:py-36">
      <Wrap>
        <Kicker n="02">{h.kicker}</Kicker>
        <Title id="how-title" className="max-w-[18ch]">{h.title}</Title>
        <ol className="mt-16 grid gap-12 md:grid-cols-3 md:gap-10">
          {h.steps.map((st, i) => (
            <Reveal as="li" key={st.title} delay={i * 90} className="relative">
              <p className="text-[64px] leading-none font-light tracking-[-0.06em] text-[var(--faint)] tabular-nums">{i + 1}</p>
              <h3 className="mt-5 text-[21px] tracking-[-0.02em] text-[var(--ink)]">{st.title}</h3>
              <p className="mt-2.5 max-w-[38ch] text-[15.5px] leading-[1.55] text-[var(--ink-2)]">{st.body}</p>
            </Reveal>
          ))}
        </ol>

        <div ref={ref} className={cn("hw-seq mt-24 rounded-2xl border border-[var(--rule)] bg-[var(--panel)] p-5 sm:p-8", seen && "is-seen")}>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h3 className="text-[15px] text-[var(--ink)]">{h.seqTitle}</h3>
            <p className="font-mono text-[11.5px] text-[var(--ink-3)]">POST /api/v1/authorizations → /token → /consume → /events</p>
          </div>
          <svg viewBox="0 0 980 520" className="mt-8 hidden h-auto w-full md:block" role="img" aria-label={h.seqTitle}>
            {h.lanes.map((lane, i) => (
              <g key={lane}>
                <rect x={LANE_X[i] - 62} y={8} width={124} height={34} rx={7} className={cn("hw-lane-box", i === 1 && "hw-lane-tend")} />
                <text x={LANE_X[i]} y={30} textAnchor="middle" className="hw-lane-label">{lane}</text>
                <line x1={LANE_X[i]} y1={46} x2={LANE_X[i]} y2={510} className="hw-lane" />
              </g>
            ))}
            {MSGS.map(([a, b], i) => {
              const y = 86 + i * 54;
              const label = h.messages[i];
              if (a === b) {
                const x = LANE_X[a];
                return (
                  <g key={i} className="hw-msg" style={{ ["--i" as string]: i }}>
                    <path d={`M ${x} ${y - 10} h 46 v 22 h -40`} className="hw-arrow" fill="none" />
                    <path d={`M ${x + 10} ${y + 7} l -5 5 l 5 5`} className="hw-arrow" fill="none" />
                    <text x={x + 58} y={y + 5} className="hw-text hw-amber">{label}</text>
                  </g>
                );
              }
              const x1 = LANE_X[a], x2 = LANE_X[b], dir = x2 > x1 ? 1 : -1;
              return (
                <g key={i} className="hw-msg" style={{ ["--i" as string]: i }}>
                  <line x1={x1 + dir * 4} y1={y} x2={x2 - dir * 6} y2={y} className={cn("hw-arrow", b === 3 && "hw-arrow-run")} />
                  <path d={`M ${x2 - dir * 12} ${y - 5} L ${x2 - dir * 5} ${y} L ${x2 - dir * 12} ${y + 5}`} className={cn("hw-arrow", b === 3 && "hw-arrow-run")} fill="none" />
                  <text x={(x1 + x2) / 2} y={y - 9} textAnchor="middle" className={cn("hw-text", b === 3 && "hw-green")}>{label}</text>
                </g>
              );
            })}
          </svg>
          <ol className="mt-6 grid gap-3 md:hidden">
            {MSGS.map(([a, b], i) => (
              <li key={i} className="grid grid-cols-[22px_1fr] gap-2 border-t border-[var(--rule)] pt-3 text-[13.5px]">
                <span className="font-mono text-[11px] text-[var(--ink-3)]">{i + 1}</span>
                <span><span className="font-mono text-[11.5px] text-[var(--ink-3)]">{h.lanes[a]}{a !== b && ` → ${h.lanes[b]}`}</span><br /><span className="text-[var(--ink)]">{h.messages[i]}</span></span>
              </li>
            ))}
          </ol>
          <p className="mt-6 text-[13px] text-[var(--ink-3)]">{h.seqNote}</p>
        </div>
      </Wrap>
    </section>
  );
}

// ——— C. The product: each capability in its own composition ———

export function ProductTour() {
  const t = useT();
  const c = t.land.product;
  const verified = INTEGRATIONS.filter((i) => statusOf(i) === "verified");
  return (
    <section aria-labelledby="product-title" className="tone-ink relative border-t border-[var(--rule)] py-24 md:py-36">
      <Wrap>
        <Kicker n="03">{c.kicker}</Kicker>
        <Title id="product-title" className="max-w-[16ch]">{c.title}</Title>
      </Wrap>

      {/* Approvals: the screen, and the same on a phone, overlapping. */}
      <Wrap className="mt-20 grid items-center gap-12 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:gap-16">
        <Reveal className="relative pr-[12%] pb-[14%] sm:pr-[16%]">
          <div className="overflow-hidden rounded-xl border border-[var(--rule)] bg-[#131211] shadow-[0_40px_100px_-40px_rgb(0_0_0/0.9)]">
            <DarkShot name="approvals-card" alt={c.approvals.alt} sizes="(max-width: 1024px) 80vw, 680px" />
          </div>
          <div className="absolute right-0 bottom-0 w-[30%] overflow-hidden rounded-[22px] border-[5px] border-[#1b1d20] bg-[#131211] shadow-[0_30px_70px_-20px_rgb(0_0_0/0.95)]">
            <DarkShot name="phone-approvals" alt={c.approvals.phoneAlt} sizes="(max-width: 1024px) 26vw, 220px" />
          </div>
        </Reveal>
        <Feature tag={c.approvals.tag} title={c.approvals.title} body={c.approvals.body} href="/product/approvals" link={c.explore} />
      </Wrap>

      {/* Rules: the editor, with a rule as it is stored. */}
      <Wrap className="mt-32 grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] lg:gap-16">
        <div className="lg:order-1">
          <Feature tag={c.rules.tag} title={c.rules.title} body={c.rules.body} href="/product/rules" link={c.explore} />
        </div>
        <Reveal className="relative lg:order-2">
          <div className="overflow-hidden rounded-xl border border-[var(--rule)] bg-[#131211]">
            <DarkShot name="policies-edit" alt={c.rules.alt} sizes="(max-width: 1024px) 90vw, 700px" />
          </div>
          <pre className="relative -mt-10 ml-auto w-[min(100%,440px)] overflow-x-auto rounded-xl border border-[var(--rule)] bg-[var(--panel)]/95 p-4 font-mono text-[11.5px] leading-[1.7] text-[var(--ink-2)] shadow-[0_30px_80px_-30px_rgb(0_0_0/0.9)] sm:-mt-16 sm:mr-[-4%]">
            <span className="text-[var(--ink-3)]">{"// first match wins"}</span>{"\n"}
            {"{ "}<K>tool</K>{": "}<S>&quot;send_email&quot;</S>{", "}<K>action</K>{": "}<S>&quot;send&quot;</S>{",\n  "}<K>when</K>{": { "}<K>to</K>{": { "}<K>emailDomainIn</K>{": ["}<S>&quot;example.com&quot;</S>{"] } },\n  "}<K>effect</K>{": "}<span className="text-[var(--v-allow)]">&quot;allow&quot;</span>{" }\n"}
            {"{ "}<K>tool</K>{": "}<S>&quot;send_email&quot;</S>{", "}<K>action</K>{": "}<S>&quot;send&quot;</S>{", "}<K>effect</K>{": "}<span className="text-[var(--v-ask)]">&quot;approve&quot;</span>{" }"}
          </pre>
        </Reveal>
      </Wrap>

      {/* Activity: wide, as it is used. */}
      <Wrap className="mt-32">
        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-end">
          <Feature tag={c.activity.tag} title={c.activity.title} body={c.activity.body} href="/product/activity" link={c.explore} />
        </div>
        <Reveal className="mt-10 overflow-hidden rounded-xl border border-[var(--rule)] bg-[#131211] shadow-[0_40px_120px_-50px_rgb(0_0_0/0.9)]">
          <DarkShot name="activity" alt={c.activity.alt} sizes="(max-width: 1280px) 94vw, 1180px" />
        </Reveal>
      </Wrap>

      {/* Keys and central policies: two small diagrams, side by side. */}
      <Wrap className="mt-32 grid gap-16 md:grid-cols-2 md:gap-10">
        <Reveal>
          <p className="font-mono text-[12px] text-[var(--kick)]">{c.keys.tag}</p>
          <h3 className="mt-3 text-[26px] leading-[1.15] tracking-[-0.03em] text-[var(--ink)]">{c.keys.title}</h3>
          <p className="mt-3 max-w-[44ch] text-[15.5px] leading-[1.55] text-[var(--ink-2)]">{c.keys.body}</p>
          <ul className="mt-8 grid font-mono text-[12.5px]">
            {[["support-bot", "tend_sk_••••a41c", true], ["repo-helper", "tend_sk_••••0e9b", false], ["ops-agent", "tend_sk_••••77d2", true]].map(([name, key, ok]) => (
              <li key={name as string} className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-t border-[var(--rule)] py-3 last:border-b">
                <span className={ok ? "text-[var(--ink)]" : "text-[var(--ink-3)]"}>{name}</span>
                <span className={ok ? "text-[var(--ink-3)]" : "text-[var(--ink-3)] line-through"}>{key}</span>
                <span className={ok ? "text-[var(--v-allow)]" : "text-[var(--v-never)]"}>{ok ? c.keys.active : c.keys.revoked}</span>
              </li>
            ))}
          </ul>
        </Reveal>
        <Reveal delay={100}>
          <p className="font-mono text-[12px] text-[var(--kick)]">{c.central.tag}</p>
          <h3 className="mt-3 text-[26px] leading-[1.15] tracking-[-0.03em] text-[var(--ink)]">{c.central.title}</h3>
          <p className="mt-3 max-w-[44ch] text-[15.5px] leading-[1.55] text-[var(--ink-2)]">{c.central.body}</p>
          <div className="mt-8 grid font-mono text-[12.5px]">
            {([[c.central.centralLabel, "approve", "ask"], [c.central.ownLabel, "allow", "allow"]] as [string, string, Verdict][]).map(([label, eff, v]) => (
              <div key={label} className="grid grid-cols-[1fr_auto] items-center border-t border-[var(--rule)] py-3">
                <span className="font-sans text-[13.5px] text-[var(--ink-2)]">{label} <span className="ml-2 font-mono text-[12px] text-[var(--ink-3)]">send_email · send</span></span>
                <span style={{ color: VERDICT[v] }}>{eff}</span>
              </div>
            ))}
            <div className="grid grid-cols-[1fr_auto] items-center border-y border-[var(--rule)] py-3">
              <span className="font-sans text-[13.5px] text-[var(--ink)]">{c.central.resultLabel}</span>
              <span className="text-[var(--v-ask)]">approve</span>
            </div>
          </div>
        </Reveal>
      </Wrap>

      {/* Integrations: the verified ones, read from the verification report. */}
      <Wrap className="mt-32">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:gap-16">
          <div>
            <p className="font-mono text-[12px] text-[var(--kick)]">{c.integrations.tag}</p>
            <h3 className="mt-3 text-[26px] leading-[1.15] tracking-[-0.03em] text-[var(--ink)]">{c.integrations.title}</h3>
            <p className="mt-3 max-w-[44ch] text-[15.5px] leading-[1.55] text-[var(--ink-2)]">{c.integrations.body}</p>
            <p className="mt-4 max-w-[44ch] text-[13.5px] leading-[1.5] text-[var(--ink-3)]">{c.integrations.note}</p>
            <ExploreLink href="/verification-report" className="mt-6">{c.integrations.link}</ExploreLink>
          </div>
          <ul className="grid content-start sm:grid-cols-2 sm:gap-x-8">
            {verified.map((it) => {
              const icon = it.logo ? BRAND_ICONS[it.logo] : undefined;
              return (
                <li key={it.id} className="flex items-center gap-3 border-t border-[var(--rule)] py-3.5">
                  <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-md border border-[var(--rule)] text-[var(--ink-2)]">
                    {icon ? <svg viewBox="0 0 24 24" className="size-3.5" fill="currentColor"><path d={icon.path} /></svg> : <span className="font-mono text-[10px]">{it.name.slice(0, 2)}</span>}
                  </span>
                  <span className="min-w-0 truncate text-[14.5px] text-[var(--ink)]" title={verificationOf(it)?.label}>{it.name}</span>
                  <CheckIcon aria-hidden className="ml-auto size-3.5 shrink-0 text-[var(--v-allow)]" strokeWidth={2.25} />
                </li>
              );
            })}
          </ul>
        </div>
      </Wrap>
    </section>
  );
}
const K = ({ children }: { children: React.ReactNode }) => <span className="text-[var(--kick)]">{children}</span>;
const S = ({ children }: { children: React.ReactNode }) => <span className="text-[var(--ink)]">{children}</span>;

function Feature({ tag, title, body, href, link }: { tag: string; title: string; body: string; href: string; link: string }) {
  return (
    <Reveal>
      <p className="font-mono text-[12px] text-[var(--kick)]">{tag}</p>
      <h3 className="mt-3 max-w-[20ch] text-[clamp(1.6rem,2.6vw,2.15rem)] leading-[1.1] tracking-[-0.035em] text-[var(--ink)]">{title}</h3>
      <p className="mt-4 max-w-[44ch] text-[16px] leading-[1.55] text-[var(--ink-2)]">{body}</p>
      <ExploreLink href={href} className="mt-6">{link}</ExploreLink>
    </Reveal>
  );
}

// ——— D. Where it matters: one rule specimen per use ———

export function UseCases() {
  const u = useT().land.uses;
  const V = u.verdicts;
  const specimens: React.ReactNode[] = [
    // Software development: shell commands, as Claude Code's hooks report them.
    <div key="code" className="grid gap-2 font-mono text-[12.5px]">
      {[["git status", "allow" as Verdict], ["git push origin main", "ask" as Verdict], ["cat ~/.ssh/id_ed25519", "never" as Verdict]].map(([cmd, v]) => (
        <div key={cmd} className="flex items-center justify-between gap-4 rounded-md border border-[var(--rule)] bg-[var(--panel)] px-3 py-2.5">
          <span className="truncate text-[var(--ink)]"><span className="mr-2 text-[var(--ink-3)]">$</span>{cmd}</span>
          <VerdictTag v={v as Verdict} label={V[v as Verdict]} />
        </div>
      ))}
    </div>,
    // Refunds: a number line with the threshold.
    <div key="money" className="relative pt-10 pb-12">
      <div className="relative h-px bg-[var(--rule)]">
        {[0, 25, 50, 100, 200].map((n) => (
          <span key={n} className="absolute top-0 h-2 w-px bg-white/[0.25]" style={{ left: `${(n / 200) * 100}%` }}>
            <span className="absolute top-3 -translate-x-1/2 font-mono text-[10.5px] text-[var(--ink-3)]">{n}</span>
          </span>
        ))}
        <span className="absolute -top-[3px] left-0 h-[7px] rounded-full bg-[var(--v-allow)]/25" style={{ width: "25%" }} />
        <span className="absolute -top-[3px] h-[7px] rounded-full bg-[var(--v-ask)]/20" style={{ left: "25%", right: 0 }} />
        <span className="absolute -top-8 -translate-x-1/2 font-mono text-[11px] text-[var(--kick)]" style={{ left: "25%" }}>amount ≤ 50</span>
        <span className="absolute top-0 h-5 w-px -translate-y-1/2 bg-[var(--kick)]" style={{ left: "25%" }} />
        {[[21, "allow" as Verdict], [140, "ask" as Verdict]].map(([n, v]) => (
          <span key={n} className="absolute -translate-x-1/2" style={{ left: `${((n as number) / 200) * 100}%`, top: 22 }}>
            <span className="block size-2.5 -translate-y-[27px] rounded-full ring-4 ring-[var(--panel)]" style={{ background: VERDICT[v as Verdict], marginLeft: "auto", marginRight: "auto" }} />
            <span className="mt-1 block text-center whitespace-nowrap"><span className="font-mono text-[11.5px] text-[var(--ink)]">€{n}</span> <VerdictTag v={v as Verdict} label={V[v as Verdict]} /></span>
          </span>
        ))}
      </div>
    </div>,
    // Customer data: read versus delete.
    <div key="data" className="grid grid-cols-[auto_1fr] items-stretch gap-4">
      <div className="w-[118px] rounded-md border border-[var(--rule)] bg-[var(--panel)] p-3 font-mono text-[10.5px] leading-[1.7] text-[var(--ink-3)]">
        <p className="text-[var(--ink-2)]">customer-1042</p><p>name ····</p><p>email ····</p><p>plan ····</p>
      </div>
      <div className="grid content-center gap-2 font-mono text-[12.5px]">
        {[["read_record · read", "allow" as Verdict], ["delete_record · delete", "never" as Verdict]].map(([a, v]) => (
          <div key={a} className="flex items-center justify-between gap-3 border-b border-[var(--rule)] pb-2"><span className="text-[var(--ink)]">{a}</span><VerdictTag v={v as Verdict} label={V[v as Verdict]} /></div>
        ))}
      </div>
    </div>,
    // Messages: recipients against an allowed domain.
    <div key="mail" className="grid gap-2 font-mono text-[12.5px]">
      <p className="mb-1 text-[11px] text-[var(--ink-3)]">{"when: { to: { emailDomainIn: [\"example.com\"] } }"}</p>
      {[["team@example.com", "allow" as Verdict], ["ana@example.com", "allow" as Verdict], ["partner@other.org", "ask" as Verdict]].map(([to, v]) => (
        <div key={to} className="flex items-center justify-between gap-4 border-b border-[var(--rule)] pb-2"><span className="text-[var(--ink)]"><span className="mr-2 text-[var(--ink-3)]">to</span>{to}</span><VerdictTag v={v as Verdict} label={V[v as Verdict]} /></div>
      ))}
    </div>,
  ];
  return (
    <section aria-labelledby="uses-title" className="tone-light relative py-24 md:py-36">
      <Wrap>
        <div className="grid gap-6 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] md:items-end">
          <div>
            <Kicker n="04">{u.kicker}</Kicker>
            <Title id="uses-title" className="max-w-[17ch]">{u.title}</Title>
          </div>
          <p className="text-[14px] text-[var(--ink-3)] md:justify-self-end md:text-right">{u.note}</p>
        </div>
        <ol className="mt-16">
          {u.items.map((it, i) => (
            <Reveal as="li" key={it.title} className="grid gap-8 border-t border-[var(--rule)] py-10 md:grid-cols-[64px_minmax(0,1fr)_minmax(0,1.1fr)] md:gap-10 md:py-12">
              <span className="font-mono text-[12px] text-[var(--ink-3)]">0{i + 1}</span>
              <div>
                <h3 className="text-[24px] leading-[1.15] tracking-[-0.03em] text-[var(--ink)]">{it.title}</h3>
                <p className="mt-3 max-w-[42ch] text-[15.5px] leading-[1.55] text-[var(--ink-2)]">{it.body}</p>
              </div>
              <div className="min-w-0 self-center">{specimens[i]}</div>
            </Reveal>
          ))}
        </ol>
      </Wrap>
    </section>
  );
}

// ——— E. Developers: the repository's own code ———

const CODE: Record<"js" | "py" | "mcp" | "cli", { file: string; lang: "js" | "py" | "json" | "sh"; code: string }> = {
  js: {
    file: "examples/claude-quickstart/tend-client.mjs",
    lang: "js",
    code: `import { connectTend } from "./tend-client.mjs";
const gate = connectTend();  // reads TEND_URL, TEND_AGENT_KEY

const out = await gate.run(
  // exactly what the person approves
  { tool: "send_email", action: "send",
    resource: "team-mailing-list",
    detail: "Email the weekly brief to team@example.com" },
  // runs only if TEND said yes, and at most once
  () => sendEmail(/* your real code */),
);
if (!out.executed) return \`Not done: \${out.outcome}\`;`,
  },
  py: {
    file: "public/sdk/tend_gate.py",
    lang: "py",
    code: `from tend_gate import Gate, guard_tool

gate = Gate()  # TEND_URL and TEND_AGENT_KEY from the environment

# The model calls send_email(...) as before. It runs only on TEND's yes;
# otherwise the model gets a sentence starting with "Not done".
send_email = guard_tool(gate, "send_email", send_email)`,
  },
  mcp: {
    file: "examples/mcp-proxy/tend-mcp-proxy.mjs",
    lang: "json",
    code: `{
  "command": "node",
  "args": ["/path/to/tend-mcp-proxy.mjs", "--",
           "npx", "-y", "some-mcp-server"],
  "env": { "TEND_URL": "http://localhost:3000",
           "TEND_AGENT_KEY": "tend_sk_..." }
}`,
  },
  cli: {
    file: "README.md",
    lang: "sh",
    code: `npm run tester:agent -- "My agent" \\
  --rule read_ticket:read:allow \\
  --rule send_email:send:approve \\
  --rule delete_record:delete:deny`,
  },
};

/** A small highlighter for the four samples: comments, strings, and nothing else. */
function highlight(code: string, lang: string) {
  const re = lang === "py" || lang === "sh" ? /(#[^\n]*)|("[^"\n]*"|'[^'\n]*')/g : /(\/\/[^\n]*|\/\*.*?\*\/)|("[^"\n]*"|`[^`\n]*`)/g;
  const out: React.ReactNode[] = [];
  let last = 0, m: RegExpExecArray | null, k = 0;
  while ((m = re.exec(code))) {
    if (m.index > last) out.push(code.slice(last, m.index));
    out.push(<span key={k++} className={m[1] ? "text-[var(--ink-3)]" : "text-[var(--v-allow)]"}>{m[0]}</span>);
    last = m.index + m[0].length;
  }
  out.push(code.slice(last));
  return out;
}

export function Developers() {
  const d = useT().land.dev;
  const [tab, setTab] = useState<keyof typeof CODE>("js");
  const [copied, setCopied] = useState(false);
  const sample = CODE[tab];
  const copy = async () => {
    try { await navigator.clipboard.writeText(sample.code); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* clipboard refused: nothing to say */ }
  };
  return (
    <section aria-labelledby="dev-title" className="tone-dark relative py-24 md:py-36">
      <Wrap className="grid gap-14 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)] lg:gap-16">
        <div>
          <Kicker n="05">{d.kicker}</Kicker>
          <Title id="dev-title" className="max-w-[14ch]">{d.title}</Title>
          <p className="mt-6 max-w-[44ch] text-[17px] leading-[1.55] text-[var(--ink-2)]">{d.body}</p>
          <dl className="mt-10 grid gap-5">
            {d.facts.map((f) => (
              <div key={f.title} className="grid grid-cols-[18px_1fr] gap-3">
                <CheckIcon aria-hidden className="mt-1 size-3.5 text-[var(--v-allow)]" strokeWidth={2.25} />
                <div><dt className="text-[15px] text-[var(--ink)]">{f.title}</dt><dd className="mt-1 text-[14px] leading-[1.5] text-[var(--ink-2)]">{f.body}</dd></div>
              </div>
            ))}
          </dl>
          <div className="mt-10 flex flex-wrap gap-3">
            <ExploreLink href="/docs">{d.docs}</ExploreLink>
            <a href={SITE.github} className="mk-press group inline-flex h-8 items-center gap-1 rounded-full border border-[var(--rule)] pr-2.5 pl-3.5 text-[13px] text-foreground/90 outline-none hover:bg-[var(--rule)] pointer-coarse:h-11">GitHub<ArrowUpRightIcon className="size-3.5 text-muted-foreground" strokeWidth={2} aria-hidden /></a>
          </div>
        </div>

        <div className="min-w-0 self-start overflow-hidden rounded-2xl border border-[var(--rule)] bg-[var(--panel)] shadow-[0_40px_100px_-50px_rgb(0_0_0/0.9)]">
          <div className="flex items-center justify-between gap-2 border-b border-[var(--rule)] px-2 sm:px-3">
            <div role="tablist" aria-label={d.kicker} className="flex min-w-0 overflow-x-auto mk-strip">
              {(Object.keys(CODE) as (keyof typeof CODE)[]).map((k) => (
                <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => { setTab(k); setCopied(false); }}
                  className={cn("relative h-12 shrink-0 px-3 text-[13px] outline-none transition-colors", tab === k ? "text-[var(--ink)]" : "text-[var(--ink-3)] hover:text-[var(--ink-2)]")}>
                  {k === "js" ? "JavaScript" : k === "py" ? "Python" : d.tabs[k]}
                  <span className={cn("absolute inset-x-3 bottom-0 h-px bg-[var(--ink)] transition-opacity", tab === k ? "opacity-100" : "opacity-0")} />
                </button>
              ))}
            </div>
            <button type="button" onClick={copy} className="mk-press inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[12px] text-[var(--ink-2)] outline-none hover:bg-[var(--rule)] hover:text-[var(--ink)] pointer-coarse:h-11">
              {copied ? <CheckIcon className="size-3.5 text-[var(--v-allow)]" strokeWidth={2.25} aria-hidden /> : <CopyIcon className="size-3.5" strokeWidth={1.75} aria-hidden />}
              <span aria-live="polite">{copied ? d.copied : d.copy}</span>
            </button>
          </div>
          <pre role="tabpanel" className="min-h-[300px] overflow-x-auto px-5 py-6 font-mono text-[12.5px] leading-[1.75] text-[var(--ink)] sm:px-6"><code>{highlight(sample.code, sample.lang)}</code></pre>
          <p className="border-t border-[var(--rule)] px-5 py-3 font-mono text-[11px] text-[var(--ink-3)] sm:px-6">{d.source}: <a href={`${SITE.github}/blob/main/${sample.file}`} className="text-[var(--ink-3)] underline-offset-4 hover:text-[var(--ink)] hover:underline">{sample.file}</a></p>
        </div>
      </Wrap>
    </section>
  );
}

// ——— F. Trust: what it does and doesn't do ———

export function Trust() {
  const r = useT().land.trust;
  return (
    <section aria-labelledby="trust-title" className="tone-light relative py-24 md:py-36">
      <Wrap>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end">
          <div>
            <Kicker n="06">{r.kicker}</Kicker>
            <Title id="trust-title" className="max-w-[16ch]">{r.title}</Title>
          </div>
          <p className="max-w-[48ch] text-[16.5px] leading-[1.55] text-[var(--ink-2)]">{r.body}</p>
        </div>
        <div className="mt-16 grid gap-x-12 gap-y-14 md:grid-cols-2">
          {([[r.doesTitle, r.does, true], [r.notTitle, r.not, false]] as const).map(([title, items, ok]) => (
            <Reveal key={title}>
              <h3 className="text-[14px] text-[var(--kick)]">{title}</h3>
              <ul className="mt-5">
                {items.map((x) => (
                  <li key={x} className="grid grid-cols-[22px_1fr] gap-2 border-t border-[var(--rule)] py-4 text-[16px] leading-[1.45] text-[var(--ink)] last:border-b">
                    {ok ? <CheckIcon aria-hidden className="mt-1 size-3.5 text-[var(--v-allow)]" strokeWidth={2.25} /> : <MinusIcon aria-hidden className="mt-1 size-3.5 text-[var(--v-never)]" strokeWidth={2.25} />}
                    <span className={ok ? "" : "text-[var(--ink-2)]"}>{x}</span>
                  </li>
                ))}
              </ul>
            </Reveal>
          ))}
        </div>
        <div className="mt-12 flex flex-wrap gap-3">
          <ExploreLink href="/security">{r.links.limits}</ExploreLink>
          <ExploreLink href="/threat-model">{r.links.threat}</ExploreLink>
          <ExploreLink href="/verification-report">{r.links.report}</ExploreLink>
        </div>
      </Wrap>
    </section>
  );
}

// ——— G. The last word: the painting from the top of the page, as the end of the same story ———

export function Closing({ accounts, demo }: { accounts: boolean; demo: boolean }) {
  const t = useT();
  const c = t.land.closing;
  const create = accounts ? "/account/sign-up" : "/operator";
  return (
    <section aria-labelledby="closing-title" className="relative isolate overflow-hidden bg-black">
      {/* TEND's own painting (public/home/footer.jpg), the dusk valley of the hero seen wide. */}
      <img src="/home/footer.jpg" alt="" loading="lazy" decoding="async" className="absolute inset-0 -z-10 h-full w-full object-cover object-[50%_70%]" />
      <div aria-hidden className="cl-shade absolute inset-0 -z-10" />
      <Wrap className="flex min-h-[86svh] flex-col items-center justify-center py-32 text-center">
        <h2 id="closing-title" className="text-[clamp(2.6rem,6.6vw,6rem)] leading-[0.98] font-normal tracking-[-0.05em] text-white">
          <span className="block">{c.title[0]}</span>
          <span className="block text-white/60">{c.title[1]}</span>
        </h2>
        <p className="mt-7 max-w-[44ch] text-[17px] leading-[1.5] text-white/80">{c.body}</p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          {demo ? <DemoButton note={false} /> : <PrimaryLink href={create} size="lg">{t.front.create}</PrimaryLink>}
          {demo ? <QuietLink href={create} size="lg" className="bg-black/30">{t.front.create}</QuietLink> : <QuietLink href="/docs" size="lg" className="bg-black/30">{t.land.dev.docs}</QuietLink>}
        </div>
        <Link href={SITE.github} className="mt-6 inline-flex items-center gap-1 text-[14px] text-white/70 underline-offset-4 hover:text-[var(--ink)] hover:underline">{c.github}<ArrowUpRightIcon className="size-3.5" strokeWidth={2} aria-hidden /></Link>
      </Wrap>
    </section>
  );
}
