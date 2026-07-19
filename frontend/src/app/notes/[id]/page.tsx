"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useAuth } from "@/components/AuthProvider";
import { getNote, updateNote, Note } from "@/lib/firebase";
import BlockEditor from "@/components/BlockEditor";
import ScrambleText from "@/components/motion/ScrambleText";

export default function NotePage() {
  const { id } = useParams<{ id: string }>();
  const { user, loading } = useAuth();
  const [note, setNote] = useState<Note | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [findOpen, setFindOpen] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ title: "", body: "" });

  useEffect(() => {
    if (!id) return;
    getNote(id).then((n) => {
      if (!n) return;
      setNote(n);
      setTitle(n.title);
      setBody(n.body_md);
      latest.current = { title: n.title, body: n.body_md };
    });
  }, [id]);

  useEffect(() => {
    latest.current = { title, body };
  }, [title, body]);

  const save = async (silent = false) => {
    if (!note) return;
    setSaving(true);
    setStatus("saving");
    try {
      await updateNote(note.id, {
        title: latest.current.title,
        body_md: latest.current.body,
      });
      setDirty(false);
      setStatus("saved");
      if (!silent) setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 1800);
    } catch (e) {
      setStatus("error");
      setErrorMsg(e instanceof Error ? e.message : "儲存失敗");
    } finally {
      setSaving(false);
    }
  };

  const markDirty = () => {
    setDirty(true);
    setStatus("dirty");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void save(true);
    }, 1200);
  };

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  const exportMd = () => {
    const blob = new Blob([`# ${title}\n\n${body}`], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(title || "note").replace(/[\\/:*?"<>|]+/g, "_")}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <p style={{ color: "var(--text-muted)" }}>載入中…</p>;
  if (!user) return <p>請先登入。</p>;
  if (!note) return <p style={{ color: "var(--text-muted)" }}>載入筆記中或找不到。</p>;
  if (note.user_id !== user.uid) return <p>無權限。</p>;

  const statusLabel =
    status === "saving" ? "儲存中…"
      : status === "saved" ? "已自動儲存"
        : status === "dirty" ? "未儲存變更"
          : status === "error" ? errorMsg
            : "就緒";

  return (
    <div style={{ maxWidth: 860 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
        <Link href="/library" style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>← 知識庫</Link>
        <div style={{ display: "flex", gap: "0.45rem", alignItems: "center" }}>
          <AnimatePresence mode="wait">
            <motion.span
              key={status}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              style={{
                fontSize: "0.78rem",
                color: status === "error" ? "var(--danger)" : "var(--text-muted)",
              }}
            >
              {statusLabel}
            </motion.span>
          </AnimatePresence>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => setFindOpen(true)}>尋找</button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={exportMd}>匯出 MD</button>
          <button className="btn btn-sm" type="button" onClick={() => save(false)} disabled={!dirty || saving}>
            {saving ? "…" : "儲存"}
          </button>
        </div>
      </div>

      <div style={{ marginTop: "0.85rem", marginBottom: "0.55rem" }}>
        <ScrambleText
          words="筆記"
          as="p"
          style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: 6, letterSpacing: "0.08em" }}
          speed={22}
        />
        <input
          className="input"
          style={{
            fontSize: "1.45rem",
            fontWeight: 700,
            fontFamily: "Space Grotesk, Outfit, sans-serif",
            border: "none",
            background: "transparent",
            paddingLeft: 0,
          }}
          value={title}
          onChange={(e) => { setTitle(e.target.value); markDirty(); }}
          placeholder="無標題"
        />
      </div>

      {note.source_job_id && (
        <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.65rem" }}>
          來源轉錄：<Link href={`/job/${note.source_job_id}`} style={{ color: "var(--accent-2)" }}>開啟逐字稿</Link>
        </p>
      )}

      <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.7rem" }}>
        <kbd style={{ fontFamily: "inherit", border: "1px solid var(--border)", borderRadius: 4, padding: "0 4px" }}>/</kbd> 區塊 ·
        ⌘B / ⌘I 樣式 · ⌘F 尋找 · 自動儲存
      </p>

      <motion.div
        className="editor-area"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28 }}
        style={{ minHeight: "62vh", padding: "0.85rem 0.75rem 1.1rem" }}
      >
        <BlockEditor
          valueMd={body}
          onChangeMd={(md) => { setBody(md); markDirty(); }}
          placeholder="開始寫筆記，或輸入 / 插入標題、清單、待辦、圖片…"
          findOpen={findOpen}
          onFindOpenChange={setFindOpen}
        />
      </motion.div>
    </div>
  );
}
