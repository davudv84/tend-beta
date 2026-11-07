"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import type { Outcome } from "@/lib/activity";
import { ACTIVITY, type DemoDecision } from "../demo-data";

// The hero's interactive demo: a queue of invented requests, the four numbers, the activity list and a short countdown, all in the
// browser. Nothing is sent anywhere. The desktop window and the phone card both read this one state, so they can never disagree.

export type DemoId = "invoice" | "push" | "email" | "rows" | "dns";
export type DemoKind = "spend" | "run" | "send" | "data" | "settings";

export interface DemoRequest {
  id: DemoId;
  agent: string;
  kind: DemoKind;
  /** The tool and action as recorded, shown in Details and under the request in Activity. */
  tool: string;
  action: string;
  /** The item the request touches, when it has one (the invoice number). */
  item?: string;
  /** A command, query or address, shown as written in a typewriter face. */
  mono: boolean;
  /** When it was asked, in minutes before the demo started (or 0 when it arrives during the demo). */
  askedMinutesAgo: number;
  /** How long it stays open, in seconds. */
  seconds: number;
}

/** All five requests, in the order they come. The first two wait when the demo opens. */
export const QUEUE: DemoRequest[] = [
  { id: "invoice", agent: "ops-agent", kind: "spend", tool: "pay_invoice", action: "pay", item: "2026-118", mono: false, askedMinutesAgo: 2, seconds: 8 * 60 },
  { id: "push", agent: "repo-helper", kind: "run", tool: "shell", action: "Bash", mono: true, askedMinutesAgo: 4, seconds: 6 * 60 },
  { id: "email", agent: "support-agent", kind: "send", tool: "send_email", action: "send", mono: false, askedMinutesAgo: 0, seconds: 5 * 60 },
  { id: "rows", agent: "data-agent", kind: "data", tool: "postgres", action: "delete", mono: true, askedMinutesAgo: 0, seconds: 5 * 60 },
  { id: "dns", agent: "ops-agent", kind: "settings", tool: "dns", action: "update_record", mono: true, askedMinutesAgo: 0, seconds: 5 * 60 },
];
const SHOWN = 2;

export interface Waiting {
  request: DemoRequest;
  /** Seconds left before it lapses. */
  left: number;
  /** When it arrived during the demo (a clock reading), for Details. */
  arrivedAt?: string;
}

export type Decision = "allowed" | "denied" | "expired";

/** One line in Activity: the invented history first, then what the visitor decided, newest on top. */
export interface ActivityLine {
  key: string;
  time: string;
  agent: string;
  detail?: string;
  action: string;
  outcome: Outcome;
  /** A recorded reason in the app's words, or a decision made in the demo. */
  reason: { kind: "history"; decision: DemoDecision } | { kind: Decision };
  fresh?: boolean;
}

interface State {
  waiting: Waiting[];
  next: number;
  auto: number;
  blocked: number;
  activity: ActivityLine[];
  /** Bumped whenever a request arrives, so the waiting count can pulse once. */
  arrivals: number;
  toast: { id: number; decision: Decision } | null;
  announce: { id: number; text: Decision | { arrived: DemoId } } | null;
  serial: number;
}

type Action =
  | { type: "decide"; id: DemoId; decision: Decision; time: string; detail: string }
  | { type: "arrive"; time: string }
  | { type: "tick" }
  | { type: "clearToast"; id: number }
  | { type: "restart" };

const history = (): ActivityLine[] =>
  ACTIVITY.map((d, i) => ({ key: `history-${i}`, time: d.time, agent: d.agent.name, detail: d.detail, action: `${d.tool}.${d.action}`, outcome: d.outcome, reason: { kind: "history", decision: d } }));

