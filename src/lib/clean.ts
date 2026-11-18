// Text an agent writes reaches a person (and the database) later. Characters that can break a query or make text render
// differently from what it is are removed on the way in: NUL and other control characters (newline and tab stay), the
// bidirectional override and isolate characters that can reverse what a person reads, and characters that render as nothing or
// as a blank and can carry hidden text or make two different names look the same (zero-width space, word joiner, soft hyphen,
// the Hangul fillers, the braille blank, byte-order mark, the invisible "tag" characters and variation selectors). The zero-width
// joiner and non-joiner stay (U+200C, U+200D), so emoji and scripts that need them are unharmed. Kept in step with INVISIBLE in
// src/server/policy.ts, which rejects (rather than strips) the same characters in the fields a person approves.
const hex = (n: number) => `\\u{${n.toString(16)}}`;
const BAD = new RegExp(`[${[
  [0x00, 0x08], [0x0b, 0x0c], [0x0e, 0x1f], [0x7f, 0x9f], [0xad, 0xad], [0x34f, 0x34f], [0x61c, 0x61c], [0x115f, 0x1160], [0x180e, 0x180e],
  [0x200b, 0x200b], [0x200e, 0x200f], [0x202a, 0x202e], [0x2060, 0x206f], [0x2800, 0x2800], [0x3164, 0x3164], [0xfeff, 0xfeff], [0xffa0, 0xffa0],
  [0xfff9, 0xfffb], [0xe0000, 0xe007f], [0xe0100, 0xe01ef],
].map(([a, b]) => (a === b ? hex(a) : `${hex(a)}-${hex(b)}`)).join("")}]`, "gu");

export const cleanText = (s: string) => s.replace(BAD, "");
