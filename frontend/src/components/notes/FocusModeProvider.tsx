"use client";

/**
 * Deep-focus mode: toggling adds `is-focus-team` on <html>, which CSS uses to hide
 * chat noise / presence dots / thread panels (`.tm-noise`, `.note-presence`, `.block-thread`).
 */

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

type FocusModeCtx = {
  focusMode: boolean;
  toggleFocusMode: () => void;
  setFocusMode: (v: boolean) => void;
};

const Ctx = createContext<FocusModeCtx | null>(null);

export function FocusModeProvider({ children }: { children: ReactNode }) {
  const [focusMode, setFocusModeState] = useState(false);

  useEffect(() => {
    document.documentElement.classList.toggle("is-focus-team", focusMode);
    return () => {
      document.documentElement.classList.remove("is-focus-team");
    };
  }, [focusMode]);

  const setFocusMode = useCallback((v: boolean) => setFocusModeState(v), []);
  const toggleFocusMode = useCallback(() => setFocusModeState((v) => !v), []);

  return <Ctx.Provider value={{ focusMode, toggleFocusMode, setFocusMode }}>{children}</Ctx.Provider>;
}

export function useFocusMode(): FocusModeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("useFocusMode must be used within a FocusModeProvider");
  }
  return ctx;
}

export function useFocusModeOptional(): FocusModeCtx | null {
  return useContext(Ctx);
}
