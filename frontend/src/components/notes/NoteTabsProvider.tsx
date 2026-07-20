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
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  closeNoteTab,
  loadNoteTabs,
  nextTabAfterClose,
  openNoteTab,
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
  const m = pathname.match(/^\/notes\/([^/?#]+)/);
  if (m) return decodeURIComponent(m[1]);
  if (
    noteQuery &&
    /^\/(canvas|graph|board|db)\/[^/]+/.test(pathname)
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

  // Sync split query param without App Router soft-nav (avoids wedging Link/router.push).
  useEffect(() => {
    if (!hydrated || !activeId) return;
    const cur = searchParams.get("split");
    const want = state.splitId;
    if ((cur || null) === (want || null)) return;
    const params = new URLSearchParams(window.location.search);
    if (want) params.set("split", want);
    else params.delete("split");
    const qs = params.toString();
    const next = qs ? `/notes/${activeId}?${qs}` : `/notes/${activeId}`;
    window.history.replaceState(window.history.state, "", next);
  }, [state.splitId, activeId, hydrated]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = useCallback((id: string) => {
    setState((prev) => openNoteTab(prev, id));
  }, []);

  const activate = useCallback(
    (id: string, href?: string) => {
      if (!id) return;
      setState((prev) => openNoteTab(prev, id));
      const split = state.splitId;
      const target = (href && href.trim()) || `/notes/${id}`;
      const isNotesPath = target.startsWith("/notes/");
      if (!isNotesPath) {
        router.push(target, { scroll: false });
        return;
      }
      const qs = split && split !== id ? `?split=${encodeURIComponent(split)}` : "";
      if (id === activeId) {
        router.replace(`/notes/${id}${qs}`, { scroll: false });
        return;
      }
      router.push(`/notes/${id}${qs}`, { scroll: false });
    },
    [router, state.splitId, activeId]
  );

  const close = useCallback(
    (id: string) => {
      setState((prev) => {
        const next = closeNoteTab(prev, id);
        if (activeId === id) {
          const go = nextTabAfterClose(prev.openIds, id, activeId);
          queueMicrotask(() => {
            if (go) {
              const qs =
                next.splitId && next.splitId !== go
                  ? `?split=${encodeURIComponent(next.splitId)}`
                  : "";
              router.push(`/notes/${go}${qs}`);
            } else {
              router.push("/library");
            }
          });
        }
        return next;
      });
    },
    [activeId, router]
  );

  const setSplit = useCallback((id: string | null) => {
    setState((prev) => ({
      ...prev,
      splitId: id,
      openIds: id ? openNoteTab(prev, id).openIds : prev.openIds,
    }));
  }, []);

  const toggleSplitWith = useCallback(
    (id: string) => {
      setState((prev) => {
        if (prev.splitId === id) return { ...prev, splitId: null };
        return {
          ...openNoteTab(prev, id),
          splitId: id,
        };
      });
    },
    []
  );

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
    }),
    [state.openIds, state.splitId, activeId, open, close, activate, setSplit, toggleSplitWith]
  );

  return <NoteTabsContext.Provider value={value}>{children}</NoteTabsContext.Provider>;
}
