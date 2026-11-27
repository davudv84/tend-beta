import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_THEME, parseThemePref } from "./theme.ts";

test("the theme cookie: three known values, anything else is the default", () => {
  for (const v of ["light", "dark", "system"]) assert.equal(parseThemePref(v), v);
  for (const v of [undefined, null, "", "Dark", "black", "dark; path=/", "<script>"]) assert.equal(parseThemePref(v), DEFAULT_THEME);
});
