/** The TEND mark, copied from the app (src/ui/brand-mark.tsx): an open frame with one request passing through. */
export const BrandMark: React.FC<{ size: number; color: string }> = ({ size, color }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden>
    <path d="M19 4.5H5.5a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1H19" stroke={color} strokeWidth="2" strokeLinecap="square" />
    <rect x="9" y="9" width="6" height="6" fill={color} />
    <path d="M15 12h7" stroke={color} strokeWidth="2" />
  </svg>
);
