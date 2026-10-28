// The Content-Security-Policy TEND sends. Pure and dependency-free so the proxy and the tests share it.
//
// Scripts: only Next's own, carrying this request's nonce ('strict-dynamic' lets those load their chunks). No 'unsafe-inline', no 'unsafe-eval' in
// production, so an injected <script> or an inline event handler does not run even if some page ever reflects attacker text. Styles may be
// inline (the toast library and React inject <style> elements and style attributes at runtime; a nonce would make browsers ignore
// 'unsafe-inline', so styles carry none): CSS cannot run script. Nothing may frame the app, load plugins,
// change the base URL, or post a form anywhere but here. Reports are not collected (a public report endpoint would be one more unauthenticated
// write path); violations show in the browser console, which the real-browser test reads.
export type CspMode = "enforce" | "report" | "off";

/** TEND_CSP=report sends the policy as Report-Only (it blocks nothing, the browser console lists what it would block); off sends none. */
export const cspMode = (v = process.env.TEND_CSP): CspMode => (v === "report" || v === "off" ? v : "enforce");

export function buildCsp({ nonce, dev = false }: { nonce: string; dev?: boolean }) {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  return directives.join("; ");
}

/** A fresh, unguessable value for each request (128 random bits). */
export function newNonce() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b));
}
