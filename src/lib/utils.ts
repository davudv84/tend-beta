import { createCn } from "cn/config";

/** Class merging that knows Tend's type scale, so a size token and a colour never cancel each other. */
export const cn = createCn({
  extend: { classGroups: { "font-size": [{ text: ["meta", "caption", "small", "body", "ui", "lead", "title", "h2", "display", "section", "headline", "figure", "quote", "quote-lg"] }] } },
});

/** Standard page container; the Sanctuary opts out to go full-bleed. */
/** The one column every screen sits in (the same as `Page`, but wider where a screen holds tables or code). */
export const CONTAINER = "mx-auto w-full max-w-[1180px] px-6 pt-10 pb-24 md:px-12 md:pt-14";
