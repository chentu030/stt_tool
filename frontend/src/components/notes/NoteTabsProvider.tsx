"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  closeNoteTab,
  loadNoteTabs,
  nextTabAfterClose,
  openNoteTab,
  placeTabBeside,
  reorderNoteTabs,
  saveNoteTabs,
  type NoteTabsState,
} from "@/lib/noteTabs";

type Ctx = {
  openIds: string[];
  splitId: string | null;
  activeId: string | null;
  open: (id: string) => void;
  close: (id: string) => void;
  /** Optional href: specialty pages use /canvas|/graph|/board|/db instead of /notes. */
  activate: (id: string, href?: string) => void;
  setSplit: (id: string | null) => void;
  toggleSplitWith: (id: string) => void;
  reorder: (fromId: string, toId: string) => void;
};

const NoteTabsContext = createContext<Ctx | null>(null);

export function useNoteTabs() {
  const ctx = useContext(NoteTabsContext);
  if (!ctx) throw new Error("useNoteTabs requires NoteTabsProvider");
  return ctx;
}

export function useNoteTabsOptional() {
  return useContext(NoteTabsContext);
}

function noteIdFromPath(pathname: string, noteQuery: string | null): string | null {
  const notes = pathname.match(/^\/notes\/([^/?#]+)/);
  if (notes) return decodeURIComponent(notes[1]);
  const web = pathname.match(/^\/web\/([^/?#]+)/);
  if (web) return decodeURIComponent(web[1]);
  if (
    noteQuery &&
    /^\/(canvas|graph|board|db|web)\/[^/]+/.test(pathname)
  ) {
    return noteQuery;
  }
  return null;
}

export default function NoteTabsProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeId = noteIdFromPath(pathname, searchParams.get("note"));
  const [state, setState] = useState<NoteTabsState>({ openIds: [], splitId: null });
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const loaded = loadNoteTabs();
    const splitFromUrl = searchParams.get("split");
    setState({
      openIds: loaded.openIds,
      splitId: splitFromUrl || loaded.splitId,
    });
    setHydrated(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!hydrated || !activeId) return;
    setState((prev) => {
      const next = openNoteTab(prev, activeId);
      if (next.openIds === prev.openIds) return prev;
      return next;
    });
  }, [activeId, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    saveNoteTabs(state);
  }, [state, hydrated]);

  // Split is tied to the current primary note. Any navigation to a different note
  // (sidebar link, browser back, specialty route) must drop a stale secondary —
  // otherwise 「並排」sticks onto an unrelated tab.
  const prevActiveRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    if (!pathname.startsWith("/notes/")) {
      prevActiveRef.current = activeId;
      setState((prev) => (prev.splitId ? { ...prev, splitId: null } : prev));
      return;
    }
    const prevActive = prevActiveRef.current;
    prevActiveRef.current = activeId;
    if (!activeId || prevActive == null || prevActive === activeId) return;
    setState((prev) => (prev.splitId ? { ...prev, splitId: null } : prev));
  }, [activeId, pathname, hydrated]);

  // Sync split query param on note routes only (specialty apps use their own URLs).
  useEffect(() => {
    if (!hydrated || !activeId) return;
    if (!pathname.startsWith("/notes/")) return;
    const cur = searchParams.get("split");
    const want = state.splitId;
    if ((cur || null) === (want || null)) return;
    const params = new URLSearchParams(window.location.search);
    if (want) params.set("split", want);
    else params.delete("split");
    const qs = params.toString();
    const next = qs ? `/notes/${activeId}?${qs}` : `/notes/${activeId}`;
    window.history.replaceState(window.history.state, "", next);
  }, [state.splitId, activeId, hydrated, pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = useCallback((id: string) => {
    setState((prev) => openNoteTab(prev, id));
  }, []);

  const activate = useCallback(
    (id: string, href?: string) => {
      if (!id) return;
      const target = (href && href.trim()) || `/notes/${id}`;
      const isNotesPath = target.startsWith("/notes/");

      setState((prev) => {
        let next = openNoteTab(prev, id);
        // Split only applies on /notes/* , and only for the current pair.
        // Leaving the pair (or opening a specialty route) must clear — otherwise the
        // 「並排」badge follows onto an unrelated tab via placeTabBeside.
        if (!isNotesPath) {
          return next.splitId ? { ...next, splitId: null } : next;
        }
        const secondary = next.splitId;
        if (!secondary) return next;
        // Clicked the secondary pane → focus it alone
        if (id === secondary) {
          return { ...next, splitId: null };
        }
        // Clicked a third tab → drop split (do not drag secondary along)
        if (activeId && id !== activeId && id !== secondary) {
          return { ...next, splitId: null };
        }
        // Re-activating primary (or first open): keep pair adjacent
        if (secondary !== id) {
          next = {
            ...next,
            openIds: placeTabBeside(next.openIds, id, secondary),
          };
        }
        return next;
      });

      if (!isNotesPath) {
        router.push(target, { scroll: false });
        return;
      }

      // Only keep ?split when staying on the current primary of an existing pair.
      const samePrimaryWithSplit = Boolean(
        activeId && id === activeId && state.splitId && state.splitId !== id
      );
      const urlQs = samePrimaryWithSplit
        ? `?split=${encodeURIComponent(state.splitId!)}`
        : "";

      if (id === activeId) {
        router.replace(`/notes/${id}${urlQs}`, { scroll: false });
        return;
      }
      router.push(`/notes/${id}${urlQs}`, { scroll: false });
    },
    [router, state.splitId, activeId]
  );

  const close = useCallback(
    (id: string) => {
      setState((prev) => {
        const next = closeNoteTab(prev, id);
        // Closing the focused tab ends the split — don't carry secondary onto the next tab
        const cleared =
          activeId === id && next.splitId ? { ...next, splitId: null } : next;
        if (activeId === id) {
          const go = nextTabAfterClose(prev.openIds, id, activeId);
          queueMicrotask(() => {
            if (go) router.push(`/notes/${go}`);
            else router.push("/library");
          });
        }
        return cleared;
      });
    },
    [activeId, router]
  );

  const setSplit = useCallback(
    (id: string | null) => {
      setState((prev) => {
        if (!id) return { ...prev, splitId: null };
        const withOpen = openNoteTab(prev, id);
        const anchor = activeId && activeId !== id ? activeId : withOpen.openIds[0] || id;
        return {
          ...withOpen,
          splitId: id,
          openIds: placeTabBeside(withOpen.openIds, anchor, id),
        };
      });
    },
    [activeId]
  );

  const toggleSplitWith = useCallback(
    (id: string) => {
      setState((prev) => {
        if (prev.splitId === id) return { ...prev, splitId: null };
        const withOpen = openNoteTab(prev, id);
        const anchor = activeId && activeId !== id ? activeId : withOpen.openIds[0] || id;
        return {
          ...withOpen,
          splitId: id,
          openIds: placeTabBeside(withOpen.openIds, anchor, id),
        };
      });
    },
    [activeId]
  );

  const reorder = useCallback((fromId: string, toId: string) => {
    setState((prev) => reorderNoteTabs(prev, fromId, toId));
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      openIds: state.openIds,
      splitId: state.splitId,
      activeId,
      open,
      close,
      activate,
      setSplit,
      toggleSplitWith,
      reorder,
    }),
    [state.openIds, state.splitId, activeId, open, close, activate, setSplit, toggleSplitWith, reorder]
  );

  return <NoteTabsContext.Provider value={value}>{children}</NoteTabsContext.Provider>;
}
