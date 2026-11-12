"use client";

import { useCallback, useEffect, useReducer } from "react";
import type { Outcome } from "@/lib/activity";
import { ACTIVITY, type DemoDecision } from "../demo-data";

// The hero's interactive demo: one invented request, the four numbers, the activity list and a short countdown, all in the browser.
// Nothing is sent anywhere. The visitor answers it once, and that is the end of it. The desktop window and the phone card both read
// this one state, so they can never disagree.

export type DemoId = "invoice";
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
  /** When it was asked, in minutes before the demo opened. */
  askedMinutesAgo: number;
  /** How long it stays open, in seconds. */
  seconds: number;
}

/** The one request that waits when the demo opens. */
export const REQUEST: DemoRequest = { id: "invoice", agent: "ops-agent", kind: "spend", tool: "pay_invoice", action: "pay", item: "2026-118", mono: false, askedMinutesAgo: 2, seconds: 8 * 60 };

export interface Waiting {
  request: DemoRequest;
  /** Seconds left before it lapses. */
  left: number;
}

export type Decision = "allowed" | "denied" | "expired";

/** One line in Activity: the invented history first, then what the visitor decided, on top. */
export interface ActivityLine {
  key: string;
  time: string;
  agent: string;
  detail?: string;
  action: string;
  outcome: Outcome;
  /** A recorded reason in the app's words, or the decision made in the demo. */
  reason: { kind: "history"; decision: DemoDecision } | { kind: Decision };
}

interface State {
  waiting: Waiting[];
  auto: number;
  blocked: number;
  activity: ActivityLine[];
  toast: { id: number; decision: Decision } | null;
  announce: Decision | null;
}

type Action = { type: "decide"; decision: Decision; time: string; detail: string } | { type: "tick" } | { type: "clearToast"; id: number };

const initial = (): State => ({
  waiting: [{ request: REQUEST, left: REQUEST.seconds }],
  auto: 14,
  blocked: 2,
  activity: ACTIVITY.map((d, i) => ({ key: `history-${i}`, time: d.time, agent: d.agent.name, detail: d.detail, action: `${d.tool}.${d.action}`, outcome: d.outcome, reason: { kind: "history", decision: d } })),
  toast: null,
  announce: null,
});

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "decide": {
      if (!s.waiting.length) return s;
      const r = s.waiting[0].request;
      const line: ActivityLine = { key: "decided", time: a.time, agent: r.agent, detail: a.detail, action: `${r.tool}.${r.action}`, outcome: a.decision === "allowed" ? "approved" : a.decision === "denied" ? "rejected" : "expired", reason: { kind: a.decision } };
      return {
        ...s,
        waiting: [],
        auto: s.auto + (a.decision === "allowed" ? 1 : 0),
        blocked: s.blocked + (a.decision === "allowed" ? 0 : 1),
        activity: [line, ...s.activity],
        toast: a.decision === "expired" ? null : { id: 1, decision: a.decision },
        announce: a.decision,
      };
    }
    case "tick":
      return s.waiting.length ? { ...s, waiting: s.waiting.map((w) => ({ ...w, left: Math.max(0, w.left - 1) })) } : s;
    case "clearToast":
      return s.toast?.id === a.id ? { ...s, toast: null } : s;
  }
}

const clockNow = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });

/** "7:59": minutes and seconds, for the countdown. */
export const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

/**
 * The demo's state and the one thing a visitor can do with it: answer the request. The card goes, the numbers and Activity change,
 * and nothing new comes. The request counts down once a second and lapses at 0:00 if nobody answers.
 */
export function useDemo(exactOf: (id: DemoId) => string) {
  const [s, dispatch] = useReducer(reducer, undefined, initial);

  const counting = s.waiting.length > 0;
  useEffect(() => {
    if (!counting) return;
    const id = window.setInterval(() => dispatch({ type: "tick" }), 1000);
    return () => clearInterval(id);
  }, [counting]);

  const lapsed = s.waiting[0]?.left === 0;
  useEffect(() => {
    if (lapsed) dispatch({ type: "decide", decision: "expired", time: clockNow(), detail: exactOf(REQUEST.id) });
  }, [lapsed, exactOf]);

  const toastId = s.toast?.id;
  useEffect(() => {
    if (toastId === undefined) return;
    const id = window.setTimeout(() => dispatch({ type: "clearToast", id: toastId }), 3200);
    return () => clearTimeout(id);
  }, [toastId]);

  const decide = useCallback((_id: DemoId, decision: "allowed" | "denied") => dispatch({ type: "decide", decision, time: clockNow(), detail: exactOf(REQUEST.id) }), [exactOf]);

  return { ...s, done: s.waiting.length === 0, decide };
}

export type Demo = ReturnType<typeof useDemo>;
