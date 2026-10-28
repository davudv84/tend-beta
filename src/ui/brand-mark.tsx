/**
 * The TEND mark: an open frame (the gateway's boundary) with one square (a request) passing through the opening. It is
 * built from three straight strokes so it holds up at 16px, and it reads without the wordmark.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <path d="M19 4.5H5.5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1H19" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
      <rect x="9" y="9" width="6" height="6" fill="currentColor" />
      <path d="M15 12h7" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
