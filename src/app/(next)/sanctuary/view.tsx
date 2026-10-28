"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CircleHelpIcon } from "lucide-react";
import { AgentCallout, describe } from "@/components/agent-callout";
import { KIND_TONE, sentence } from "@/components/feed";
import { Intro } from "@/components/intro";
import { Welcome } from "@/components/welcome";
import { Dot } from "@/components/kit";
import { PlacePanel } from "@/components/place-panels";
import { BottomSheet, useViewportHeight } from "@/components/sheet";
import { useT } from "@/i18n/client";
import { timeline } from "@/lib/derive";
import { clock, eventHref, useNow } from "@/lib/format";
import { reflectionNumber } from "@/lib/reflections";
import { useStore, type LightPref } from "@/lib/store";
import { cn } from "@/lib/utils";
import { AgentFigure } from "@/sanctuary/figure";
import { kindOf, occupants, placeName } from "@/sanctuary/occupancy";
import { Sanctuary, useLightMode, type Anchor, type Place, type Places } from "@/sanctuary/sanctuary";

const LIGHTS: LightPref[] = ["auto", "dawn", "day", "dusk", "night"];

const BUILDINGS = ["study", "lounge", "spa"] as const;
const EASE = [0.2, 0, 0, 1] as const;
const PEEK = 92;
const SNAPS = [PEEK, 0.52, 0.9];

const parsePlace = (v: string | null): Place =>
  v === "study" || v === "lounge" || v === "spa" ? v : v?.startsWith("room:") && v.length > 5 ? (v as Place) : "garden";

/** Places live in the URL, so the browser's back button leaves a building and links can point inside one. */
function go(place: Place) {
  const url = new URL(location.href);
  if (place === "garden") url.searchParams.delete("place");
  else url.searchParams.set("place", place);
  url.searchParams.delete("agent");
  url.searchParams.delete("inspect");
  history.pushState(null, "", url);
}

/** Once a linked record is closed or replaced, drop it from the URL so the same link opens it again. */
function dropLinked() {
  const url = new URL(location.href);
  if (!url.searchParams.has("inspect")) return;
  url.searchParams.delete("inspect");
  history.replaceState(null, "", url);
}

