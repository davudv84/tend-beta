"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { DemoButton } from "@/ui/demo-button";
import { ExploreLink, PrimaryLink, QuietLink } from "../kit";
import SCREENS from "../screens.json";
import { captionAt, clamp, frame, HOLDS, IMAGE_LAYER, LAYERS, SIDE, type Frame } from "./choreography";

/**
 * The top of the homepage: one request, followed through TEND in a pinned, scroll-driven 3D scene.
 *
 * The hero is a full-bleed picture. Scrolling shrinks it into a plane, which tilts into a stack of five same-size layers with wide gaps:
 * one carries a real screen of TEND, the others are line drawings of it (a tracing of its structure, the request's tag and the part
 * TEND looks at, the fields it reads with wires to them, and the step of the pipeline at the back). The camera swings the stack from
 * side to side, one step per swing (request → key → rule → decision → record); between steps the layers close up and the screen
 * changes. At the end the layers fold flat into TEND's real Overview.
 *
 * One requestAnimationFrame loop runs only while the eased progress catches up with the scroll position; it writes transforms and a
 * few CSS variables directly, so React never re-renders during scrolling, and it reverses exactly when scrolling up. Under reduced
 * motion nothing is pinned: the hero stands still, the stack is drawn once at the decision, and the steps are listed under it.
 */

// Scene units: a layer is 720×450 (16:10, the app's screenshots' shape).
const W = 720, H = 450;
/** The hero painting (public/home/hero.jpg) in three widths, made from it with Pillow. */
const HERO_SET = "/home/hero-960.webp 960w, /home/hero-1600.webp 1600w, /home/hero-2400.webp 2400w";
const REQ = { tool: "send_email", action: "send", resource: "team-mailing-list" };

type R = readonly [x: number, y: number, w: number, h: number]; // in % of a layer
/** What each step draws over its screen: the screen's blocks (traced), the part TEND looks at, and the fields it reads there. */
const STEPS: { shot: keyof typeof SCREENS | null; pos?: string; blocks: R[]; focus: R }[] = [
  { shot: null, blocks: [], focus: [0, 0, 0, 0] },
  { shot: "overview", blocks: [[0, 0, 16, 100], [20, 5, 22, 6], [20, 21, 76, 12], [20, 43, 38, 56], [60, 43, 36, 56]], focus: [20.5, 44, 37, 54] },
  { shot: "agents", blocks: [[0, 0, 16, 100], [20, 5, 14, 6], [83, 5, 13, 5], [20, 17, 76, 36]], focus: [20.5, 26.6, 75, 8.6] },
  { shot: "policies-edit", pos: "50% 0%", blocks: [[3, 4, 62, 12], [86, 4, 11, 7], [3, 40, 94, 20], [3, 68, 94, 20]], focus: [12.6, 48.5, 13.4, 6.4] },
  { shot: "approvals-card", blocks: [[2.5, 4, 60, 12], [2.5, 22, 95, 9], [2.5, 34, 62, 8], [2.5, 48, 26, 9], [2.5, 66, 95, 30]], focus: [2.5, 22.5, 95, 8.5] },
  { shot: null, blocks: [[6, 14, 88, 70]], focus: [6, 40, 88, 13] },
  { shot: "overview", blocks: [], focus: [0, 0, 0, 0] },
];

const rnd = (v: number) => Math.round(v * 1000) / 1000;
type Layout = { vw: number; vh: number; k: number; mobile: boolean };

function cameraCss(f: Frame) {
  return `translate3d(${rnd(f.x)}vw, ${rnd(f.y)}vh, ${rnd(f.dolly)}px) rotateX(${rnd(f.rx)}deg) rotateY(${rnd(f.ry)}deg) rotateZ(${rnd(f.rz)}deg) scale(calc(var(--k) * ${rnd(f.final)}))`;
}

type Els = {
  world: HTMLElement | null; hero: HTMLElement | null; heroText: HTMLElement | null; hint: HTMLElement | null;
  layers: (HTMLElement | null)[]; captions: (HTMLElement | null)[];
};

