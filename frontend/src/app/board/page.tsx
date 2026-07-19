"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { listenToUserNotes, updateNote, loginWithGoogle, Note } from "@/lib/firebase";
import ScrambleText from "@/components/motion/ScrambleText";
import ShinyPill from "@/components/motion/ShinyPill";

const COLUMNS: { id: NonNullable<Note["status"]> | "backlog"; label: string }[] = [
  { id: "backlog", label: "待辦" },
  { id: "doing", label: "進行中" },
  { id: "done", label: "完成" },
];

function statusOf(n: Note): "backlog" | "doing" | "done" {
  if (n.status === "doing" || n.status === "done") return n.status;
  return "backlog";
}

export default function BoardPage() {
  const { user, loading } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [dragId, setDragId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    return listenToUserNotes(user.uid, setNotes);
  }, [user]);

  const byCol = useMemo(() => {
    const map: Record<string, Note[]> = { backlog: [], doing: [], done: [] };
    for (const n of notes) map[statusOf(n)].push(n);
    return map;
  }, [notes]);

  if (loading) return <p style={{ color: "var(--text-muted)" }}>載入中…</p>;
  if (!user) {
    return (
      <div style={{ textAlign: "center", padding: "3rem 1rem" }}>
        <ScrambleText words="看板" as="h1" className="page-title font-display" />
        <p className="page-sub">登入後使用 Notion 風格看板。</p>
        <ShinyPill onClick={() => loginWithGoogle()}>登入</ShinyPill>
      </div>
    );
  }

  return (
    <div>
      <ScrambleText words="看板" as="h1" className="page-title font-display" />
      <p className="page-sub">拖曳卡片換欄 — 對應 Notion／簡易資料庫狀態檢視。</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "0.85rem" }} className="board-grid">
        {COLUMNS.map((col) => (
          <section
            key={col.id}
            className="card"
            style={{ padding: "0.85rem", minHeight: 360 }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={async () => {
              if (!dragId) return;
              await updateNote(dragId, { status: col.id === "backlog" ? "backlog" : col.id });
              setDragId(null);
            }}
          >
            <h2 className="font-display" style={{ fontSize: "1rem", marginBottom: "0.7rem" }}>
              {col.label}{" "}
              <span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>({byCol[col.id].length})</span>
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {byCol[col.id].map((n) => (
                <div
                  key={n.id}
                  draggable
                  onDragStart={() => setDragId(n.id)}
                  className="surface"
                  style={{ padding: "0.75rem", cursor: "grab" }}
                >
                  <Link href={`/notes/${n.id}`} style={{ fontWeight: 650, display: "block" }}>{n.title}</Link>
                  <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: 4 }}>
                    {(n.tags || []).slice(0, 3).map((t) => `#${t}`).join(" ")}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      <style>{`
        @media (max-width: 900px) {
          .board-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