const desktopQuery = "(min-width: 1024px)";
function useDesktop() {
  return useSyncExternalStore(
    (cb) => {
      const m = matchMedia(desktopQuery);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => matchMedia(desktopQuery).matches,
    () => true,
  );
}

/** Space the mobile dock occupies above the bottom edge, including the home indicator. Measured once. */
let dockPx = 0;
const readDock = () => {
  if (!dockPx) {
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;bottom:0;height:0;padding-bottom:env(safe-area-inset-bottom);visibility:hidden";
    document.body.appendChild(probe);
    dockPx = Math.max(12, probe.offsetHeight) + 58;
    probe.remove();
  }
  return dockPx;
};
const useDockSpace = () => useSyncExternalStore(() => () => {}, readDock, () => 70);

export default function View() {
  const t = useT();
  const params = useSearchParams();
  const place = parsePlace(params.get("place"));
  const kind = kindOf(place);
  const agents = useStore((s) => s.agents);
  const checkIns = useStore((s) => s.checkIns);
  const requests = useStore((s) => s.requests);
  const log = useStore((s) => s.log);
  const taskEvents = useStore((s) => s.taskEvents);
  const tasks = useStore((s) => s.tasks);
  const skew = useStore((s) => s.skew);
  const prefs = useStore((s) => s.prefs);
  const setPrefs = useStore((s) => s.setPrefs);
  const status = useStore((s) => s.status);
  const viewer = useStore((s) => s.viewer);
  const mode = useLightMode();
  const now = useNow();
  const desktop = useDesktop();
  const dock = useDockSpace();
  const vh = useViewportHeight();
  const [selected, setSelected] = useState<string | null>(() => params.get("agent"));
  const [inspected, setInspected] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [places, setPlaces] = useState<Places>({});
  const [snap, setSnap] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const [zoomKey, setZoomKey] = useState(0);
  const aside = useRef<HTMLElement>(null);

  // A new place starts with nothing selected or open.
  const [shown, setShown] = useState(place);
  if (shown !== place) {
    setShown(place);
    setInspected(null);
    setSelected(null);
  }
  // A link can open one record directly (?inspect=event:…), e.g. the tool call behind an alert.
  const linked = params.get("inspect");
  const [opened, setOpened] = useState<string | null>(null);
  if (linked !== opened) {
    setOpened(linked);
    if (linked) setInspected(linked);
  }

  // On a phone, choosing something in the world raises the sheet so its details are visible.
  const select = (id: string | null) => {
    setSelected(id);
    if (id && !desktop) setSnap((s) => Math.max(s, 1));
  };
  const inspect = (id: string | null) => {
    setInspected(id);
    dropLinked();
    if (id && !desktop) setSnap((s) => Math.max(s, 1));
  };

  useEffect(() => {
    aside.current?.scrollTo(0, 0);
  }, [place]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // An open dialog handles Esc itself. Closed sheets stay mounted but hidden, so they don't count.
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector("[role=dialog][aria-modal=true]:not([aria-hidden=true]), [role=alertdialog]")) return;
      if (selected) setSelected(null);
      else if (inspected) {
        setInspected(null);
        dropLinked();
      }
      else if (place !== "garden") go("garden");
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [selected, inspected, place]);

  const { latest, pending, events } = useMemo(() => {
    const latest = new Map<string, number>(), pending = new Set<string>();
    for (const c of checkIns) {
      if (!latest.has(c.agentId)) latest.set(c.agentId, c.createdAt);
      if (c.review?.status === "pending") pending.add(c.agentId);
    }
    for (const r of requests) if (r.review.status === "pending") pending.add(r.agentId);
    return { latest, pending, events: timeline(checkIns.slice(0, 24), log.slice(0, 12), taskEvents.slice(0, 24)).slice(0, 12) };
  }, [checkIns, requests, log, taskEvents]);

  const info = (id: string) => {
    const a = agents.find((x) => x.id === id)!;
    const p = kind === "garden" ? places[id] : undefined;
    return describe(t, a, { working: !!tasks[id], place: p?.place, walking: p?.walking, now: now + skew });
  };
  const sel = selected ? agents.find((a) => a.id === selected) : undefined;
  const pendingCount = checkIns.filter((c) => c.review?.status === "pending").length + requests.filter((r) => r.review.status === "pending").length;
  const connected = agents.filter((a) => a.origin === "connected").length;
  const inside = (p: Place) => occupants(p, agents, tasks, checkIns, now + skew).length;
  const nameOf = (id: string) => agents.find((a) => a.id === id)?.name ?? id;
  const here = placeName(t, place, agents);

  const panel = (
    <>
      {sel && !desktop && (
        <div className="border-b border-border pb-2">
          <AgentCallout agent={sel} {...info(sel.id)} onClose={() => setSelected(null)} inline />
        </div>
      )}
      {kind === "garden" ? (
        <GardenPanel agents={agents} info={info} latest={latest} pending={pending} selected={selected} onSelect={(id) => select(selected === id ? null : id)} inside={inside} pendingCount={pendingCount} />
      ) : (
        <div className="pt-4 pb-2">
          {desktop && (
            <div className="px-5 pb-4 md:px-6">
              <p className="eyebrow">{t.world.inside}</p>
              <h2 className="mt-1 text-h2">{here}</h2>
              <p className="mt-1.5 text-small leading-relaxed text-muted-foreground">{t.places.purpose[kind]}</p>
            </div>
          )}
          <PlacePanel place={place} inspected={inspected} onInspect={inspect} onSelect={select} />
        </div>
      )}
    </>
  );

  const sheetHeader = sel ? null : (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-title">{here}</p>
        <p className="truncate text-caption text-faint">
          {kind === "garden" ? t.world.summary(agents.length, inside("study"), pendingCount) : t.places.purpose[kind]}
        </p>
      </div>
      {kind === "garden" && (
        <span className="flex shrink-0 -space-x-1">
          {agents.slice(0, 5).map((a) => <AgentFigure key={a.id} id={a.id} crop scale={2} />)}
        </span>
      )}
    </div>
  );

  return (
    <div className="lg:flex lg:h-dvh lg:flex-col">
      <div className="lg:flex lg:min-h-0 lg:flex-1">
        {/* The scene */}
        <section
          className="fixed inset-x-0 top-[calc(48px+env(safe-area-inset-top))] bottom-0 overflow-hidden lg:relative lg:inset-auto lg:top-auto lg:min-h-0 lg:flex-1"
          aria-label={here}
        >
          <Sanctuary className="absolute inset-0" place={place} onPlace={go} selected={selected} onSelect={select} onAnchor={setAnchor} onPlaces={setPlaces}
            inspected={inspected} onInspect={inspect} zoomable onZoom={setZoomed} zoomKey={zoomKey}
            insetTop={desktop ? 0 : kind === "garden" ? 44 : 92} insetBottom={desktop ? 0 : dock + (SNAPS[snap] > 1 ? SNAPS[snap] : Math.round(SNAPS[snap] * Math.max(0, vh - dock - 56)))} />

          <AnimatePresence mode="wait" initial={false}>
            {kind === "garden" ? (
              <motion.header key="garden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}
                className="pointer-events-none absolute top-0 left-0 hidden p-5 md:block md:p-8">
                <p className="eyebrow">{t.world.eyebrow(connected, agents.length - connected)}</p>
                <h1 className="mt-3 max-w-sm text-display text-balance max-xl:sr-only">{t.world.title}</h1>
                <p className="mt-3 max-w-xs text-small leading-relaxed text-muted-foreground max-xl:hidden">{t.world.lead}</p>
                {viewer?.public && !viewer.canAct && (
                  <p className="mt-4 inline-flex items-center gap-2 rounded-[4px] border border-border/70 bg-background/60 px-2 py-1 font-mono text-meta text-faint max-xl:hidden"><span className="size-1.5 bg-sage" />{t.world.demoBadge}</p>
                )}
              </motion.header>
            ) : (
              <motion.header key={place} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3, ease: EASE }}
                className="pointer-events-none absolute top-0 left-0 flex max-w-[calc(100%-1.5rem)] flex-col items-start gap-2 p-3 md:max-w-[calc(100%-16rem)] md:flex-row md:flex-wrap md:items-center md:p-8">
                <button onClick={() => go("garden")} className="pointer-events-auto flex h-9 shrink-0 items-center gap-2 rounded-[6px] border border-border/80 bg-background/85 px-3 text-small font-medium text-foreground backdrop-blur-md transition-colors hover:bg-elevated">
                  <span aria-hidden>←</span> {t.world.back} <span className="hidden font-mono text-meta font-normal text-faint sm:inline">esc</span>
                </button>
                <nav aria-label={t.world.buildings} className="pointer-events-auto flex max-w-full gap-0.5 overflow-x-auto rounded-[6px] border border-border/70 bg-background/80 p-0.5 backdrop-blur-md [scrollbar-width:none]">
                  {BUILDINGS.map((p) => (
                    <button key={p} onClick={() => p !== place && go(p)} aria-current={place === p ? "page" : undefined}
                      className={cn("h-8 shrink-0 rounded-[4px] px-2.5 text-small whitespace-nowrap transition-colors max-sm:px-2 max-sm:text-caption", place === p ? "bg-elevated text-foreground" : "text-muted-foreground hover:text-foreground")}>
                      {t.places[p]}
                    </button>
                  ))}
                </nav>
              </motion.header>
            )}
          </AnimatePresence>

          <div className="absolute top-0 right-0 flex flex-col items-end gap-2 p-3 md:p-6">
            {kind === "garden" && (
              <div className="flex items-center gap-0.5 rounded-[6px] border border-border/60 bg-background/70 p-0.5 font-mono text-meta backdrop-blur-sm" role="radiogroup" aria-label={t.world.light} title={t.world.lightTip}>
                {LIGHTS.map((l) => (
                  <button key={l} role="radio" aria-checked={prefs.light === l} onClick={() => setPrefs({ light: l })}
                    className={cn("rounded-[4px] px-2 py-1 uppercase transition-colors", prefs.light === l ? "bg-elevated text-foreground" : "text-faint hover:text-muted-foreground", l !== "auto" && "max-sm:hidden")}>
                    {l === "auto" ? `${t.world.lights.auto} · ${t.world.lights[mode]}` : t.world.lights[l]}
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              {zoomed && (
                <button onClick={() => setZoomKey((k) => k + 1)} className="rounded-[6px] border border-border/60 bg-background/70 px-2 py-1 font-mono text-meta text-muted-foreground uppercase backdrop-blur-sm transition-colors hover:text-foreground">
                  {t.world.fitView}
                </button>
              )}
              <button onClick={() => setPrefs({ lowPower: !prefs.lowPower })} aria-pressed={prefs.lowPower} title={t.world.motionTip}
                className="rounded-[6px] border border-border/60 bg-background/70 px-2 py-1 font-mono text-meta text-faint uppercase backdrop-blur-sm transition-colors hover:text-muted-foreground">
                {t.world.motion(prefs.lowPower)}
              </button>
              <button onClick={() => setPrefs({ welcomeDone: false, introDone: false })} aria-label={t.world.help} title={t.world.help}
                className="flex items-center gap-1.5 rounded-[6px] border border-border/60 bg-background/70 px-1.5 py-1 text-caption text-muted-foreground backdrop-blur-sm transition-colors hover:text-foreground">
                <CircleHelpIcon className="size-3.5" /><span className="max-lg:hidden">{t.world.help}</span>
              </button>
            </div>
          </div>

          {status === "reconnecting" && (
            <p role="status" className="absolute top-14 left-1/2 z-20 -translate-x-1/2 rounded-[6px] border border-amber/30 bg-background/90 px-3 py-1.5 text-caption whitespace-nowrap text-amber backdrop-blur-md lg:top-6">
              {t.server.connectionLost}
            </p>
          )}

          {!agents.length && kind === "garden" && (
            <div className="pointer-events-none absolute inset-x-6 top-1/3 mx-auto max-w-xs rounded-[8px] border border-border bg-background/85 p-4 text-center backdrop-blur-md">
              <p className="text-ui font-medium">{t.world.emptyTitle}</p>
              <p className="mt-1 text-small text-muted-foreground">{t.world.emptyBody}</p>
            </div>
          )}

          {!desktop && kind === "garden" && !zoomed && (
            <p className="pointer-events-none absolute inset-x-4 text-center font-mono text-meta text-faint" style={{ bottom: dock + PEEK + 12 }}>
              {t.world.mobileHint}
            </p>
          )}

          {kind === "garden" && (
            <dl className="pointer-events-none absolute bottom-0 left-0 hidden gap-x-4 gap-y-1 p-5 text-caption lg:grid lg:grid-cols-[auto_auto] lg:p-8">
              {t.world.legend.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="text-faint">{v}</dd>
                </div>
              ))}
            </dl>
          )}

          {desktop && sel && anchor && <Callout key={sel.id} anchor={anchor}>
            <AgentCallout agent={sel} {...info(sel.id)} onClose={() => setSelected(null)} />
          </Callout>}

          <Intro place={place} onPlace={go} onSelect={select} />
          <Welcome />
        </section>

        {desktop ? (
          <aside ref={aside} className="w-[380px] shrink-0 overflow-y-auto border-l border-border" aria-label={t.world.details}>{panel}</aside>
        ) : (
          <BottomSheet snaps={SNAPS} snap={snap} onSnap={setSnap} bottom={dock} top={56} header={sheetHeader} label={t.world.details}>
            {panel}
          </BottomSheet>
        )}
      </div>

      {/* A quiet strip of recent activity */}
      {desktop && (
        <footer className="flex h-12 shrink-0 items-center gap-6 border-t border-border px-5 md:px-8">
          <Link href="/timeline" className="eyebrow shrink-0 hover:text-muted-foreground">{t.world.activity}</Link>
          <ol className="flex min-w-0 flex-1 gap-8 overflow-x-auto [scrollbar-width:none]" aria-live="polite" aria-relevant="additions">
            {events.map((e) => {
              const { subject, predicate } = sentence(t, e, nameOf);
              return (
                <motion.li key={e.id} layout initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5 }} className="flex shrink-0 items-center gap-2 text-caption whitespace-nowrap">
                  <span className="font-mono text-meta text-faint">{clock(e.at)}</span>
                  <Dot tone={KIND_TONE[e.kind]} />
                  {e.eventId ? (
                    <Link href={eventHref(e.eventId)} className="text-muted-foreground transition-colors hover:text-foreground"><span className="text-foreground">{subject}</span> {predicate}</Link>
                  ) : (
                    <span className="text-muted-foreground"><span className="text-foreground">{subject}</span> {predicate}</span>
                  )}
                </motion.li>
              );
            })}
          </ol>
        </footer>
      )}
    </div>
  );
}

