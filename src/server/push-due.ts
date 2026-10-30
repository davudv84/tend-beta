// A flag between the transaction that queues a browser notification and the request wrapper that delivers queued ones after the response.
// No imports, so the database, the request wrapper and the notification module can all reach it without an import cycle. It is only a
// hint: delivery reads the queue from the database, so a flag taken by another request in the same instance loses nothing.
let due = false;
export const markPushDue = () => { due = true; };
export const takePushDue = () => { const d = due; due = false; return d; };
