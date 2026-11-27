// Lets the scroll lock of dialogs, sheets, menus and selects work under TEND's Content-Security-Policy (src/lib/csp.ts).
//
// While one of them is open, react-remove-scroll (used by Radix) adds a <style> element that stops the page behind it from scrolling. Its
// content depends on the browser's scrollbar width, so it cannot be allowed by hash; it needs the request's nonce. The library takes the
// nonce from get-nonce, so this hands it the nonce Next already stamped on its own scripts in this page. It reads it from the page, the
// same place any script that runs here could; nothing is added to the HTML or the RSC payload, and the policy itself is unchanged.
// Imported first by components/providers.tsx, which every page renders.
import { setNonce } from "get-nonce";

export function pageNonce(doc: Pick<Document, "querySelector"> | undefined = typeof document === "undefined" ? undefined : document): string | undefined {
  const n = doc?.querySelector<HTMLScriptElement>("script[nonce]")?.nonce;
  return n || undefined;
}

const nonce = pageNonce();
if (nonce) setNonce(nonce);
