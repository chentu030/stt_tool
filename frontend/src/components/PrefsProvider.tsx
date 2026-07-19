"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  UserPrefs,
  applyPrefsToDocument,
  loadPrefs,
  resolveTheme,
  savePrefs as persistPrefs,
} from "@/lib/userPrefs";

type PrefsCtx = {
  prefs: UserPrefs;
  setPrefs: (patch: Partial<UserPrefs> | ((prev: UserPrefs) => UserPrefs)) => void;
  replacePrefs: (next: UserPrefs) => void;
  resolvedTheme: "light" | "dark";
};

const Ctx = createContext<PrefsCtx | null>(null);

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefsState] = useState<UserPrefs>(() =>
    typeof window === "undefined" ? loadPrefs() : loadPrefs()
  );
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const loaded = loadPrefs();
    setPrefsState(loaded);
    applyPrefsToDocument(loaded);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    applyPrefsToDocument(prefs);
    persistPrefs(prefs);
  }, [prefs, hydrated]);

  useEffect(() => {
    if (prefs.theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyPrefsToDocument(prefs);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [prefs]);

  const setPrefs = useCallback(
    (patch: Partial<UserPrefs> | ((prev: UserPrefs) => UserPrefs)) => {
      setPrefsState((prev) => {
        const next = typeof patch === "function" ? patch(prev) : { ...prev, ...patch };
        return next;
      });
    },
    []
  );

  const replacePrefs = useCallback((next: UserPrefs) => {
    setPrefsState(next);
  }, []);

  const resolvedTheme = useMemo(() => resolveTheme(prefs.theme), [prefs.theme]);

  const value = useMemo(
    () => ({ prefs, setPrefs, replacePrefs, resolvedTheme }),
    [prefs, setPrefs, replacePrefs, resolvedTheme]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePrefs() {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("usePrefs must be used within PrefsProvider");
  }
  return ctx;
}

/** Safe hook for components that may render outside provider during SSR edges */
export function usePrefsOptional(): PrefsCtx | null {
  return useContext(Ctx);
}