function draw(e: Els, s: number, f: Frame, L: Layout) {
  const w = e.world;
  if (w) {
    w.style.transform = cameraCss(f);
    f.weights.forEach((v, k) => w.style.setProperty(`--w${k}`, rnd(v).toString()));
  }
  f.layers.forEach((l, i) => {
    const el = e.layers[i];
    if (!el) return;
    el.style.transform = `translate3d(0, 0, ${rnd(l.z)}px)`;
    el.style.opacity = rnd(l.opacity).toString();
  });
  // The hero picture shrinks into exactly the rectangle the image layer then occupies, and hands over to it.
  if (e.hero) {
    const pw = W * L.k, ph = H * L.k;
    const target = Math.max(pw / L.vw, ph / L.vh);
    const sc = 1 + (target - 1) * f.shrink;
    const ix = ((L.vw - pw / target) / 2) * f.shrink, iy = ((L.vh - ph / target) / 2) * f.shrink;
    const radius = (14 * L.k / sc) * f.shrink;
    e.hero.style.transform = `scale(${rnd(sc)})`;
    e.hero.style.clipPath = `inset(${rnd(iy)}px ${rnd(ix)}px round ${rnd(radius)}px)`;
    e.hero.style.opacity = rnd(1 - f.heroOut).toString();
    e.hero.style.visibility = f.heroOut > 0.99 ? "hidden" : "visible";
  }
  if (e.heroText) {
    e.heroText.style.opacity = rnd(f.heroText).toString();
    e.heroText.style.transform = `translate3d(0, ${rnd(-30 * (1 - f.heroText))}px, 0)`;
    e.heroText.style.visibility = f.heroText < 0.01 ? "hidden" : "visible";
  }
  if (e.hint) e.hint.style.opacity = rnd(1 - clamp(s / 0.02)).toString();
  e.captions.forEach((el, i) => {
    if (!el) return;
    const c = captionAt(s, i + 1);
    el.style.opacity = rnd(c.op).toString();
    el.style.transform = `translate3d(0, ${rnd(c.y)}px, 0)`;
    el.style.visibility = c.op < 0.01 ? "hidden" : "visible";
  });
}

function layout(): Layout {
  const vw = innerWidth, vh = innerHeight, mobile = vw < 768;
  const k = mobile ? Math.min((vw * 0.94) / W, (vh * 0.42) / H) : Math.min((vw * 0.45) / W, (vh * 0.62) / H);
  return { vw, vh, k: clamp(k, 0.3, 1.2), mobile };
}

