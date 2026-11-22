"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { DemoButton } from "@/ui/demo-button";
import { PrimaryLink, QuietLink } from "../kit";
import { HeroBackdrop } from "../hero-backdrop";
import { boxVars, darkSet, place, type Box, type Crop, type ScreenName } from "./screens";
import { captionAt, clamp, frame, HOLDS, PLANES, SIDE, type Frame } from "./choreography";

/**
 * The top of the homepage: TEND in four steps, followed in a pinned, scroll-driven 3D scene.
 *
 * The hero is the full-bleed gateway backdrop with the headline over it. Scrolling shrinks it into a plane, which opens into a stack
 * of four planes, one real screen of TEND each: Connect (the guided setup), Control (an agent's rules), Approve (a waiting request)
 * and Monitor (Activity). The stack advances one plane per step; only the plane in front is lit, with one ring on the one thing to look
 * at, and each step has one short headline and one line. At the end the stack settles flat on the last screen.
 *
 * On a phone the planes are portrait and each screen is cropped closer, so its text is close to the app's own size instead of a
 * shrunken desktop screenshot.
 *
 * One requestAnimationFrame loop runs only while the eased progress catches up with the scroll position; it writes transforms and a
 * few CSS variables directly, so React never re-renders during scrolling, and it reverses exactly when scrolling up. Under reduced
 * motion nothing is pinned: the hero stands still, the stack is drawn once, and the four steps are listed under it.
 */

// Scene units: a plane is 720×450 on a desktop (16:10, the app's screenshots' shape) and 360×400 on a phone. globals.css draws the
// planes at these sizes with the same breakpoint (.ps-layer).
const DESK = { w: 720, h: 450 }, PHONE = { w: 360, h: 400 };

/**
 * What each plane shows: a real screen of the app (always its dark theme), cropped to the part that matters, on a desktop and on a
 * phone, and the one thing to look at (a box in % of the screenshot, ringed while the step is on). Measured on the screenshots.
 */
const SHOWN: { shot: ScreenName; desk: Crop; phone: Crop; focus: Box; phoneFocus?: Box }[] = [
  { shot: "connect", desk: [18, 2, 54], phone: [19, 3, 26], focus: [20, 20.6, 24, 19.6] },
  { shot: "policies-edit", desk: [2, 30, 70], phone: [2, 31, 46], focus: [12.4, 38.4, 14.6, 5.6] },
  { shot: "approvals-card", desk: [0, 0, 70], phone: [1, 5, 44], focus: [1.8, 49.8, 12.6, 7.4] },
  { shot: "activity", desk: [19, 20, 79], phone: [28.5, 29, 40], focus: [20, 60.2, 76, 8.4], phoneFocus: [28.8, 60.2, 39.4, 8.4] },
];

const rnd = (v: number) => Math.round(v * 1000) / 1000;
type Layout = { vw: number; vh: number; k: number; mobile: boolean; centered: boolean; plane: { w: number; h: number } };

function cameraCss(f: Frame) {
  return `translate3d(${rnd(f.x)}vw, ${rnd(f.y)}vh, ${rnd(f.dolly)}px) rotateX(${rnd(f.rx)}deg) rotateY(${rnd(f.ry)}deg) scale(calc(var(--k) * ${rnd(f.final)}))`;
}

type Els = {
  world: HTMLElement | null; hero: HTMLElement | null; heroText: HTMLElement | null; heroCtas: HTMLElement | null; hint: HTMLElement | null;
  planes: (HTMLElement | null)[]; captions: (HTMLElement | null)[];
};