function GardenPanel({ agents, info, latest, pending, selected, onSelect, inside, pendingCount }: {
  agents: ReturnType<typeof useStore.getState>["agents"];
  info: (id: string) => ReturnType<typeof describe>;
  latest: Map<string, number>;
  pending: Set<string>;
  selected: string | null;
  onSelect: (id: string) => void;
  inside: (p: Place) => number;
  pendingCount: number;
}) {
  const t = useT();
  const checkIns = useStore((s) => s.checkIns);
  const reflection = checkIns.find((c) => c.reflection);
  return (
    <>
      <div className="px-5 pt-5 pb-2 md:px-6">
        <p className="eyebrow">{t.world.agentsHere}</p>
      </div>
      <ul>
        {agents.map((a) => {
          const d = info(a.id);
          const at = latest.get(a.id);
          const on = selected === a.id;
          return (
            <li key={a.id}>
              <button onClick={() => onSelect(a.id)} aria-pressed={on}
                className={cn("group relative flex w-full items-center gap-4 px-5 py-2.5 text-left transition-colors md:px-6", on ? "bg-elevated" : "hover:bg-elevated/50")}>
                {on && <motion.span layoutId="resident-mark" className="absolute top-2 bottom-2 left-0 w-[2px] bg-sage" transition={{ duration: 0.3, ease: EASE }} />}
                <span className="flex h-9 w-8 items-end justify-center"><AgentFigure id={a.id} scale={2} crop className={cn((d.code === "disabled" || d.code === "offline") && "opacity-40")} /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-ui font-medium">{a.name}<span className={cn("ml-2 font-mono text-meta font-normal", a.origin === "connected" ? "text-sage" : "text-faint")}>{a.origin === "connected" ? t.origin.connected : t.origin.simulated}</span></span>
                    {pending.has(a.id) && <span className="flex items-center gap-1.5 font-mono text-meta text-amber uppercase"><Dot tone="amber" />{t.world.reviewTag}</span>}
                  </span>
                  <span className="block truncate text-caption text-muted-foreground">{d.state} <span className="text-faint">· {d.where.charAt(0).toLowerCase() + d.where.slice(1)}</span></span>
                  {at && <span className="block font-mono text-meta text-faint">{t.world.reported(clock(at))}</span>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <nav className="mx-5 mt-3 border-t border-border py-5 md:mx-6" aria-label={t.world.buildings}>
        <p className="eyebrow">{t.world.goInside}</p>
        <ul className="mt-3 grid grid-cols-1 gap-0.5">
          {BUILDINGS.map((p) => (
            <li key={p}>
              <button onClick={() => go(p)} className="group flex w-full items-start justify-between gap-3 rounded-[4px] px-2 py-1.5 text-left text-small text-muted-foreground transition-colors hover:bg-elevated/60 hover:text-foreground">
                <span>
                  <span className="text-foreground/90">{t.places[p]}</span> <span className="text-faint opacity-0 transition-opacity group-hover:opacity-100">→</span>
                  <span className="block text-caption text-faint">{t.places.caption[p]}</span>
                </span>
                <span className="shrink-0 pt-0.5 font-mono text-meta text-faint">{t.world.insideCount(inside(p))}</span>
              </button>
            </li>
          ))}
          {agents.map((a) => (
            <li key={a.id}>
              <button onClick={() => go(`room:${a.id}`)} className="group flex w-full items-baseline justify-between gap-3 rounded-[4px] px-2 py-1.5 text-left text-small text-muted-foreground transition-colors hover:bg-elevated/60 hover:text-foreground">
                <span>{t.places.room(a.name)} <span className="text-faint opacity-0 transition-opacity group-hover:opacity-100">→</span></span>
                <span className="font-mono text-meta text-faint">{t.world.roomState(!!inside(`room:${a.id}`))}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {reflection && (
        <section className="mx-5 border-t border-border py-6 md:mx-6">
          <p className="eyebrow">{t.world.latestNote}</p>
          <blockquote className="quote mt-3 text-quote text-foreground/90">{t.quote(reflection.reflection ?? "")}</blockquote>
          <p className="mt-3 font-mono text-meta text-faint uppercase">
            {agents.find((a) => a.id === reflection.agentId)?.name} · {t.world.note(reflectionNumber(checkIns, reflection))} · {t.sources[reflection.source]}
          </p>
          {t.common.originalLanguage && <p className="mt-2 text-caption text-faint">{t.common.originalLanguage}</p>}
          <Link href="/reflections" className="mt-4 inline-block text-small text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">{t.world.readNotes}</Link>
        </section>
      )}

      <Link href="/oversight" className="mx-5 flex items-center justify-between border-t border-border py-5 md:mx-6">
        <span className="text-small text-muted-foreground">{t.world.awaitingHuman}</span>
        <span className={cn("numeric text-h2", pendingCount ? "text-amber" : "text-faint")}>{pendingCount}</span>
      </Link>
    </>
  );
}

/** Pins the callout to the scene edge opposite the figure, with a thin leader line. */
function Callout({ anchor, children }: { anchor: Anchor; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(440);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const W = 330;
  const right = anchor.x < anchor.w / 2;
  const left = right ? anchor.w - W - 24 : 24;
  const top = Math.max(16, Math.min(anchor.h - height - 16, anchor.y - 90));
  const ex = right ? left : left + W, ey = Math.max(top + 24, Math.min(top + height - 24, anchor.y));
  return (
    <>
      <svg className="pointer-events-none absolute inset-0 z-10 size-full" aria-hidden>
        <motion.path d={`M${anchor.x} ${anchor.y} L${ex + (right ? -20 : 20)} ${ey} L${ex} ${ey}`} fill="none" stroke="var(--stone)" strokeOpacity={0.5} strokeWidth={1}
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.4, ease: "easeOut" }} />
        <rect x={anchor.x - 2} y={anchor.y - 2} width={4} height={4} fill="var(--stone)" />
      </svg>
      <motion.div ref={ref} className="absolute z-20" style={{ left, top }} initial={{ opacity: 0, x: right ? 8 : -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
        {children}
      </motion.div>
    </>
  );
}
