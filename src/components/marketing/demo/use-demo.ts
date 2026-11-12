"use client";

import { useCallback, useEffect, useReducer } from "react";
import type { Outcome } from "@/lib/activity";
import { ACTIVITY, INVOICE_REQUEST, type DemoDecision } from "../demo-data";

// The hero's interactive demo: one invented request, the four numbers, the activity list and a short countdown, all in the browser.
// Nothing is sent anywhere. The visitor answers it once, and that is the end of it. The desktop window and the phone card both read
// this one state, so they can never disagree.

export type DemoId = "invoice";

/** The one request that waits when the demo opens: the app's own shape (demo-data.ts), lapsing in eight minutes. */
export const REQUEST = INVOICE_REQUEST;
const SECONDS = REQUEST.lapsesInMinutes * 60;

export interface Waiting {
  request: typeof REQUEST;
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
  /** The steps it took, when more than one: the app folds an action into one row ("Needs approval → Approved"). */
  path?: Outcome[];
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

type Action = { type: "decide"; decision: Decision } | { type: "tick" } | { type: "clearToast"; id: number };

const initial = (): State => ({
  waiting: [{ request: REQUEST, left: SECONDS }],
  auto: 14,
  blocked: 2,
  activity: ACTIVITY.map((d, i) => ({ key: `history-${i}`, time: d.time, agent: d.agent.name, detail: d.detail, action: `${d.tool}.${d.action}`, outcome: d.outcome, path: d.path, reason: { kind: "history", decision: d } })),
  toast: null,
  announce: null,
});

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "decide": {
      if (!s.waiting.length) return s;
      // The waiting request's own row in Activity (the first) now ends the way it was decided, as the app folds one action into one
      // row with its path. A person's yes doesn't count as "allowed without asking you"; a no counts as blocked; a lapse as neither.
      const outcome: Outcome = a.decision === "allowed" ? "approved" : a.decision === "denied" ? "rejected" : "expired";
      const [first, ...rest] = s.activity;
      return {
        ...s,
        waiting: [],
        blocked: s.blocked + (a.decision === "denied" ? 1 : 0),
        activity: [{ ...first, outcome, path: ["needs_approval", outcome], reason: { kind: a.decision } }, ...rest],
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

/** Whole minutes left, as the app counts them ("Expires in 8 min"). */
export const minutesLeft = (sec: number) => Math.max(1, Math.ceil(sec / 60));

/**
 * The demo's state and the one thing a visitor can do with it: answer the request. The card goes, the numbers and Activity change,
 * and nothing new comes. The request counts down once a second and lapses at 0:00 if nobody answers.
 */
export function useDemo() {
  const [s, dispatch] = useReducer(reducer, undefined, initial);

  const counting = s.waiting.length > 0;
  useEffect(() => {
    if (!counting) return;
    const id = window.setInterval(() => dispatch({ type: "tick" }), 1000);
    return () => clearInterval(id);
  }, [counting]);

  const lapsed = s.waiting[0]?.left === 0;
  useEffect(() => {
    if (lapsed) dispatch({ type: "decide", decision: "expired" });
  }, [lapsed]);

  const toastId = s.toast?.id;
  useEffect(() => {
    if (toastId === undefined) return;
    const id = window.setTimeout(() => dispatch({ type: "clearToast", id: toastId }), 3200);
    return () => clearTimeout(id);
  }, [toastId]);

  const decide = useCallback((_id: string, decision: "allowed" | "denied") => dispatch({ type: "decide", decision }), []);

  return { ...s, done: s.waiting.length === 0, decide };
}

export type Demo = ReturnType<typeof useDemo>;
