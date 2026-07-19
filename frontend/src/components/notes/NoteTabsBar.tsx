"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { listenToUserNotes, type Note } from "@/lib/firebase";
import { useNoteTabs } from "@/components/notes/NoteTabsProvider";
import { askPrompt } from "@/lib/dialogs";

export default function NoteTabsBar() {
  const { user } = useAuth();
  const { openIds, activeId, splitId, activate, close, setSplit, toggleSplitWith } = useNoteTabs();
  const [notes, setNotes] = useState<Note[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    return listenToUserNotes(user.uid, setNotes);
  }, [user]);

  const byId = useMemo(() => {
    const m = new Map<string, Note>();
    notes.forEach((n) => m.set(n.id, n));
    return m;
  }, [notes]);

  if (!openIds.length) return null;

  return (
    <div className="note-tabs" role="tablist" aria-label="開啟的筆記">
      <div className="note-tabs-scroll">
        {openIds.map((id) => {
          const n = byId.get(id);
          const title = n ? `${n.icon ? `${n.icon} ` : ""}${n.title || "未命名"}` : "載入中…";
          const isActive = id === activeId;
          const isSplit = id === splitId;
          return (
            <div
              key={id}
              className={`note-tab${isActive ? " is-active" : ""}${isSplit ? " is-split" : ""}`}
              role="tab"
              aria-selected={isActive}
            >
              <button
                type="button"
                className="note-tab-main"
                title={title}
                onClick={() => activate(id)}
                onDoubleClick={() => {
                  if (activeId && id !== activeId) toggleSplitWith(id);
                }}
              >
                <span className="note-tab-title">{title}</span>
                {isSplit && <span className="note-tab-badge">並排</span>}
              </button>
              <button
                type="button"
                className="note-tab-close"
                title="關閉"
                aria-label={`關閉 ${title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  close(id);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>

      <div className="note-tabs-actions">
        <div className="note-tabs-split-wrap">
          <button
            type="button"
            className={`note-tabs-action${splitId ? " is-on" : ""}`}
            title="雙頁並排（或雙擊另一個分頁）"
            onClick={() => setMenuOpen((v) => !v)}
          >
            {splitId ? "並排中" : "並排"}
          </button>
          {menuOpen && (
            <div className="note-tabs-menu">
              {splitId && (
                <button
                  type="button"
                  onClick={() => {
                    setSplit(null);
                    setMenuOpen(false);
                  }}
                >
                  關閉並排
                </button>
              )}
              <p className="note-tabs-menu-label">右側開啟</p>
              {openIds
                .filter((id) => id !== activeId)
                .map((id) => {
                  const n = byId.get(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      className={id === splitId ? "is-on" : ""}
                      onClick={() => {
                        setSplit(id);
                        setMenuOpen(false);
                      }}
                    >
                      {n ? `${n.icon ? `${n.icon} ` : ""}${n.title || "未命名"}` : id.slice(0, 8)}
                    </button>
                  );
                })}
              {openIds.filter((id) => id !== activeId).length === 0 && (
                <p className="note-tabs-menu-empty">先再開一個筆記分頁</p>
              )}
              <button
                type="button"
                onClick={() => {
                  void (async () => {
                    const raw = await askPrompt({
                      title: "並排筆記",
                      message: "貼上筆記 ID，或從已開啟分頁選擇",
                      placeholder: "note id",
                    });
                    const id = raw?.trim();
                    if (id) {
                      setSplit(id);
                      setMenuOpen(false);
                    }
                  })();
                }}
              >
                用 ID 開啟…
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