export function Passage({ accounts, demo }: { accounts: boolean; demo: boolean }) {
  const t = useT();
  const P = t.land.passage;
  const create = accounts ? "/account/sign-up" : "/operator";
  const root = useRef<HTMLDivElement>(null);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const host = root.current;
    if (!host) return;
    const q = (sel: string) => host.querySelector<HTMLElement>(sel);
    const e: Els = {
      world: q('[data-ps="world"]'), hero: q('[data-ps="hero"]'), heroText: q('[data-ps="hero-text"]'), hint: q('[data-ps="hint"]'),
      layers: Array.from({ length: LAYERS }, (_, i) => q(`[data-ps-layer="${i}"]`)),
      captions: HOLDS.slice(1).map((_, i) => q(`[data-ps-cap="${i}"]`)),
    };
    const stage = q('[data-ps="stage"]');
    const section = q("[data-ps-section]");
    let L = layout();
    const applyK = () => { L = layout(); stage?.style.setProperty("--k", L.k.toFixed(4)); };
    applyK();

    if (reduced) {
      const s = 0.63;
      const render = () => { applyK(); draw(e, s, frame(s, L.mobile), L); };
      render();
      addEventListener("resize", render);
      return () => removeEventListener("resize", render);
    }

    let target = 0, current = -1, raf = 0, last = 0;
    const progress = () => {
      if (!section) return 0;
      const span = section.offsetHeight - innerHeight;
      return span > 0 ? clamp(-section.getBoundingClientRect().top / span) : 0;
    };
    const tick = (now: number) => {
      const dt = last ? Math.min(64, now - last) : 16;
      last = now;
      const a = 1 - Math.exp(-dt / 110);
      current = current < 0 ? target : current + (target - current) * a;
      if (Math.abs(target - current) < 0.0001) current = target;
      draw(e, current, frame(current, L.mobile), L);
      raf = current === target ? 0 : requestAnimationFrame(tick);
    };
    const wake = () => { if (!raf) { last = 0; raf = requestAnimationFrame(tick); } };
    const onScroll = () => { target = progress(); wake(); };
    const onResize = () => { applyK(); current = -1; onScroll(); };
    target = progress();
    wake();
    addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("scroll", onScroll);
      removeEventListener("resize", onResize);
    };
  }, [reduced]);

  const f0 = frame(reduced ? 0.63 : 0, false);
  const hero = (still: boolean) => (
    <div className={cn("absolute inset-0", still && "relative h-[88svh] min-h-[560px]")}>
      <div data-ps={still ? undefined : "hero"} className="ps-hero absolute inset-0">
        {/* TEND's own painting (public/home/hero.jpg), already the site's hero picture. */}
        <img src="/home/hero-1600.webp" srcSet={HERO_SET} sizes="100vw" alt={P.heroAlt} className="absolute inset-0 h-full w-full object-cover" fetchPriority="high" decoding="async" />
        <div className="ps-hero-shade absolute inset-0" />
      </div>
      <div data-ps={still ? undefined : "hero-text"} className="absolute inset-0 z-10 flex items-center justify-center px-5">
        <HeroCopy demo={demo} create={create} />
      </div>
    </div>
  );

  const scene = (
    <div aria-hidden data-ps="stage" className="ps-stage absolute inset-0">
      <div data-ps="world" className="ps-world" style={{ transform: cameraCss(f0), ...Object.fromEntries(f0.weights.map((v, k) => [`--w${k}`, rnd(v)])) }}>
        {/* Back to front, so the browser's painting order matches depth even before it sorts the 3D layers. */}
        {[4, 2, 1, 0, 3].map((i) => (
          <div key={i} data-ps-layer={i} className={cn("ps-layer", i === IMAGE_LAYER && "ps-layer-image")}
            style={{ width: W, height: H, left: -W / 2, top: -H / 2, transform: `translate3d(0, 0, ${rnd(f0.layers[i].z)}px)`, opacity: rnd(f0.layers[i].opacity) }}>
            {i === 0 && <FocusLayer />}
            {i === 1 && <ImageLayer />}
            {i === 2 && <TraceLayer />}
            {i === 3 && <FieldsLayer />}
            {i === 4 && <PipelineLayer />}
          </div>
        ))}
      </div>
    </div>
  );

  if (reduced) {
    return (
      <div ref={root}>
        <section aria-labelledby="hero-title" className="relative isolate overflow-hidden bg-black">{hero(true)}</section>
        <section aria-label={P.label} className="bg-black">
          <div className="relative h-[80svh] min-h-[520px] overflow-hidden">{scene}</div>
          <div className="mx-auto w-full max-w-[1200px] px-5 pb-24 sm:px-8">
            <ol className="grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
              {P.stages.map((st, k) => (
                <li key={st.title}>
                  <p className="font-mono text-[12px] text-white/50">0{k + 1}</p>
                  <h3 className="mt-2 text-[18px] tracking-[-0.01em] text-white">{st.title}</h3>
                  <p className="mt-1.5 text-[15px] leading-[1.5] text-white/60">{st.body}</p>
                </li>
              ))}
            </ol>
            <p className="mt-12 text-[13px] text-white/45">{P.conceptual}</p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div ref={root}>
      <section data-ps-section aria-labelledby="hero-title" className="relative h-[900vh] bg-black max-md:h-[760vh]">
        <div className="sticky top-0 h-svh overflow-hidden">
          {scene}
          {hero(false)}
          <div data-ps="hint" className="pointer-events-none absolute right-6 bottom-6 z-10 flex items-center gap-2 text-[12px] text-white/70 max-md:right-auto max-md:left-1/2 max-md:-translate-x-1/2">
            {t.land.hero.scroll}<span className="ps-hint-box">↓</span>
          </div>
          {P.stages.map((st, i) => {
            const side = SIDE[i + 1];
            return (
              <div key={st.title} data-ps-cap={i} className={cn("ps-cap absolute z-10", `ps-cap-${side}`)} style={{ opacity: 0, visibility: "hidden" }}>
                <p className="flex items-center gap-2 font-mono text-[11.5px] text-white/50"><span className="ps-kick" />0{i + 1} · {i < 5 ? P.planes[(["agent", "boundary", "policy", "decision", "audit"] as const)[i]] : "TEND"}</p>
                <h2 className="mt-3 text-[clamp(1.5rem,2.3vw,2.25rem)] leading-[1.08] font-normal tracking-[-0.03em] text-white">{st.title}</h2>
                <p className="mt-3 text-[14.5px] leading-[1.5] text-white/60">{st.body}</p>
                {i === HOLDS.length - 2 && <ExploreLink href="/product/approvals" className="mt-5">{P.explore}</ExploreLink>}
              </div>
            );
          })}
          <p className="pointer-events-none absolute bottom-5 left-6 z-10 max-w-[44ch] text-[11px] leading-[1.4] text-white/35 max-md:hidden">{P.conceptual}</p>
        </div>
      </section>
    </div>
  );
}