function draw(e: Els, s: number, f: Frame, L: Layout) {
  const w = e.world;
  if (w) {
    w.style.transform = cameraCss(f);
    f.weights.forEach((v, k) => w.style.setProperty(`--w${k}`, rnd(v).toString()));
  }
  f.planes.forEach((p, i) => {
    const el = e.planes[i];
    if (!el) return;
    el.style.transform = `translate3d(0, ${rnd(p.y)}px, ${rnd(p.z)}px)`;
    el.style.opacity = rnd(p.opacity).toString();
    el.style.setProperty("--dim", rnd(p.dim).toString());
  });
  // The hero picture shrinks into exactly the rectangle the first plane then occupies, and hands over to it.
  if (e.hero) {
    const pw = L.plane.w * L.k, ph = L.plane.h * L.k;
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
    e.heroText.style.pointerEvents = f.heroText < 0.01 ? "none" : "";
  }
  // Only the buttons leave the page when the hero has faded: the headline stays in the accessibility tree (the page's h1).
  if (e.heroCtas) e.heroCtas.style.visibility = f.heroText < 0.01 ? "hidden" : "visible";
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
  // Below 1024px the text goes under the stack (globals.css, .ps-cap), so the stack can use most of the width.
  const vw = innerWidth, vh = innerHeight, mobile = vw < 768, centered = vw < 1024;
  const plane = mobile ? PHONE : DESK;
  const k = mobile ? Math.min((vw * 0.92) / plane.w, (vh * 0.5) / plane.h)
    : centered ? Math.min((vw * 0.8) / plane.w, (vh * 0.52) / plane.h)
    : Math.min((vw * 0.54) / plane.w, (vh * 0.68) / plane.h);
  return { vw, vh, k: clamp(k, 0.3, 1.2), mobile, centered, plane };
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
      world: q('[data-ps="world"]'), hero: q('[data-ps="hero"]'), heroText: q('[data-ps="hero-text"]'), heroCtas: q('[data-ps="hero-ctas"]'), hint: q('[data-ps="hint"]'),
      planes: Array.from({ length: PLANES }, (_, i) => q(`[data-ps-plane="${i}"]`)),
      captions: HOLDS.slice(1).map((_, i) => q(`[data-ps-cap="${i}"]`)),
    };
    const stage = q('[data-ps="stage"]');
    const section = q("[data-ps-section]");
    let L = layout();
    const applyK = () => { L = layout(); stage?.style.setProperty("--k", L.k.toFixed(4)); };
    applyK();

    if (reduced) {
      const s = 0.65;
      const render = () => { applyK(); draw(e, s, frame(s, L.mobile, L.centered), L); };
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
      const a = 1 - Math.exp(-dt / 140);
      current = current < 0 ? target : current + (target - current) * a;
      if (Math.abs(target - current) < 0.0001) current = target;
      draw(e, current, frame(current, L.mobile, L.centered), L);
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

  const f0 = frame(reduced ? 0.65 : 0, false);
  const hero = (still: boolean) => (
    <div className={cn("absolute inset-0", still && "relative h-[88svh] min-h-[560px]")}>
      <div data-ps={still ? undefined : "hero"} className="ps-hero absolute inset-0">
        {/* The gateway backdrop (hero-backdrop.tsx), which the engine shrinks into the first plane. */}
        <HeroBackdrop className="" />
      </div>
      <div data-ps={still ? undefined : "hero-text"} className="absolute inset-0 z-10 flex items-center justify-center px-5">
        <HeroCopy demo={demo} create={create} animated={!still} />
      </div>
    </div>
  );

  const scene = (
    <div aria-hidden data-ps="stage" className="ps-stage absolute inset-0">
      <div data-ps="world" className="ps-world" style={{ transform: cameraCss(f0), ...Object.fromEntries(f0.weights.map((v, k) => [`--w${k}`, rnd(v)])) }}>
        {/* Back to front, so the browser's painting order matches depth even before it sorts the 3D planes. */}
        {[3, 2, 1, 0].map((i) => (
          <div key={i} data-ps-plane={i} className="ps-layer ps-layer-image"
            style={{ transform: `translate3d(0, ${rnd(f0.planes[i].y)}px, ${rnd(f0.planes[i].z)}px)`, opacity: rnd(f0.planes[i].opacity), ["--dim" as string]: rnd(f0.planes[i].dim) }}>
            <Plane i={i} />
          </div>
        ))}
      </div>
    </div>
  );

  if (reduced) {
    return (
      <div ref={root}>
        <section aria-labelledby="hero-title" className="relative isolate overflow-hidden bg-[#181818]">{hero(true)}</section>
        <section aria-label={P.label} className="bg-[#181818]">
          <div className="relative h-[80svh] min-h-[520px] overflow-hidden">{scene}</div>
          <div className="mx-auto w-full max-w-[1200px] px-5 pb-24 sm:px-8">
            <h2 className="sr-only">{P.label}</h2>
            <ol className="grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
              {P.stages.map((st, k) => (
                <li key={st.title}>
                  <p className="font-mono text-[12px] text-white/65">0{k + 1}</p>
                  <h3 className="mt-2 text-[18px] tracking-[-0.01em] text-white">{st.title}</h3>
                  <p className="mt-1.5 text-[15px] leading-[1.5] text-white/70">{st.body}</p>
                </li>
              ))}
            </ol>
            <p className="mt-12 text-[13px] text-white/60">{P.screensNote}</p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div ref={root}>
      <section data-ps-section aria-labelledby="hero-title" className="relative h-[800vh] bg-[#181818] max-md:h-[700vh]">
        <div className="sticky top-0 h-svh overflow-hidden">
          {scene}
          {hero(false)}
          <div aria-hidden data-ps="hint" className="pointer-events-none absolute right-6 bottom-6 z-10 flex items-center gap-2 text-[12px] text-white/70 max-md:right-auto max-md:left-1/2 max-md:-translate-x-1/2">
            {t.land.hero.scroll}<span className="ps-hint-box">↓</span>
          </div>
          {P.stages.map((st, i) => (
            <div key={st.title} aria-hidden data-ps-cap={i} className={cn("ps-cap absolute z-10", `ps-cap-${SIDE[i + 1]}`)} style={{ opacity: 0, visibility: "hidden" }}>
              <p className="flex items-center gap-3 font-mono text-[12px] text-white/65">
                <span aria-hidden className="ps-rail">{P.stages.map((_, j) => <span key={j} data-on={j === i || undefined} />)}</span>
                {P.step(i + 1, P.stages.length)}
              </p>
              <p className="mt-2 text-[clamp(1.6rem,2.6vw,2.5rem)] leading-[1.06] font-normal tracking-[-0.03em] text-white">{st.title}</p>
              <p className="mt-3 text-[15.5px] leading-[1.45] text-white/70">{st.body}</p>
            </div>
          ))}
        </div>
        {/* The captions above appear and disappear with scrolling and are hidden from assistive technology; this is the same story,
            in order, for screen readers. */}
        <div className="sr-only">
          <h2>{P.label}</h2>
          <ol>{P.stages.map((st) => <li key={st.title}><h3>{st.title}</h3><p>{st.body}</p></li>)}</ol>
        </div>
      </section>
    </div>
  );
}

function HeroCopy({ demo, create, animated }: { demo: boolean; create: string; animated: boolean }) {
  const t = useT();
  const f = t.front;
  return (
    <div className="flex flex-col items-center text-center">
      <h1 id="hero-title" className="mk-display max-w-[16ch] text-[clamp(2.6rem,6.4vw,5.25rem)]">{f.title}</h1>
      <p className="mt-5 max-w-[44ch] text-[17px] leading-[1.45] text-foreground/80 md:text-[19px]">{f.body}</p>
      <div data-ps={animated ? "hero-ctas" : undefined} className="flex w-full flex-col items-center">
        <div className="mt-8 grid w-full max-w-[360px] gap-2.5 sm:flex sm:w-auto sm:max-w-none sm:justify-center">
          {demo ? <DemoButton note={false} /> : <PrimaryLink href={create} size="lg">{f.create}</PrimaryLink>}
          {demo ? <QuietLink href={create} size="lg" className="bg-[#181818]/40 backdrop-blur-sm">{f.create}</QuietLink> : <QuietLink href="/how-it-works" size="lg" className="bg-[#181818]/40 backdrop-blur-sm">{f.hero.howItWorks}</QuietLink>}
        </div>
        {demo && <p className="mt-3 text-[13px] text-foreground/60">{f.liveDemoNote}</p>}
      </div>
    </div>
  );
}

/** One plane: a real screen of the app, cropped; the first plane also carries the hero's backdrop, which it hands over from. */
function Plane({ i }: { i: number }) {
  const P = useT().land.passage;
  const alt = [P.alts.connect, P.alts.rules, P.alts.approvals, P.alts.activity][i];
  const sh = SHOWN[i];
  const set = darkSet(sh.shot);
  const d = place(sh.shot, sh.desk, DESK.w / DESK.h, sh.focus), m = place(sh.shot, sh.phone, PHONE.w / PHONE.h, sh.phoneFocus ?? sh.focus);
  const style = { ...boxVars("", d.img), ...boxVars("m", m.img), ...boxVars("r", d.box), ...boxVars("mr", m.box) } as React.CSSProperties;
  const sizes = "(max-width: 767px) 360vw, 95vw";
  return (
    <div className="absolute inset-0" style={style}>
      {i === 0 && (
        <div className="ps-img bg-[#181818]" style={{ opacity: "var(--w0)" }}>
          <HeroBackdrop className="" />
        </div>
      )}
      <div className="ps-img bg-[#181818]" style={i === 0 ? { opacity: "calc(1 - var(--w0))" } : undefined}>
        <picture className="contents">
          <source type="image/avif" srcSet={set.avif} sizes={sizes} />
          <img src={set.src} srcSet={set.webp} sizes={sizes} alt={alt} loading={i > 1 ? "lazy" : "eager"} decoding="async" className="ps-shot" />
        </picture>
      </div>
      {/* The one thing to look at, ringed while this plane's step is on. */}
      <span aria-hidden className="ps-ring" style={{ opacity: `var(--w${i + 1})`, ["--wr" as string]: `var(--w${i + 1})` }} />
      {/* Darkness, not transparency: a plane that is not in front goes dark, so two screens never show through each other. */}
      <span aria-hidden className="ps-dim" />
    </div>
  );
}
