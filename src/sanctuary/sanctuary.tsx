"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/i18n/client";
import type { Dict } from "@/i18n";
import { isOnline } from "@/lib/projection";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { drawFigure, drawResidentGlow, drawResidents, hitTest, lightColor, Residents, screenOf, type AgentState } from "./actors.ts";
import { blend, H, hash, makeTarget, put, regionOutlines, rgb, sx, sy, W } from "./engine.ts";
import { interiorFor } from "./interior-cache.ts";
import type { Interior } from "./interiors.ts";
import { Life, lightForHour, type LightMode } from "./life.ts";
import { kindOf, occupants, roomAgent, type Place } from "./occupancy.ts";
import { REGION, renderStatic, roomAt, type StaticScene } from "./scene.ts";

export type { Place } from "./occupancy.ts";

/** The part of the garden buffer the island occupies; everything outside is empty sky. */
const VIEW = { x: 40, y: 4, w: 400, h: 292 };

interface Bundle {
  key: string;
  scene: StaticScene;
  interior?: Interior;
  life: Life;
  view: { x: number; y: number; w: number; h: number };
  outlines: Map<number, number[]>;
  /** Top-centre of each region, for its label and as the zoom origin. */
  tops: Map<number, { x: number; y: number }>;
  /** Every pixel of each region, for the hover highlight. */
  areas: Map<number, number[]>;
}