const initial = (): State => ({
  waiting: QUEUE.slice(0, SHOWN).map((request) => ({ request, left: request.seconds })),
  next: SHOWN,
  auto: 14,
  blocked: 2,
  activity: history(),
  arrivals: 0,
  toast: null,
  announce: null,
  serial: 0,
});

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "decide": {
      const w = s.waiting.find((x) => x.request.id === a.id);
      if (!w) return s;
      const r = w.request;
      const serial = s.serial + 1;
      const line: ActivityLine = { key: `${r.id}-${serial}`, time: a.time, agent: r.agent, detail: a.detail, action: `${r.tool}.${r.action}`, outcome: a.decision === "allowed" ? "approved" : a.decision === "denied" ? "rejected" : "expired", reason: { kind: a.decision }, fresh: true };
      return {
        ...s,
        serial,
        waiting: s.waiting.filter((x) => x.request.id !== a.id),
        auto: s.auto + (a.decision === "allowed" ? 1 : 0),
        blocked: s.blocked + (a.decision === "allowed" ? 0 : 1),
        activity: [line, ...s.activity.map((l) => ({ ...l, fresh: false }))],
        toast: a.decision === "expired" ? s.toast : { id: serial, decision: a.decision },
        announce: { id: serial, text: a.decision },
      };
    }
    case "arrive": {
      if (s.next >= QUEUE.length || s.waiting.length >= SHOWN) return s;
      const request = QUEUE[s.next];
      const serial = s.serial + 1;
      return { ...s, serial, next: s.next + 1, waiting: [...s.waiting, { request, left: request.seconds, arrivedAt: a.time }], arrivals: s.arrivals + 1, announce: { id: serial, text: { arrived: request.id } } };
    }
    case "tick":
      return s.waiting.length ? { ...s, waiting: s.waiting.map((w) => ({ ...w, left: Math.max(0, w.left - 1) })) } : s;
    case "clearToast":
      return s.toast?.id === a.id ? { ...s, toast: null } : s;
    case "restart":
      return { ...initial(), serial: s.serial + 1, arrivals: s.arrivals + 1, announce: null };
  }
}

const clockNow = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

/** "7:59": minutes and seconds, for the countdown. */
export const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

/**
 * The demo's state and what a visitor can do with it. A decision takes the card away at once; 3–5 seconds later the next request
 * in the queue arrives, until all five have been answered. Each waiting request counts down once a second and lapses at 0:00.
 */
export function useDemo(exactOf: (id: DemoId) => string) {
  const [s, dispatch] = useReducer(reducer, undefined, initial);
  const timers = useRef<number[]>([]);
  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms));
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // One tick a second while anything waits.
  const counting = s.waiting.length > 0;
  useEffect(() => {
    if (!counting) return;
    const id = window.setInterval(() => dispatch({ type: "tick" }), 1000);
    return () => clearInterval(id);
  }, [counting]);

  // A request whose time has run out lapses: nothing happens, and it says so.
  const lapsed = s.waiting.find((w) => w.left === 0)?.request.id;
  const refill = useCallback(() => later(() => dispatch({ type: "arrive", time: clockNow() }), 3000 + Math.round(Math.random() * 2000)), []);
  useEffect(() => {
    if (!lapsed) return;
    dispatch({ type: "decide", id: lapsed, decision: "expired", time: clockNow(), detail: exactOf(lapsed) });
    refill();
  }, [lapsed, exactOf, refill]);

  // The toast leaves on its own after a few seconds.
  const toastId = s.toast?.id;
  useEffect(() => {
    if (toastId === undefined) return;
    const id = window.setTimeout(() => dispatch({ type: "clearToast", id: toastId }), 3200);
    return () => clearTimeout(id);
  }, [toastId]);

  const decide = useCallback(
    (id: DemoId, decision: "allowed" | "denied") => {
      dispatch({ type: "decide", id, decision, time: clockNow(), detail: exactOf(id) });
      refill();
    },
    [exactOf, refill],
  );
  const restart = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    dispatch({ type: "restart" });
  }, []);

  const done = s.waiting.length === 0 && s.next >= QUEUE.length;
  return { ...s, done, decide, restart };
}

export type Demo = ReturnType<typeof useDemo>;
