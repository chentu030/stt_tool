"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { getNote, updateNote, Note } from "@/lib/firebase";
import BlockEditor from "@/components/BlockEditor";

export default function NotePage() {
  const { id } = useParams<{ id: string }>();
  const { user, loading } = useAuth();
  const [note, setNote] = useState<Note | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!id) return;
    getNote(id).then((n) => {
      if (!n) return;
      setNote(n);
      setTitle(n.title);
      setBody(n.body_md);
    });
  }, [id]);

  if (loading) return <p style={{ color: "var(--text-muted)" }}>載入中…</p>;
  if (!user) return <p>請先登入。</p>;
  if (!note) return <p style={{ color: "var(--text-muted)" }}>載入筆記中或找不到。</p>;
  if (note.user_id !== user.uid) return <p>無權限。</p>;

  const save = async () => {
    setSaving(true);
    try {
      await updateNote(note.id, { title, body_md: body });
      setDirty(false);
      setStatus("已儲存");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "儲存失敗");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: 820 }}>
      <Link href="/library" style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>← 知識庫</Link>
      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.7rem", marginBottom: "0.8rem", alignItems: "center" }}>
        <input
          className="input"
          style={{ fontSize: "1.35rem", fontWeight: 700, fontFamily: "Space Grotesk, Outfit, sans-serif" }}
          value={title}
          onChange={(e) => { setTitle(e.target.value); setDirty(true); }}
        />
        <button className="btn" onClick={save} disabled={!dirty || saving}>
          {saving ? "…" : dirty ? "儲存" : "已儲存"}
        </button>
      </div>
      {note.source_job_id && (
        <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.6rem" }}>
          來源轉錄：<Link href={`/job/${note.source_job_id}`} style={{ color: "var(--accent-2)" }}>開啟逐字稿</Link>
        </p>
      )}
      {status && <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>{status}</p>}
      <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
        輸入 <kbd style={{ fontFamily: "inherit", border: "1px solid var(--border)", borderRadius: 4, padding: "0 4px" }}>/</kbd> 插入區塊；
        拖曳左側 ⋮⋮ 排序；空白行 Backspace 刪除區塊
      </p>
      <div
        className="editor-area"
        style={{ minHeight: "60vh", padding: "1rem 0.85rem" }}
      >
        <BlockEditor
          valueMd={body}
          onChangeMd={(md) => { setBody(md); setDirty(true); setStatus(""); }}
          placeholder="開始寫筆記，或輸入 / 插入標題、清單、待辦…"
        />
      </div>
    </div>
  );
}
