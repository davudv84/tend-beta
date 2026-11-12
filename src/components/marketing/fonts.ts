import { Newsreader } from "next/font/google";

/** The homepage's serif for headings: light and high-contrast, one weight. Loaded only there; the app keeps Geist. */
export const newsreader = Newsreader({ subsets: ["latin"], weight: "300", variable: "--font-newsreader", display: "swap", preload: false });
