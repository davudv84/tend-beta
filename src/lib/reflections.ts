import type { CheckIn } from "./types";

/** A check-in's reflection number within its agent's journal, e.g. "024". */
export function reflectionNumber(checkIns: CheckIn[], c: CheckIn) {
  let n = 0;
  for (const x of checkIns) if (x.agentId === c.agentId && x.reflection && x.createdAt <= c.createdAt) n++;
  return String(n).padStart(3, "0");
}

/** Every check-in that carries a reflection, newest first, with its per-agent number. */
export function journal(checkIns: CheckIn[]) {
  const count = new Map<string, number>();
  const out: { checkIn: CheckIn; number: string }[] = [];
  for (let i = checkIns.length - 1; i >= 0; i--) {
    const c = checkIns[i];
    if (!c.reflection) continue;
    const n = (count.get(c.agentId) ?? 0) + 1;
    count.set(c.agentId, n);
    out.push({ checkIn: c, number: String(n).padStart(3, "0") });
  }
  return out.reverse();
}