function HeroCopy({ demo, create }: { demo: boolean; create: string }) {
  const t = useT();
  const h = t.land.hero;
  return (
    <div className="flex max-w-[980px] flex-col items-center pt-10 text-center">
      <p className="ps-rise font-mono text-[12px] text-white/70" style={{ animationDelay: "60ms" }}>{h.eyebrow}</p>
      <h1 id="hero-title" className="mt-6 text-[clamp(2.9rem,7vw,6.6rem)] leading-[0.95] font-normal tracking-[-0.05em] text-white">
        <span className="ps-rise block" style={{ animationDelay: "120ms" }}>{h.title[0]}</span>
        <span className="ps-rise block text-white/60" style={{ animationDelay: "220ms" }}>{h.title[1]}</span>
      </h1>
      <p className="ps-rise mt-7 max-w-[50ch] text-[16.5px] leading-[1.5] text-white/80 md:text-[18px]" style={{ animationDelay: "320ms" }}>{h.body}</p>
      <div className="ps-rise mt-9 flex flex-wrap items-start justify-center gap-3" style={{ animationDelay: "400ms" }}>
        {demo ? <DemoButton note={false} /> : <PrimaryLink href={create} size="lg">{t.front.create}</PrimaryLink>}
        {demo ? <QuietLink href={create} size="lg" className="bg-black/30">{t.front.create}</QuietLink> : <QuietLink href="/how-it-works" size="lg" className="bg-black/30">{h.how}</QuietLink>}
      </div>
    </div>
  );
}

// ——— The layers ———

const pct = (r: R) => ({ x: (r[0] / 100) * W, y: (r[1] / 100) * H, w: (r[2] / 100) * W, h: (r[3] / 100) * H });
/** A group shown only while its step is on screen (the engine sets --w0…--w6 on the world). */
const Step = ({ k, children }: { k: number; children: React.ReactNode }) => <g style={{ opacity: `var(--w${k})` }}>{children}</g>;

function darkSet(name: keyof typeof SCREENS) {
  const s = SCREENS[name];
  return {
    avif: s.widths.map((w) => `/screens/${name}-dark-${w}.avif ${w}w`).join(", "),
    webp: s.widths.map((w) => `/screens/${name}-dark-${w}.webp ${w}w`).join(", "),
    src: `/screens/${name}-dark-${s.widths[Math.min(3, s.widths.length - 1)]}.webp`,
  };
}

/** The picture layer: the hero's painting, then one real screen of TEND per step (always the app's dark theme). */
function ImageLayer() {
  const P = useT().land.passage;
  const alt: Record<number, string> = { 1: P.alts.overview, 2: P.alts.agents, 3: P.alts.rules, 4: P.alts.approvals, 6: P.alts.overview };
  return (
    <>
      <div className="ps-img" style={{ opacity: "var(--w0)" }}>
        <img src="/home/hero-960.webp" srcSet={HERO_SET} sizes="60vw" alt="" className="h-full w-full object-cover" decoding="async" />
      </div>
      {STEPS.map((st, k) => {
        if (!st.shot) return null;
        const set = darkSet(st.shot);
        return (
          <div key={k} className="ps-img" style={{ opacity: `var(--w${k})` }}>
            <picture className="contents">
              <source type="image/avif" srcSet={set.avif} sizes="(max-width: 768px) 90vw, 60vw" />
              <img src={set.src} srcSet={set.webp} sizes="(max-width: 768px) 90vw, 60vw" alt={alt[k]} loading={k > 1 ? "lazy" : "eager"} decoding="async" className="h-full w-full object-cover" style={{ objectPosition: st.pos ?? "50% 0%" }} />
            </picture>
          </div>
        );
      })}
      <div className="ps-img ps-audit" style={{ opacity: "var(--w5)" }}><AuditSheet /></div>
    </>
  );
}

