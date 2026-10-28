"use client";

// The client half of the display preferences: holds what the server read from the cookie and writes the cookie when it changes.
// The pure parsing lives in prefs.ts so server code (the layout) can import it without pulling in React state.
import { createContext, useCallback, useContext, useState } from "react";
import { DEFAULT_PREFS, PREFS_COOKIE, type UiPrefs } from "@/ui/prefs";

type Ctx = [UiPrefs, (patch: Partial<UiPrefs>) => void];
const PrefsCtx = createContext<Ctx>([DEFAULT_PREFS, () => {}]);

export function UiPrefsProvider({ initial, children }: { initial: UiPrefs; children: React.ReactNode }) {
  const [prefs, setPrefs] = useState(initial);
  const set = useCallback((patch: Partial<UiPrefs>) => {
    const next = { ...prefs, ...patch };
    document.cookie = `${PREFS_COOKIE}=${encodeURIComponent(JSON.stringify(next))}; path=/; max-age=31536000; samesite=lax`;
    setPrefs(next);
  }, [prefs]);
  return <PrefsCtx.Provider value={[prefs, set]}>{children}</PrefsCtx.Provider>;
}

export const useUiPrefs = () => useContext(PrefsCtx);
