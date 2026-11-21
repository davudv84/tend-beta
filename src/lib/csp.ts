// The Content-Security-Policy TEND sends. Pure and dependency-free so the proxy and the tests share it.
//
// Scripts: only Next's own, carrying this request's nonce ('strict-dynamic' lets those load their chunks). No 'unsafe-inline', no 'unsafe-eval' in
// production, so an injected <script> or an inline event handler does not run even if some page ever reflects attacker text. Style elements
// need the nonce too; only style attributes may be inline (React renders them on the server). Nothing may frame the app, load plugins,
// change the base URL, or post a form anywhere but here. Reports are not collected (a public report endpoint would be one more unauthenticated
// write path); violations show in the browser console, which the real-browser test reads.
export type CspMode = "enforce" | "report" | "off";

/** TEND_CSP=report sends the policy as Report-Only (it blocks nothing, the browser console lists what it would block); off sends none. */
export const cspMode = (v = process.env.TEND_CSP): CspMode => (v === "report" || v === "off" ? v : "enforce");

/**
 * The only inline style elements allowed by content: the toast library (sonner 2.0.8) inserts its CSS as a <style> element at load time,
 * without a nonce, first empty and then filled. Their SHA-256 hashes, so nothing else inline is allowed. csp.test.ts recomputes the
 * library's hash from node_modules: after an upgrade it fails until this is updated (until then toasts are unstyled, nothing else changes).
 */
export const STYLE_HASHES = ["'sha256-StEaX+se6YS7pqjzrzMIA0KaX9zF/8zAhvQXZAe5epY='", "'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='"];

export function buildCsp({ nonce, dev = false }: { nonce: string; dev?: boolean }) {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // <style> and <link> elements: this request's nonce only (Next stamps it on the styles it renders). style="" attributes, which React
    // renders on the server, stay allowed: an attribute cannot load anything or run script (style-src-attr, CSP level 3).
    `style-src 'self' 'nonce-${nonce}' ${STYLE_HASHES.join(" ")}`,
    `style-src-elem 'self' 'nonce-${nonce}' ${STYLE_HASHES.join(" ")}`,
    "style-src-attr 'unsafe-inline'",
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