/** In front of the screen: the part TEND looks at, outlined, and the request's tag, which stays the same from step to step. */
function FocusLayer() {
  const P = useT().land.passage;
  const states = ["", P.requested, P.keyOk, `${P.ruleMatch} → approve`, P.allowedOnce, `#4123 ${P.recorded}`];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="ps-svg">
      <rect x={0.5} y={0.5} width={W - 1} height={H - 1} rx={14} className="ps-frame" />
      {STEPS.map((st, k) => {
        if (k === 0 || k === 6) return null;
        const f = pct(st.focus);
        const label = `${REQ.tool} · ${REQ.action} — ${states[k]}`;
        const tw = 34 + label.length * 7.1;
        const tagX = f.x + f.w - 4, tagY = Math.max(22, f.y - 34);
        return (
          <Step key={k} k={k}>
            <rect x={f.x - 4} y={f.y - 4} width={f.w + 8} height={f.h + 8} rx={8} className="ps-focus" />
            {[[f.x - 4, f.y - 4], [f.x + f.w + 4, f.y - 4], [f.x - 4, f.y + f.h + 4], [f.x + f.w + 4, f.y + f.h + 4]].map(([x, y], j) => <circle key={j} cx={x} cy={y} r={3} className="ps-node" />)}
            <path d={`M ${f.x + f.w + 4} ${f.y - 4} L ${tagX + 10} ${tagY + 12}`} className="ps-wire" />
            <g transform={`translate(${Math.min(tagX - 40, W - tw - 10)} ${tagY})`}>
              <rect width={tw} height={24} rx={12} className="ps-tag" />
              <circle cx={13} cy={12} r={3.5} className="ps-tag-dot" />
              <text x={24} y={16} className="ps-tag-text">{label}</text>
            </g>
          </Step>
        );
      })}
    </svg>
  );
}

/** Behind the screen: a tracing of its structure, with the dot rows and the ruler of a technical drawing. */
function TraceLayer() {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="ps-svg">
      <rect x={0.5} y={0.5} width={W - 1} height={H - 1} rx={14} className="ps-frame" />
      {Array.from({ length: 26 }, (_, i) => <circle key={i} cx={34 + i * 25.5} cy={16} r={i % 5 === 0 ? 3.4 : 2.2} className="ps-dot" />)}
      {Array.from({ length: 15 }, (_, i) => <line key={i} x1={10} x2={i % 5 === 0 ? 24 : 17} y1={40 + i * 26} y2={40 + i * 26} className="ps-tick" />)}
      {STEPS.map((st, k) => (
        <Step key={k} k={k}>
          {st.blocks.map((b, j) => { const r = pct(b); return <rect key={j} x={r.x} y={r.y} width={r.w} height={r.h} rx={6} className="ps-trace" />; })}
          {k === 5 && Array.from({ length: 4 }, (_, j) => <line key={j} x1={W * 0.1} x2={W * 0.9} y1={H * (0.3 + j * 0.13)} y2={H * (0.3 + j * 0.13)} className="ps-trace" />)}
        </Step>
      ))}
    </svg>
  );
}

