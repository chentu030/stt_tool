/** Session open-note tabs (browser-like) — persisted in sessionStorage */

const KEY = "cadence_note_tabs_v1";
const MAX = 16;

export type NoteTabsState = {
  openIds: string[];
  /** Secondary pane note id for side-by-side */
  splitId: string | null;
};

export function loadNoteTabs(): NoteTabsState {
  if (typeof window === "undefined") return { openIds: [], splitId: null };
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return { openIds: [], splitId: null };
    const parsed = JSON.parse(raw) as Partial<NoteTabsState>;
    const openIds = Array.isArray(parsed.openIds)
      ? parsed.openIds.filter((x) => typeof x === "string").slice(0, MAX)
      : [];
    const splitId =
      typeof parsed.splitId === "string" && openIds.includes(parsed.splitId)
        ? parsed.splitId
        : typeof parsed.splitId === "string"
          ? parsed.splitId
          : null;
    return { openIds, splitId };
  } catch {
    return { openIds: [], splitId: null };
  }
}

export function saveNoteTabs(state: NoteTabsState) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({
        openIds: state.openIds.slice(0, MAX),
        splitId: state.splitId,
      })
    );
  } catch {
    /* ignore */
  }
}

export function openNoteTab(state: NoteTabsState, id: string): NoteTabsState {
  if (!id) return state;
  if (state.openIds.includes(id)) return state;
  return { ...state, openIds: [...state.openIds, id].slice(-MAX) };
}

export function closeNoteTab(state: NoteTabsState, id: string): NoteTabsState {
  const openIds = state.openIds.filter((x) => x !== id);
  const splitId = state.splitId === id ? null : state.splitId;
  return { openIds, splitId };
}

/** Move `moveId` to sit immediately after `anchorId` (keeps split pair together). */
export function placeTabBeside(openIds: string[], anchorId: string, moveId: string): string[] {
  if (!anchorId || !moveId || anchorId === moveId) return openIds;
  const base = openIds.includes(moveId) ? openIds : [...openIds, moveId];
  const without = base.filter((id) => id !== moveId);
  const i = without.indexOf(anchorId);
  if (i < 0) return [...without, moveId].slice(0, MAX);
  const next = [...without];
  next.splice(i + 1, 0, moveId);
  return next.slice(0, MAX);
}

/** Drag-reorder: place `fromId` where `toId` currently is. */
export function reorderNoteTabs(
  state: NoteTabsState,
  fromId: string,
  toId: string
): NoteTabsState {
  if (!fromId || !toId || fromId === toId) return state;
  const from = state.openIds.indexOf(fromId);
  const to = state.openIds.indexOf(toId);
  if (from < 0 || to < 0) return state;
  const openIds = [...state.openIds];
  openIds.splice(from, 1);
  openIds.splice(to, 0, fromId);
  return { ...state, openIds };
}

export function nextTabAfterClose(
  openIds: string[],
  closedId: string,
  activeId: string
): string | null {
  if (closedId !== activeId) return activeId;
  const idx = openIds.indexOf(closedId);
  const remaining = openIds.filter((x) => x !== closedId);
  if (!remaining.length) return null;
  if (idx <= 0) return remaining[0];
  return remaining[Math.min(idx - 1, remaining.length - 1)];
}
