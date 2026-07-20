"use client";

import { useEffect, useState, type MouseEvent } from "react";
import { flushSync } from "react-dom";
import { usePrefsOptional } from "@/components/PrefsProvider";
import { applyPrefsToDocument, resolveTheme, type ThemeMode } from "@/lib/userPrefs";

type Props = {
  className?: string;
};

type ViewTransition = {
  ready: Promise<void>;
  finished: Promise<void>;
};

function startThemeTransition(update: () => void): ViewTransition | null {
  const doc = document as Document & {
    startViewTransition?: (cb: () => void) => ViewTransition;
  };
  if (typeof doc.startViewTransition !== "function") return null;
  return doc.startViewTransition(update);
}

export default function ThemeToggle({ className }: Props) {
  const prefsCtx = usePrefsOptional();
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    if (prefsCtx) {
      setTheme(prefsCtx.resolvedTheme);
      return;
    }
    const saved = localStorage.getItem("theme") as "light" | "dark" | null;
    if (saved) {
      setTheme(saved);
      document.documentElement.setAttribute("data-theme", saved);
    } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
      setTheme("dark");
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.setAttribute("data-theme", "light");
    }
  }, [prefsCtx, prefsCtx?.resolvedTheme]);

  const applyTheme = (next: "light" | "dark") => {
    if (prefsCtx) {
      const mode: ThemeMode = next;
      flushSync(() => {
        prefsCtx.setPrefs({ theme: mode });
        setTheme(next);
      });
      applyPrefsToDocument({ ...prefsCtx.prefs, theme: mode });
      return;
    }
    flushSync(() => setTheme(next));
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
  };

  const toggleTheme = async (e: MouseEvent<HTMLButtonElement>) => {
    const next: "light" | "dark" = theme === "light" ? "dark" : "light";
    const reduceMotion =
      prefsCtx?.prefs.reduceMotion ||
      document.documentElement.getAttribute("data-reduce-motion") === "1" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduceMotion) {
      applyTheme(next);
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y)
    );

    const root = document.documentElement;
    root.setAttribute("data-theme-transition", next === "light" ? "to-light" : "to-dark");

    const transition = startThemeTransition(() => {
      applyTheme(next);
    });

    if (!transition) {
      applyTheme(next);
      root.removeAttribute("data-theme-transition");
      return;
    }

    try {
      await transition.ready;
      root.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${endRadius}px at ${x}px ${y}px)`,
          ],
        },
        {
          duration: 580,
          easing: "cubic-bezier(0.4, 0, 0.2, 1)",
          pseudoElement: "::view-transition-new(root)",
        }
      );
      await transition.finished;
    } catch {
      /* transition aborted */
    } finally {
      root.removeAttribute("data-theme-transition");
    }
  };

  return (
    <button
      type="button"
      className={`theme-toggle${className ? ` ${className}` : ""}`}
      onClick={(e) => void toggleTheme(e)}
      aria-label="切換深淺色"
      title={theme === "light" ? "切換深色" : "切換淺色"}
    >
      {theme === "light" ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4.5" />
          <path d="M12 2v1.5M12 20.5V22M4.2 4.2l1.1 1.1M18.7 18.7l1.1 1.1M2 12h1.5M20.5 12H22M4.2 19.8l1.1-1.1M18.7 5.3l1.1-1.1" />
        </svg>
      )}
    </button>
  );
}
