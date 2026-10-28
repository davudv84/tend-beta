// Text an agent writes reaches a person (and the database) later. Characters that can break a query or make text render
// differently from what it is are removed on the way in: NUL and other control characters (newline and tab stay), and the
// bidirectional override and isolate characters that can reverse what a person reads. Joiners stay, so emoji and scripts
// that need them are unharmed.
const BAD = new RegExp(`[${[
  [0x00, 0x08], [0x0b, 0x0c], [0x0e, 0x1f], [0x7f, 0x9f], [0x200e, 0x200f], [0x202a, 0x202e], [0x2066, 0x2069],
].map(([a, b]) => `\\u${a.toString(16).padStart(4, "0")}-\\u${b.toString(16).padStart(4, "0")}`).join("")}]`, "g");

export const cleanText = (s: string) => s.replace(BAD, "");