/** Further back: the fields TEND reads at this step, wired to the part it looks at. */
function FieldsLayer() {
  const P = useT().land.passage;
  const F = P.fields;
  const rows: [string, string][][] = [
    [],
    [[F.agent, P.agentName], [F.tool, REQ.tool], [F.action, REQ.action], [F.resource, REQ.resource]],
    [["key", "tend_sk_••••3f9a"], [F.agent, P.agentName], [P.keyOk, "✓"], [P.unknownKey.split("→")[0].trim(), `→ ${P.refused}`]],
    [[`${REQ.tool} · ${REQ.action}`, "approve"], ["read_docs · read", "allow"], ["delete_record · delete", "deny"], [P.noRule, P.refused]],
    [[P.outcomes.ask, "approve"], [P.waiting, "→"], [P.allowedOnce, "1×"], [F.resource, REQ.resource]],
    [["#4121", "authorization.requested"], ["#4122", "review.decided"], ["#4123", "authorization.consumed"], ["#4124", "tool.called"]],
  ];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="ps-svg">
      <rect x={0.5} y={0.5} width={W - 1} height={H - 1} rx={14} className="ps-frame" />
      {rows.map((rs, k) => {
        if (!rs.length) return null;
        const f = pct(STEPS[k].focus);
        const fx = f.x + f.w * 0.5, fy = f.y + f.h * 0.5;
        const left = W * 0.7;
        return (
          <Step key={k} k={k}>
            <circle cx={fx} cy={fy} r={4} className="ps-node" />
            {rs.map(([a, b], j) => {
              const y = 70 + j * 92;
              return (
                <g key={j}>
                  <path d={`M ${fx} ${fy} C ${(fx + left) / 2} ${fy}, ${(fx + left) / 2} ${y}, ${left - 8} ${y}`} className="ps-wire" />
                  <circle cx={left - 8} cy={y} r={2.6} className="ps-node" />
                  <text x={left + 4} y={y - 6} className="ps-label">{a}</text>
                  <text x={left + 4} y={y + 13} className="ps-value">{b}</text>
                  <line x1={left + 4} x2={W - 26} y1={y + 22} y2={y + 22} className="ps-tick" strokeDasharray="2 4" />
                </g>
              );
            })}
          </Step>
        );
      })}
    </svg>
  );
}

/** At the back: corner marks, and the five steps of the path with the current one lit. */
function PipelineLayer() {
  const P = useT().land.passage;
  const names = [P.planes.agent, P.planes.boundary, P.planes.policy, P.planes.decision, P.planes.audit];
  const c = 26;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="ps-svg">
      {[[0, 0, 1, 1], [W, 0, -1, 1], [0, H, 1, -1], [W, H, -1, -1]].map(([x, y, dx, dy], i) => (
        <path key={i} d={`M ${x + dx * 1} ${y + dy * c} L ${x + dx * 1} ${y + dy * 1} L ${x + dx * c} ${y + dy * 1}`} className="ps-frame" />
      ))}
      <line x1={40} x2={40} y1={70} y2={H - 70} className="ps-tick" />
      {names.map((n, i) => {
        const y = 70 + i * ((H - 140) / 4);
        return (
          <g key={n} style={{ opacity: `calc(0.3 + 0.7 * var(--w${i + 1}))` }}>
            <circle cx={40} cy={y} r={5} className="ps-node-ring" />
            <text x={56} y={y + 4} className="ps-label">{`0${i + 1}`}  {n}</text>
          </g>
        );
      })}
      <text x={W - 28} y={H - 22} textAnchor="end" className="ps-label">TEND</text>
    </svg>
  );
}

/** Step 5's screen: the audit log, drawn (it is the record of this request; ids and hashes are illustrative). */
function AuditSheet() {
  const P = useT().land.passage;
  const rows: [string, string, string, string][] = [
    ["4121", "authorization.requested", `${REQ.tool} · ${REQ.action}`, "9f2c…e1"],
    ["4122", "review.decided", P.allowedOnce, "1ab0…7d"],
    ["4123", "authorization.consumed", REQ.resource, "c47e…02"],
    ["4124", "tool.called", "success", "5d91…ac"],
  ];
  return (
    <div className="flex h-full flex-col justify-center px-[6%] font-mono text-[13px] text-white/85">
      <p className="mb-4 text-[11.5px] text-white/50">{P.planes.audit} · {P.chained}</p>
      {rows.map(([seq, type, what, hash], i) => (
        <div key={seq} className={cn("grid grid-cols-[64px_1.3fr_1fr_auto] items-center gap-3 border-t border-white/15 py-[13px]", i === 2 && "bg-white/[0.06]")}>
          <span className="text-white/45">#{seq}</span><span>{type}</span><span className="truncate text-white/55">{what}</span><span className="text-white/40">{hash}</span>
        </div>
      ))}
      <p className="mt-4 text-[11.5px] text-white/45">{P.verify} npm run tend -- audit-verify</p>
    </div>
  );
}
