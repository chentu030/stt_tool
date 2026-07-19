"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { createNote, listenToUserNotes, loginWithGoogle, Note } from "@/lib/firebase";
import { NOTE_TEMPLATES, journalTitle } from "@/lib/templates";
import ScrambleText from "@/components/motion/ScrambleText";
import ShinyPill from "@/components/motion/ShinyPill";

export default function JournalPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [notes, setNotes] = useState<Note[]>([]);
  const [busy, setBusy] = useState(false);
  const today = journalTitle();

  useEffect(() => {
    if (!user) return;
    return listenToUserNotes(user.uid, setNotes);
  }, [user]);

  const journals = useMemo(
    () => notes
      .filter((n) => n.journal_date || (n.tags || []).includes("journal") || /^\d{4}-\d{2}-\d{2}$/.test(n.title))
      .sort((a, b) => (b.journal_date || b.title).localeCompare(a.journal_date || a.title)),
    [notes]
  );

  const todayNote = journals.find((n) => n.journal_date === today || n.title === today);

  const openToday = async () => {
    if (!user || busy) return;
    if (todayNote) {
      router.push(`/notes/${todayNote.id}`);
      return;
    }
    setBusy(true);
    try {
      const t = NOTE_TEMPLATES.find((x) => x.id === "daily")!;
      const id = await createNote(user.uid, today, t.body, undefined, t.tags, { journal_date: today });
      router.push(`/notes/${id}`);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <p style={{ color: "var(--text-muted)" }}>載入中…</p>;
  if (!user) {
    return (
      <div style={{ textAlign: "center", padding: "3rem 1rem" }}>
        <ScrambleText words="Journal" as="h1" className="page-title font-display" />
        <p className="page-sub">登入後開始每日筆記。</p>
        <ShinyPill onClick={() => loginWithGoogle()}>登入</ShinyPill>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <ScrambleText words="Journal" as="h1" className="page-title font-display" />
      <p className="page-sub">Heptabase／Obsidian 風格的每日卡片。今天是 {today}。</p>

      <ShinyPill onClick={() => { void openToday(); }} disabled={busy}>
        {busy ? "開啟中…" : todayNote ? "打開今日日誌" : "建立今日日誌"}
      </ShinyPill>

      <section style={{ marginTop: "1.5rem" }}>
        <h2 className="font-display" style={{ fontSize: "1.05rem", marginBottom: "0.7rem" }}>過往日誌</h2>
        {journals.length === 0 ? (
          <p style={{ color: "var(--text-muted)" }}>尚無日誌。</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
            {journals.map((n) => (
              <Link key={n.id} href={`/notes/${n.id}`} className="card" style={{ padding: "0.85rem 1rem", display: "block" }}>
                <div style={{ fontWeight: 650 }}>{n.title}</div>
                <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: 4 }}>
                  {n.updated_at.toLocaleString("zh-TW")}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