function bundleOf(key: string, scene: StaticScene, interior?: Interior): Bundle {
  const outlines = regionOutlines(scene.layer);
  const tops = new Map<number, { x: number; y: number }>();
  for (const [id, pixels] of outlines) {
    let minY = Infinity, minX = Infinity, maxX = -Infinity;
    for (const i of pixels) {
      const x = i % W, y = (i / W) | 0;
      minY = Math.min(minY, y);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
    tops.set(id, { x: (minX + maxX) / 2, y: minY });
  }
  const areas = new Map<number, number[]>();
  const r = scene.layer.r!;
  for (let i = 0; i < r.length; i++) if (r[i]) (areas.get(r[i]) ?? areas.set(r[i], []).get(r[i])!).push(i);
  return { key, scene, interior, life: new Life(scene, !interior), view: interior?.view ?? VIEW, outlines, tops, areas };
}

// Scenes are deterministic, so each is built once per page load and shared.
let garden: Bundle | null = null;
const gardenBundle = () => (garden ??= bundleOf("garden", renderStatic()));
const interiors = new Map<string, Bundle>();
function interiorBundle(place: Place, ids: string[]) {
  const key = place === "lounge" ? `lounge:${ids.join(",")}` : place;
  let b = interiors.get(key);
  if (!b) {
    const s = interiorFor(place, ids);
    b = bundleOf(key, s, s);
    interiors.set(key, b);
  }
  return b;
}

export const SKY: Record<LightMode, string> = {
  dawn: "radial-gradient(closest-side at 50% 48%, rgb(70 58 52 / 0.75), rgb(17 16 14 / 0) 100%)",
  day: "radial-gradient(closest-side at 50% 48%, rgb(56 68 58 / 0.7), rgb(17 16 14 / 0) 100%)",
  dusk: "radial-gradient(closest-side at 50% 48%, rgb(92 58 44 / 0.7), rgb(17 16 14 / 0) 100%)",
  night: "radial-gradient(closest-side at 50% 48%, rgb(30 40 62 / 0.75), rgb(17 16 14 / 0) 100%)",
};
const INDOOR = "radial-gradient(closest-side at 50% 52%, rgb(52 40 30 / 0.55), rgb(17 16 14 / 0) 100%)";

/** Buildings named on the garden at all times, so visitors can find their way without hovering. */
const SIGNS = [
  { region: REGION.study, key: "study" },
  { region: REGION.lounge, key: "lounge" },
  { region: REGION.spa, key: "spa" },
  { region: REGION.cabin, key: "rooms" },
] as const;

export interface Anchor { x: number; y: number; w: number; h: number }
/** Where each figure currently is: its spot id (e.g. "pond"), and whether it is still walking there. */
export type Places = Record<string, { place: string; walking: boolean; hidden: boolean }>;

export function useLightMode(): LightMode {
  const pref = useStore((s) => s.prefs.light);
  const [hour, setHour] = useState(12);
  useEffect(() => {
    const tick = () => setHour(new Date().getHours() + new Date().getMinutes() / 60);
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);
  return pref === "auto" ? lightForHour(hour) : pref;
}

const CREAM = rgb(0xece5d6), SAGE = rgb(0xa9c2a0), AMBER = rgb(0xd9a55b), SCREEN = rgb(0x9fc49a), DARK = rgb(0x141a17);
const LED_OFF = rgb(0x2a2f2c), KEY_HOOK = rgb(0x2a211b), GOLD = rgb(0xc2a15e);
const NO_FLASH = { flashAt: 0 };

const mixPx = (a: number, b: number, t: number) => {
  const ch = (s: number) => Math.round(((a >>> s) & 255) + (((b >>> s) & 255) - ((a >>> s) & 255)) * t);
  return (0xff000000 | (ch(16) << 16) | (ch(8) << 8) | ch(0)) >>> 0;
};

/**
 * The Sanctuary: the garden overview and the building interiors. Each figure's position is a
 * direct reading of agent state; rendering is local and never calls a model.
 */
export function Sanctuary({
  className, place = "garden", onPlace, selected = null, onSelect, onAnchor, onPlaces, inspected = null, onInspect, label = true,
  insetTop = 0, insetBottom = 0, onZoom, zoomKey = 0, zoomable = false,
}: {
  className?: string;
  place?: Place;
  onPlace?: (p: Place) => void;
  selected?: string | null;
  onSelect?: (id: string | null) => void;
  /** Reports the selected figure's position (CSS px within the component) when selection changes. */
  onAnchor?: (a: Anchor | null) => void;
  onPlaces?: (p: Places) => void;
  /** The interior object currently open in the side panel. */
  inspected?: string | null;
  onInspect?: (id: string | null) => void;
  label?: boolean;
  /** CSS px covered by overlays at the top and bottom; the world is fitted into the space between. */
  insetTop?: number;
  insetBottom?: number;
  /** Called when the viewer zooms in or returns to the full view. */
  onZoom?: (zoomed: boolean) => void;
  /** Changing this resets any zoom. */
  zoomKey?: number;
  /** Pinch, ctrl-wheel and drag to zoom and pan. Off where the scene sits in a scrolling page. */
  zoomable?: boolean;
}) {
  const t = useT();
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const tag = useRef<HTMLDivElement>(null);
  const signs = useRef<(HTMLDivElement | null)[]>([]);
  const mode = useLightMode();
  const announce = useRef<HTMLDivElement>(null);
  const live = useRef({ place, selected, inspected, onPlace, onSelect, onAnchor, onPlaces, onInspect, onZoom, mode, insetTop, insetBottom, zoomKey, t, hovered: null as string | null, hoverRegion: 0, hoverX: 0 });
  useEffect(() => {
    Object.assign(live.current, { place, selected, inspected, onPlace, onSelect, onAnchor, onPlaces, onInspect, onZoom, mode, insetTop, insetBottom, zoomKey, t });
  });
  const [indoors, setIndoors] = useState(false);

  useEffect(() => {
    const el = canvas.current!, box = wrap.current!;
    const ctx = el.getContext("2d")!;
    const residents = new Residents(Date.now());
    const frame = makeTarget();
    const off = document.createElement("canvas");
    off.width = W;
    off.height = H;
    const octx = off.getContext("2d")!;
    const img = octx.createImageData(W, H);
    const px = new Uint32Array(img.data.buffer);
    const reduce = matchMedia("(prefers-reduced-motion: reduce)");
    const L = { k: 1, dx: 0, dy: 0, dpr: 1, cw: 0, ch: 0 };
    let active: Bundle = gardenBundle();
    let current: Place = "garden";
    let transitioning = false;
    let flash = 0;

    // The viewer's zoom: a scale over the fitted view, and the art point at the centre of the free band.
    const Z = { s: 1, cx: 0, cy: 0 };
    let base = 1, mid = { x: 0, y: 0 };
    const apply = () => {
      const k = base * Z.s;
      Object.assign(L, { k, dx: Math.round(mid.x - Z.cx * k), dy: Math.round(mid.y - Z.cy * k) });
    };
    const resetZoom = () => {
      const v = active.view;
      Object.assign(Z, { s: 1, cx: v.x + v.w / 2, cy: v.y + v.h / 2 });
      apply();
      live.current.onZoom?.(false);
    };
    const layout = () => {
      const r = box.getBoundingClientRect();
      const dpr = Math.min(3, devicePixelRatio || 1);
      el.width = Math.round(r.width * dpr);
      el.height = Math.round(r.height * dpr);
      const top = live.current.insetTop * dpr, band = Math.max(80, el.height - top - live.current.insetBottom * dpr);
      const v = active.view;
      const fit = Math.min(el.width / v.w, band / v.h) * 0.96;
      // Whole device pixels per art pixel on standard screens; on dense screens the rounding is invisible.
      base = dpr >= 2 || fit < 1 ? fit : Math.floor(fit);
      mid = { x: el.width / 2, y: top + band / 2 };
      Object.assign(L, { dpr, cw: r.width, ch: r.height });
      if (Z.s === 1) Object.assign(Z, { cx: v.x + v.w / 2, cy: v.y + v.h / 2 });
      apply();
    };
    /** Zooms by `f` keeping the art point under device position (fx, fy) in place. */
    const zoomAt = (f: number, fx: number, fy: number) => {
      const ax = (fx - L.dx) / L.k, ay = (fy - L.dy) / L.k;
      Z.s = Math.max(1, Math.min(3.5, Z.s * f));
      const k = base * Z.s;
      Z.cx = ax - (fx - mid.x) / k;
      Z.cy = ay - (fy - mid.y) / k;
      clampPan();
      apply();
      live.current.onZoom?.(Z.s > 1.01);
    };
    const clampPan = () => {
      const v = active.view;
      if (Z.s <= 1.001) return Object.assign(Z, { s: 1, cx: v.x + v.w / 2, cy: v.y + v.h / 2 });
      const k = base * Z.s, hw = mid.x / k, hh = (mid.y - live.current.insetTop * L.dpr) / k;
      Z.cx = Math.max(v.x + hw * 0.6, Math.min(v.x + v.w - hw * 0.6, Z.cx));
      Z.cy = Math.max(v.y + hh * 0.6, Math.min(v.y + v.h - hh * 0.6, Z.cy));
    };
    const ro = new ResizeObserver(layout);
    ro.observe(box);
    box.addEventListener("tend:refit", layout);
    layout();

    // Agent state, recomputed only when the store's arrays change (or once a second, for presence).
    let refs: unknown[] = [];
    let states: AgentState[] = [];
    let stateMap = new Map<string, AgentState>();
    const readStates = () => {
      const s = useStore.getState();
      const next = [s.agents, s.checkIns, s.tasks, s.requests];
      if (next.every((v, i) => v === refs[i])) return;
      refs = next;
      const latest = new Map<string, { id: string; at: number }>(), pending = new Set<string>();
      for (const c of s.checkIns) {
        if (!latest.has(c.agentId)) latest.set(c.agentId, { id: c.id, at: c.createdAt });
        if (c.review?.status === "pending") pending.add(c.agentId);
      }
      for (const r of s.requests) if (r.review.status === "pending") pending.add(r.agentId);
      const now = Date.now() + s.skew;
      states = s.agents.map((a, index) => ({
        id: a.id, index, enabled: a.integrationEnabled, paused: a.status === "paused", offline: !isOnline(a, now),
        working: !!s.tasks[a.id], pending: pending.has(a.id), latestCheckIn: latest.get(a.id),
      }));
      stateMap = new Map(states.map((x) => [x.id, x]));
    };

    const toCss = (X: number, Y: number) => ({ x: (L.dx + X * L.k) / L.dpr, y: (L.dy + Y * L.k) / L.dpr });

    /** Who sits where inside the current interior, from live state. */
    const seated = () => {
      if (!active.interior) return [];
      const s = useStore.getState();
      const ids = occupants(current, s.agents, s.tasks, s.checkIns, Date.now() + s.skew);
      return active.interior.seats.slice(0, ids.length).map((seat, i) => ({ id: ids[i], seat }));
    };

    // ---- transitions: highlight, zoom toward the building, swap, settle ----
    const enter = (next: Place, from?: { x: number; y: number }) => {
      transitioning = true;
      const still = reduce.matches;
      const into = next !== "garden";
      el.style.transformOrigin = from ? `${from.x}px ${from.y}px` : "50% 50%";
      const out = el.animate(
        still ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: `scale(${into ? 1.45 : 0.92})` }],
        { duration: still ? 120 : 300, easing: "cubic-bezier(.4,0,.2,1)", fill: "forwards" },
      );
      out.onfinish = () => {
        const ids = useStore.getState().agents.map((a) => a.id);
        active = next === "garden" ? gardenBundle() : interiorBundle(next, ids);
        current = next;
        flash = 0;
        setIndoors(next !== "garden");
        live.current.hoverRegion = 0;
        lastSel = undefined;
        Z.s = 1;
        layout();
        live.current.onZoom?.(false);
        el.style.transformOrigin = "50% 50%";
        const back = el.animate(
          still ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 0, transform: `scale(${into ? 0.94 : 1.05})` }, { opacity: 1, transform: "scale(1)" }],
          { duration: still ? 120 : 360, easing: "cubic-bezier(.2,0,0,1)", fill: "forwards" },
        );
        back.onfinish = () => (transitioning = false);
      };
    };

    let lastSel: string | null | undefined;
    let lastPlaces = "";
    let visible = true;
    let raf = 0, last = performance.now(), clock = 0, taskCheck = 0;

    /** Interior details that depend on live state: terminals, review slips, the status lantern, occupants. */
    const drawInterior = (it: Interior, sit: { id: string; seat: Interior["seats"][number] }[], t: number, wall: number) => {
      const s = useStore.getState();
      const atDesk = new Map(sit.map((o, i) => [i + 1, o.id]));
      for (const sc of it.screens) {
        const who = it.kind === "room" ? roomAgent(current) : atDesk.get(sc.region);
        const task = who ? s.tasks[who] : undefined;
        // Text scrolls only while a task is actually in progress; an idle terminal stays dark.
        for (let y = 0; y < sc.h; y++)
          for (let x = 0; x < sc.w; x++) {
            const row = Math.floor(t * 1.5) + y;
            const on = !!task && y % 2 === 0 && x < 1 + Math.floor(hash(row, task.startedAt % 997, 105) * (sc.w - 1));
            put(frame, sc.x + x, sc.y + y, on ? SCREEN : DARK, sc.d, true);
          }
        if (task && Math.floor(t * 2) % 2) put(frame, sc.x + 1, sc.y + sc.h - 1, SCREEN, sc.d, true);
      }
      if (it.slips) {
        // One slip per open review, as stored on the server.
        const pending = s.checkIns.filter((c) => c.review?.status === "pending").length + s.requests.filter((r) => r.review.status === "pending").length;
        it.slips.slice(0, Math.min(6, pending)).forEach(({ x, y }) => {
          for (let j = 0; j < 6; j++) for (let i = 0; i < 5; i++) put(frame, x + i, y + j, j === 0 ? AMBER : CREAM, 99, true);
        });
      }
      if (it.status) {
        const id = roomAgent(current);
        const st = id ? stateMap.get(id) : undefined;
        const c = !st || !st.enabled ? DARK : st.pending ? AMBER : st.paused || st.offline ? rgb(0x5a554c) : st.working ? rgb(0xfff1cf) : rgb(0xf3ddb0);
        for (let j = 0; j < 8; j++) for (let i = 0; i < 3; i++) put(frame, it.status.x - 1 + i, it.status.y - 4 + j, c, 99, true);
      }
      // Study: one rack light per task in progress. Steady, never blinking for show.
      it.leds?.forEach(({ x, y }, i) => {
        const on = i < sit.length;
        put(frame, x, y, on ? SCREEN : LED_OFF, 14.2);
        put(frame, x + 1, y, on ? SCREEN : LED_OFF, 14.2);
      });
      const owner = it.kind === "room" ? s.agents.find((a) => a.id === roomAgent(current)) : undefined;
      // Room: one key on the rack per permission a human has granted.
      it.hooks?.forEach(({ x, y }, i) => {
        put(frame, x, y, KEY_HOOK, 1);
        if (!owner || i >= owner.permissions.length) return;
        for (const [ox, oy] of [[0, 1], [-1, 2], [1, 2], [0, 3], [0, 4], [0, 5], [1, 5]]) put(frame, x + ox, y + oy, oy < 3 ? AMBER : GOLD, 1);
      });
      // Room: how the agent reaches Tend. A paper charm for simulated agents; a light for connected ones.
      if (it.link && owner) {
        const { x, y } = it.link;
        if (owner.origin === "demo") {
          for (let j = -2; j <= 2; j++) for (let i = -1; i <= 1; i++) put(frame, x + i, y + j, j === -2 ? AMBER : CREAM, 9.7);
          put(frame, x, y, rgb(0xa8463a), 9.7);
        } else {
          const c = !owner.integrationEnabled ? DARK : isOnline(owner, Date.now() + s.skew) ? SCREEN : rgb(0x5a554c);
          for (const [i, j] of [[0, -1], [-1, 0], [0, 0], [1, 0], [0, 1]]) put(frame, x + i, y + j, c, 9.7);
        }
      }
      for (const { id, seat } of sit) {
        const X = Math.round(sx(seat.x, seat.y)), Y = Math.round(sy(seat.x, seat.y, seat.z));
        const d = seat.x + seat.y + 0.35;
        if (id === live.current.selected || id === live.current.hovered)
          for (let k = 0; k < 20; k++) {
            if (k % 2 && id !== live.current.selected) continue;
            const th = (k / 20) * Math.PI * 2;
            put(frame, X + Math.round(Math.cos(th) * 6), Y + Math.round(Math.sin(th) * 2.6), CREAM, d - 0.6, true);
          }
        for (let dx = -4; dx <= 4; dx++) blend(frame, X + dx, Y + 1, rgb(0x17130f), 0.3, d - 0.7);
        drawFigure(frame, id, seat.pose === "sit" ? "sit" : "stand", seat.back, seat.face < 0, X, Y, d, lightColor(NO_FLASH, stateMap.get(id), wall));
        if (stateMap.get(id)?.pending) for (const [ox, oy] of [[0, -1], [-1, 0], [0, 0], [1, 0], [0, 1]]) put(frame, X + ox, Y - 16 + oy, AMBER, d + 0.01, true);
      }
    };

    /** Title and one line of context for a building or object, from live state, in the interface language. */
    const regionLabel = (id: number, X = 0): [string, string] => {
      const t = live.current.t;
      const s = useStore.getState(), now = Date.now() + s.skew;
      if (active.interior) {
        const o = active.interior.objects[id]?.id ?? "";
        if (o.startsWith("desk-")) return t.objects.desk(Number(o.slice(5)) + 1);
        if (o.startsWith("journal-")) return [t.panels.journalTitle(s.agents.find((a) => a.id === o.slice(8))?.name ?? ""), ""];
        return (t.objects[active.interior.kind as keyof Dict["objects"]] as Record<string, [string, string]>)[o] ?? ["", ""];
      }
      const count = (p: Place) => occupants(p, s.agents, s.tasks, s.checkIns, now).length;
      if (id >= REGION.cabin && id < REGION.cabin + 3) {
        const a = s.agents[roomAt(id - REGION.cabin, X)];
        if (!a) return [t.places.emptyRoom, ""];
        return [t.places.room(a.name), `${count(`room:${a.id}`) ? t.scene.roomIn(a.status === "paused") : t.scene.roomAway} · ${t.scene.enter}`];
      }
      if (id === REGION.study) return [t.places.study, `${t.scene.working(count("study"))} · ${t.scene.enter}`];
      if (id === REGION.lounge) return [t.places.lounge, `${t.scene.reported(count("lounge"))} · ${t.scene.enter}`];
      return [t.places.spa, `${t.scene.idle(count("spa"))} · ${t.scene.enter}`];
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (live.current.place !== current && !transitioning) {
        const top = flash ? active.tops.get(flash) : undefined;
        enter(live.current.place, top ? toCss(top.x, top.y + 18) : undefined);
      }
      if (!visible || document.hidden) return;
      const { prefs } = useStore.getState();
      const still = reduce.matches;
      const fps = still ? 4 : prefs.lowPower ? 15 : 30;
      if (now - last < 1000 / fps - 1) return;
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      clock += still ? 0 : dt;
      taskCheck += dt;
      if (taskCheck > 1) {
        taskCheck = 0;
        refs = [];
        const places: Places = {};
        for (const a of residents.actors.values()) places[a.id] = { place: a.spot.place, walking: !a.settled, hidden: a.hidden };
        const key = JSON.stringify(places);
        if (key !== lastPlaces) {
          lastPlaces = key;
          live.current.onPlaces?.(places);
        }
      }
      readStates();
      const wall = Date.now();
      const m = live.current.mode;
      // Garden residents keep following state while you're indoors, so stepping out shows the present.
      residents.update(states, wall, dt, still);
      active.life.update(dt, !still && !prefs.lowPower);

      frame.c.set(active.scene.layer.c);
      frame.d.set(active.scene.layer.d);
      active.life.drawWorld(frame, clock, !still);
      const sit = seated();
      if (active.interior) drawInterior(active.interior, sit, clock, wall);
      else drawResidents(frame, residents, stateMap, { now: wall, t: clock, selected: live.current.selected, hovered: live.current.hovered, animate: !still });
      if (!prefs.lowPower && !still) active.life.drawAir(frame);
      active.life.light(frame, m, clock);
      if (!active.interior) {
        drawResidentGlow(frame, residents, stateMap, wall, m === "night" ? 1 : m === "dusk" ? 0.55 : 0);
        if (!still) active.life.drawGlow(frame, clock, m);
      } else {
        for (const { id, seat } of sit)
          put(frame, Math.round(sx(seat.x, seat.y)), Math.round(sy(seat.x, seat.y, seat.z)) - 8, lightColor(NO_FLASH, stateMap.get(id), wall), seat.x + seat.y + 0.35, true);
      }

      // Outline the hovered building or object, the one being entered, and the one open in the panel.
      const outline = (id: number, c: number, a: number) => {
        for (const i of active.outlines.get(id) ?? []) frame.c[i] = mixPx(frame.c[i], c, a);
      };
      if (live.current.hoverRegion) {
        for (const i of active.areas.get(live.current.hoverRegion) ?? []) frame.c[i] = mixPx(frame.c[i], CREAM, 0.07);
        outline(live.current.hoverRegion, CREAM, 0.75);
      }
      if (flash) outline(flash, CREAM, 1);
      if (active.interior && live.current.inspected) {
        const id = Number(Object.entries(active.interior.objects).find(([, o]) => o.id === live.current.inspected)?.[0] ?? 0);
        if (id) outline(id, SAGE, 0.95);
      }

      px.set(frame.c);
      octx.putImageData(img, 0, 0);
      ctx.clearRect(0, 0, el.width, el.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(off, L.dx, L.dy, W * L.k, H * L.k);

      // Building signs in the garden; the one under the pointer gives way to its fuller name tag.
      SIGNS.forEach(({ region }, i) => {
        const el = signs.current[i], top = active.tops.get(region);
        if (!el) return;
        // On a narrow, unzoomed garden the rooms' sign would sit on the Study's; the room doors are labelled on hover.
        const crowded = region === REGION.cabin && L.cw < 560 && Z.s < 1.3;
        if (!label || active.interior || transitioning || !top || crowded || live.current.hoverRegion === region) {
          el.style.opacity = "0";
          return;
        }
        const p = toCss(top.x, top.y - 2);
        el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
        el.style.opacity = "1";
      });

      // Name tag: the hovered (or selected) figure, else the hovered building or object.
      const focus = live.current.hovered ?? live.current.selected;
      const t = tag.current;
      if (t) {
        let text = "", sub = "";
        let at: { x: number; y: number } | null = null;
        if (focus) {
          const g = active.interior ? sit.find((o) => o.id === focus) : undefined;
          const a = residents.actors.get(focus);
          if (g) at = { x: sx(g.seat.x, g.seat.y), y: sy(g.seat.x, g.seat.y, g.seat.z) - 16 };
          else if (!active.interior && a && !a.hidden) {
            const { X, Y } = screenOf(a);
            at = { x: X, y: Y - (a.settled && a.spot.pose === "sit" ? 15 : 19) };
          }
          if (at) {
            const t = live.current.t;
            const who = useStore.getState().agents.find((g2) => g2.id === focus);
            const st = stateMap.get(focus);
            text = who?.name ?? "";
            const state = !st ? "" : !st.enabled ? t.state.label.disabled : st.paused ? t.state.label.paused : st.offline ? t.state.label.offline : st.working ? t.state.describe.working : t.state.label.idle;
            const origin = who && (who.origin === "connected" ? t.origin.connected : t.origin.simulated);
            sub = [state, origin, st?.pending && t.scene.reviewPending].filter(Boolean).join(" · ");
          }
        }
        if (!at && live.current.hoverRegion) {
          const top = active.tops.get(live.current.hoverRegion);
          if (top) {
            at = { x: top.x, y: top.y - 3 };
            [text, sub] = regionLabel(live.current.hoverRegion, live.current.hoverX);
          }
        }
        if (label && at && text) {
          const p = toCss(at.x, at.y);
          t.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
          t.style.opacity = "1";
          const key = text + "|" + sub;
          if (t.dataset.key !== key) {
            t.dataset.key = key;
            (t.firstChild as HTMLElement).textContent = text;
            (t.lastChild as HTMLElement).textContent = sub;
            (t.lastChild as HTMLElement).style.display = sub ? "" : "none";
          }
        } else t.style.opacity = "0";
      }
      if (live.current.selected !== lastSel) {
        lastSel = live.current.selected;
        const g = active.interior ? sit.find((o) => o.id === lastSel) : undefined;
        const a = lastSel ? residents.actors.get(lastSel) : undefined;
        if (g) live.current.onAnchor?.({ ...toCss(sx(g.seat.x, g.seat.y), sy(g.seat.x, g.seat.y, g.seat.z) - 8), w: L.cw, h: L.ch });
        else if (a && !active.interior && !a.hidden) {
          const { X, Y } = screenOf(a);
          live.current.onAnchor?.({ ...toCss(X, Y - 8), w: L.cw, h: L.ch });
        } else live.current.onAnchor?.(null);
      }
    };
    raf = requestAnimationFrame(loop);
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(box);

    const logical = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return [((e.clientX - r.left) * L.dpr - L.dx) / L.k, ((e.clientY - r.top) * L.dpr - L.dy) / L.k];
    };
    /** The figure under the pointer, in the garden or seated inside. */
    const figureAt = (x: number, y: number) => {
      if (!active.interior) return hitTest(residents, x, y)?.id ?? null;
      for (const { id, seat } of seated()) {
        const X = sx(seat.x, seat.y), Y = sy(seat.x, seat.y, seat.z);
        if (x >= X - 5 && x <= X + 5 && y >= Y - 15 && y <= Y + 2) return id;
      }
      return null;
    };
    const regionAt = (x: number, y: number) => (x >= 0 && y >= 0 && x < W && y < H ? (active.scene.layer.r?.[(y | 0) * W + (x | 0)] ?? 0) : 0);

    const hover = (x: number, y: number) => {
      const hit = figureAt(x, y);
      live.current.hovered = hit;
      live.current.hoverRegion = hit ? 0 : regionAt(x, y);
      live.current.hoverX = x;
      el.style.cursor = hit || live.current.hoverRegion ? "pointer" : Z.s > 1.01 ? "grab" : !active.interior && active.life.isWater(x, y) ? "crosshair" : "default";
    };
    const placeOf = (region: number, x: number): Place | null => {
      if (region === REGION.study) return "study";
      if (region === REGION.lounge) return "lounge";
      if (region === REGION.spa) return "spa";
      if (region >= REGION.cabin) {
        const agent = useStore.getState().agents[roomAt(region - REGION.cabin, x)];
        if (agent) return `room:${agent.id}`;
      }
      return null;
    };
    /** A tap or click at art position (x, y). */
    const activate = (x: number, y: number) => {
      if (transitioning) return;
      const hit = figureAt(x, y);
      if (hit) return live.current.onSelect?.(hit === live.current.selected ? null : hit);
      const region = regionAt(x, y);
      if (active.interior) {
        const obj = active.interior.objects[region];
        live.current.onSelect?.(null);
        return live.current.onInspect?.(obj ? obj.id : null);
      }
      const next = region ? placeOf(region, x) : null;
      if (next) {
        flash = region;
        live.current.onSelect?.(null);
        return live.current.onPlace?.(next);
      }
      if (active.life.isWater(x, y)) active.life.ripple(x, y);
      live.current.onSelect?.(null);
    };

    // Pointers: a tap activates; one finger (or a mouse) pans when zoomed; two fingers pinch.
    const pointers = new Map<number, { x: number; y: number; sx: number; sy: number }>();
    let gesture: "none" | "pan" | "pinch" = "none";
    let pinchD = 0;
    const dev = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      return { x: (e.clientX - r.left) * L.dpr, y: (e.clientY - r.top) * L.dpr };
    };
    const down = (e: PointerEvent) => {
      const p = dev(e);
      pointers.set(e.pointerId, { ...p, sx: p.x, sy: p.y });
      el.setPointerCapture?.(e.pointerId);
      if (pointers.size === 2 && zoomable) {
        const [a, b] = [...pointers.values()];
        pinchD = Math.hypot(a.x - b.x, a.y - b.y);
        gesture = "pinch";
      }
    };
    const move = (e: PointerEvent) => {
      if (transitioning) return;
      const p = dev(e), q = pointers.get(e.pointerId);
      if (!q) {
        const [x, y] = logical(e);
        return hover(x, y);
      }
      if (gesture === "pinch" && pointers.size >= 2) {
        q.x = p.x; q.y = p.y;
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchD > 0) zoomAt(d / pinchD, (a.x + b.x) / 2, (a.y + b.y) / 2);
        pinchD = d;
        return;
      }
      if (gesture === "none" && zoomable && Z.s > 1.01 && Math.hypot(p.x - q.sx, p.y - q.sy) > 8 * L.dpr) gesture = "pan";
      if (gesture === "pan") {
        Z.cx -= (p.x - q.x) / L.k;
        Z.cy -= (p.y - q.y) / L.k;
        clampPan();
        apply();
        el.style.cursor = "grabbing";
      }
      q.x = p.x; q.y = p.y;
      if (e.pointerType === "mouse" && gesture === "none") {
        const [x, y] = logical(e);
        hover(x, y);
      }
    };
    const up = (e: PointerEvent) => {
      const q = pointers.get(e.pointerId);
      pointers.delete(e.pointerId);
      if (!q) return;
      const tap = gesture === "none" && Math.hypot(q.x - q.sx, q.y - q.sy) < 10 * L.dpr;
      if (pointers.size === 0) gesture = "none";
      if (tap) {
        const [x, y] = logical(e);
        if (e.pointerType !== "mouse") hover(x, y);
        activate(x, y);
      }
    };
    const cancel = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (!pointers.size) gesture = "none";
    };
    const leave = () => {
      if (pointers.size) return;
      live.current.hovered = null;
      live.current.hoverRegion = 0;
    };
    // Trackpad pinch (ctrl + wheel) zooms around the cursor; ordinary scrolling is left to the page.
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey || !zoomable) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.012), (e.clientX - r.left) * L.dpr, (e.clientY - r.top) * L.dpr);
    };

    // Keyboard: arrows move between buildings, objects and figures; Enter opens or selects.
    let cursor = -1;
    const targets = (): ({ region: number } | { agent: string })[] => {
      if (active.interior) return [...Object.keys(active.interior.objects).map((k) => ({ region: Number(k) })), ...seated().map((o) => ({ agent: o.id }))];
      const figs = [...residents.actors.values()].filter((a) => !a.hidden).sort((a, b) => screenOf(a).X - screenOf(b).X);
      return [{ region: REGION.study }, { region: REGION.lounge }, { region: REGION.spa }, ...figs.map((a) => ({ agent: a.id }))];
    };
    const say = (text: string) => announce.current && (announce.current.textContent = text);
    const key = (e: KeyboardEvent) => {
      if (transitioning) return;
      const list = targets();
      if (!list.length) return;
      if (["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        cursor = (cursor + (e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : -1) + list.length) % list.length;
        const t = list[cursor];
        if ("agent" in t) {
          live.current.hovered = t.agent;
          live.current.hoverRegion = 0;
          const a = useStore.getState().agents.find((x) => x.id === t.agent);
          say(live.current.t.scene.sayAgent(a?.name ?? live.current.t.common.agent));
        } else {
          live.current.hovered = null;
          live.current.hoverRegion = t.region;
          const top = active.tops.get(t.region);
          live.current.hoverX = top?.x ?? 0;
          const [title, sub] = regionLabel(t.region, live.current.hoverX);
          say(live.current.t.scene.sayPlace(title, sub.replace(` · ${live.current.t.scene.enter}`, ""), !!active.interior));
        }
      } else if ((e.key === "Enter" || e.key === " ") && cursor >= 0) {
        e.preventDefault();
        const t = list[Math.min(cursor, list.length - 1)];
        if ("agent" in t) live.current.onSelect?.(t.agent === live.current.selected ? null : t.agent);
        else if (active.interior) live.current.onInspect?.(active.interior.objects[t.region]?.id ?? null);
        else {
          const next = placeOf(t.region, live.current.hoverX);
          if (next) { flash = t.region; live.current.onPlace?.(next); }
        }
        cursor = -1;
      }
    };
    const blur = () => { cursor = -1; leave(); };

    let lastZoomKey = live.current.zoomKey;
    const zoomWatch = setInterval(() => {
      if (live.current.zoomKey !== lastZoomKey) { lastZoomKey = live.current.zoomKey; resetZoom(); }
    }, 150);

    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", cancel);
    el.addEventListener("pointerleave", leave);
    el.addEventListener("wheel", wheel, { passive: false });
    el.addEventListener("keydown", key);
    el.addEventListener("blur", blur);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      clearInterval(zoomWatch);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", cancel);
      el.removeEventListener("pointerleave", leave);
      el.removeEventListener("wheel", wheel);
      el.removeEventListener("keydown", key);
      el.removeEventListener("blur", blur);
    };
  }, [label, zoomable]);

  // Overlays changed size (e.g. a sheet docked): refit on the next resize tick.
  useEffect(() => {
    wrap.current?.dispatchEvent(new Event("tend:refit"));
  }, [insetTop, insetBottom]);

  return (
    <div ref={wrap} className={cn("relative select-none", className)}>
      <div aria-hidden className="tend-sky pointer-events-none absolute inset-0 transition-[background] duration-[2000ms]" style={{ background: indoors ? INDOOR : SKY[mode] }} />
      <canvas
        ref={canvas}
        tabIndex={0}
        className={cn("pixelated absolute inset-0 size-full outline-none", zoomable ? "touch-none" : "touch-manipulation", " focus-visible:shadow-[inset_0_0_0_1px_var(--sage)]")}
        role="application"
        aria-roledescription={t.scene.roledescription}
        aria-label={kindOf(place) === "garden" ? t.scene.gardenLabel : t.scene.interiorLabel}
      />
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        {SIGNS.map(({ key }, i) => (
          <div key={key} ref={(el) => { signs.current[i] = el; }} className="absolute top-0 left-0 flex flex-col items-center opacity-0 transition-opacity duration-300">
            <span className="rounded-[3px] border border-border/50 bg-background/75 px-1.5 py-px text-[11px] leading-tight font-medium whitespace-nowrap text-foreground/90 backdrop-blur-[2px]">
              {key === "rooms" ? t.places.rooms : t.places[key]}
            </span>
            <span className="mt-0.5 font-mono text-[10px] leading-none whitespace-nowrap text-faint [text-shadow:0_1px_2px_rgb(0_0_0/0.9)] max-md:hidden">{t.places.caption[key]}</span>
          </div>
        ))}
      </div>
      <div ref={announce} aria-live="polite" className="sr-only" />
      <div ref={tag} aria-hidden className="pointer-events-none absolute top-0 left-0 flex flex-col items-center rounded-[4px] border border-border/70 bg-background/90 px-2 py-1 whitespace-nowrap opacity-0 shadow-[0_8px_20px_-12px_rgb(0_0_0/0.9)] transition-opacity duration-200">
        <span className="text-caption font-medium text-foreground" />
        <span className="font-mono text-meta text-faint" />
      </div>
    </div>
  );
}
