// Flags between the transaction that queues a notification (or settles an approval) and the request wrapper that delivers after the
// response. No imports, so the database, the request wrapper and the notification module can all reach it without an import cycle. They are only
// hints: delivery reads the queue and the approval's state from the database, so a flag taken by another request in the same instance loses
// nothing, and one raised by a transaction that was rolled back delivers nothing.
let due = false;
export const markPushDue = () => { due = true; };
export const takePushDue = () => { const d = due; due = false; return d; };

/** Approvals that were just decided, expired or withdrawn, and had a message out (a Telegram message, a browser notification) to update. */
const resolved = new Set<string>();
export const markResolvedDue = (approvalId: string) => { if (resolved.size < 500) resolved.add(approvalId); };
export const takeResolvedDue = () => { const r = [...resolved]; resolved.clear(); return r; };
