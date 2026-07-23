"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/components/AuthProvider";
import { listenToUserNotes, type Note } from "@/lib/firebase";

/** Sidebar / tabs / command palette — metadata without retaining huge bodies in derived views. */
export type NoteSummary = Omit<Note, "body_md" | "deck"> & {
  body_md: "";
  snippet: string;
};

type NotesListValue = {
  notes: Note[];
  ready: boolean;
};

const NotesListContext = createContext<NotesListValue>({
  notes: [],
  ready: false,
});

/**
 * Single shared onSnapshot for the signed-in user's notes.
 * Prefer this over mounting listenToUserNotes in every shell widget.
 */
export function NotesListProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!user) {
      setNotes([]);
      setReady(true);
      return;
    }
    setReady(false);
    return listenToUserNotes(user.uid, (next) => {
      setNotes(next);
      setReady(true);
    });
  }, [user]);

  const value = useMemo(() => ({ notes, ready }), [notes, ready]);
  return <NotesListContext.Provider value={value}>{children}</NotesListContext.Provider>;
}

export function useNotesList(): NotesListValue {
  return useContext(NotesListContext);
}

export function useNoteSummaries(): NoteSummary[] {
  const { notes } = useNotesList();
  return useMemo(
    () =>
      notes.map((n) => {
        const { body_md: body, deck: _deck, ...rest } = n;
        const snippet = (body || "").replace(/\s+/g, " ").trim().slice(0, 160);
        return {
          ...rest,
          body_md: "" as const,
          snippet,
        };
      }),
    [notes]
  );
}
