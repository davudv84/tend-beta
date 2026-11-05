import { Newsreader } from "next/font/google";

/** The homepage's serif for headings: light and high-contrast. Loaded only there; the app keeps Geist. */
export const newsreader = Newsreader({ subsets: ["latin"], weight: ["300", "400"], variable: "--font-newsreader", display: "swap" });
