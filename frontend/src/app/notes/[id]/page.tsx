"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useAuth } from "@/components/AuthProvider";
import { getNote, updateNote, listenToUserNotes, Note } from "@/lib/firebase";
import BlockEditor from "@/components/BlockEditor";
import ScrambleText from "@/components/motion/ScrambleText";
import { downloadDocx, downloadMarkdown, downloadPdfViaPrint, downloadPptOutline, bodyToSlides } from "@/lib/exportNote";
import { extractTagsFromText, extractWikiLinks, findBacklinks, findNoteByTitle } from "@/lib/wiki";

export default function NotePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, loading } = useAuth();
  const [note, setNote] = useState<Note | null>(null);
  const [allNotes, setAllNotes] = useState<Note[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [folder, setFolder] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [findOpen, setFindOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [slideIdx, setSlideIdx] = useState(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ title: "", body: "", tags: [] as string[], folder: "" });

  useEffect(() => {
    if (!id) return;
    getNote(id).then((n) => {
      if (!n) return;
      setNote(n);
      setTitle(n.title);
      setBody(n.body_md);
      setTags(n.tags || []);
      setFolder(n.folder || "");
      latest.current = { title: n.title, body: n.body_md, tags: n.tags || [], folder: n.folder || "" };
    });
  }, [id]);

  useEffect(() => {
    if (!user) return;
    return listenToUserNotes(user.uid, setAllNotes);
  }, [user]);

  useEffect(() => {
    latest.current = { title, body, tags, folder };
  }, [title, body, tags, folder]);

  const save = async (silent = false) => {
    if (!note) return;
    setSaving(true);
    setStatus("saving");
    try {
      const inlineTags = extractTagsFromText(latest.current.body);
      const mergedTags = Array.from(new Set([...latest.current.tags, ...inlineTags]));
      await updateNote(note.id, {
        title: latest.current.title,
        body_md: latest.current.body,
        tags: mergedTags,
        folder: latest.current.folder,
      });
      setTags(mergedTags);
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
    saveTimer.current = setTimeout(() => { void save(true); }, 1200);
  };

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  const runAi = async (action: "summarize" | "rewrite" | "outline") => {
    if (!body.trim() || aiBusy) return;
    setAiBusy(true);
    setAiError("");
    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, title, body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "AI 失敗");
      const next = action === "rewrite" ? data.text : `${body.trim()}\n\n---\n\n## AI ${action === "summarize" ? "摘要" : "大綱"}\n\n${data.text}`;
      setBody(next);
      markDirty();
    } catch (e) {
      setAiError(e instanceof Error ? e.message : "AI 失敗");
    } finally {
      setAiBusy(false);
    }
  };

  const backlinks = useMemo(() => {
    if (!note) return [];
    return findBacklinks(allNotes, { id: note.id, title, body_md: body, tags });
  }, [allNotes, note, title, body, tags]);

  const outbound = useMemo(() => extractWikiLinks(body), [body]);

  const slides = useMemo(() => bodyToSlides(title, body), [title, body]);

  useEffect(() => {
    if (!presenting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPresenting(false);
      if (e.key === "ArrowRight" || e.key === " ") setSlideIdx((i) => Math.min(i + 1, slides.length - 1));
      if (e.key === "ArrowLeft") setSlideIdx((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [presenting, slides.length]);

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

  const addTag = () => {
    const t = tagInput.trim().replace(/^#/, "");
    if (!t || tags.includes(t)) return;
    setTags([...tags, t]);
    setTagInput("");
    markDirty();
  };

  return (
    <div style={{ maxWidth: 960 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
        <Link href="/library" style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>← 知識庫</Link>
        <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap" }}>
          <AnimatePresence mode="wait">
            <motion.span
              key={status}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              style={{ fontSize: "0.78rem", color: status === "error" ? "var(--danger)" : "var(--text-muted)" }}
            >
              {statusLabel}
            </motion.span>
          </AnimatePresence>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => setFindOpen(true)}>尋找</button>
          <div style={{ position: "relative" }}>
            <button className="btn btn-ghost btn-sm" type="button" onClick={() => setExportOpen((v) => !v)}>匯出</button>
            {exportOpen && (
              <div className="card" style={{ position: "absolute", right: 0, top: "110%", zIndex: 30, padding: 6, minWidth: 160 }}>
                {[
                  { label: "Markdown (.md)", fn: () => downloadMarkdown(title, body) },
                  { label: "PDF（列印）", fn: () => downloadPdfViaPrint(title, body) },
                  { label: "Word (.docx)", fn: () => { void downloadDocx(title, body); } },
                  { label: "簡報大綱 (.md)", fn: () => downloadPptOutline(title, body) },
                ].map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ width: "100%", justifyContent: "flex-start", marginBottom: 2 }}
                    onClick={() => { item.fn(); setExportOpen(false); }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="btn btn-ghost btn-sm" type="button" onClick={() => { setSlideIdx(0); setPresenting(true); }}>簡報模式</button>
          <button className="btn btn-soft btn-sm" type="button" disabled={aiBusy || !body.trim()} onClick={() => runAi("summarize")}>{aiBusy ? "AI…" : "摘要"}</button>
          <button className="btn btn-soft btn-sm" type="button" disabled={aiBusy || !body.trim()} onClick={() => runAi("rewrite")}>改寫</button>
          <button className="btn btn-soft btn-sm" type="button" disabled={aiBusy || !body.trim()} onClick={() => runAi("outline")}>大綱</button>
          <button className="btn btn-sm" type="button" onClick={() => save(false)} disabled={!dirty || saving}>{saving ? "…" : "儲存"}</button>
        </div>
      </div>

      {aiError && <p style={{ color: "var(--danger)", fontSize: "0.82rem", marginTop: "0.55rem" }}>{aiError}</p>}

      <div style={{ marginTop: "0.85rem", marginBottom: "0.55rem" }}>
        <ScrambleText words="筆記" as="p" style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: 6, letterSpacing: "0.08em" }} speed={22} />
        <input
          className="input"
          style={{ fontSize: "1.45rem", fontWeight: 700, fontFamily: "Space Grotesk, Outfit, sans-serif", border: "none", background: "transparent", paddingLeft: 0 }}
          value={title}
          onChange={(e) => { setTitle(e.target.value); markDirty(); }}
          placeholder="無標題"
        />
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: "0.75rem", alignItems: "center" }}>
        <input
          className="input"
          style={{ maxWidth: 180, padding: "0.4rem 0.7rem", fontSize: "0.85rem" }}
          placeholder="資料夾／路徑"
          value={folder}
          onChange={(e) => { setFolder(e.target.value); markDirty(); }}
        />
        {tags.map((t) => (
          <button
            key={t}
            type="button"
            className="badge"
            style={{ cursor: "pointer", border: "none" }}
            title="移除標籤"
            onClick={() => { setTags(tags.filter((x) => x !== t)); markDirty(); }}
          >
            #{t} ×
          </button>
        ))}
        <input
          className="input"
          style={{ maxWidth: 140, padding: "0.35rem 0.6rem", fontSize: "0.85rem" }}
          placeholder="# 加標籤"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
        />
        <button type="button" className="btn btn-ghost btn-sm" onClick={addTag}>加入</button>
        <select
          className="input"
          style={{ width: "auto", padding: "0.35rem 0.6rem", fontSize: "0.85rem" }}
          value={note.status || "backlog"}
          onChange={(e) => {
            const status = e.target.value as Note["status"];
            setNote({ ...note, status });
            void updateNote(note.id, { status });
          }}
        >
          <option value="backlog">看板：待辦</option>
          <option value="doing">看板：進行中</option>
          <option value="done">看板：完成</option>
        </select>
      </div>

      {note.source_job_id && (
        <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.65rem" }}>
          來源轉錄：<Link href={`/job/${note.source_job_id}`} style={{ color: "var(--accent-2)" }}>開啟逐字稿</Link>
        </p>
      )}

      <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.7rem" }}>
        <kbd style={{ fontFamily: "inherit", border: "1px solid var(--border)", borderRadius: 4, padding: "0 4px" }}>/</kbd> 區塊 ·
        {" "}[[雙向連結]] · #標籤 · ⌘B/I/F · 自動儲存
      </p>

      <div className="note-layout">
        <motion.div
          className="editor-area"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ minHeight: "58vh", padding: "0.85rem 0.75rem 1.1rem" }}
        >
          <BlockEditor
            valueMd={body}
            onChangeMd={(md) => { setBody(md); markDirty(); }}
            placeholder="開始寫筆記，輸入 [[ 連結其他筆記，或 / 插入區塊…"
            findOpen={findOpen}
            onFindOpenChange={setFindOpen}
            wikiNotes={allNotes.map((n) => ({ id: n.id, title: n.title, body_md: n.body_md }))}
            onOpenWiki={(noteTitle) => {
              const hit = findNoteByTitle(allNotes, noteTitle);
              if (hit) router.push(`/notes/${hit.id}`);
            }}
          />
        </motion.div>

        <aside className="card" style={{ padding: "0.9rem", height: "fit-content", position: "sticky", top: 12 }}>
          <h3 className="font-display" style={{ fontSize: "0.95rem", marginBottom: "0.55rem" }}>連結圖</h3>
          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.45rem" }}>連出</p>
          {outbound.length === 0 ? (
            <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>尚無 [[wikilink]]</p>
          ) : (
            <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 4, marginBottom: "0.8rem" }}>
              {outbound.map((t) => {
                const hit = findNoteByTitle(allNotes, t);
                return (
                  <li key={t}>
                    {hit ? (
                      <Link href={`/notes/${hit.id}`} style={{ color: "var(--accent-2)", fontSize: "0.85rem" }}>[[{t}]]</Link>
                    ) : (
                      <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>[[{t}]]（未建立）</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.45rem" }}>反向連結</p>
          {backlinks.length === 0 ? (
            <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>還沒有筆記連到這裡</p>
          ) : (
            <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
              {backlinks.map((n) => (
                <li key={n.id}>
                  <Link href={`/notes/${n.id}`} style={{ color: "var(--accent-2)", fontSize: "0.85rem" }}>{n.title}</Link>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      {presenting && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 100,
            background: "linear-gradient(160deg, #0B1220, #134E4A 80%)",
            color: "#F8FAFC",
            display: "flex", flexDirection: "column",
            padding: "3rem 8vw",
          }}
          onClick={() => setSlideIdx((i) => Math.min(i + 1, slides.length - 1))}
        >
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2rem", opacity: 0.7, fontSize: "0.85rem" }}>
            <span>Cadence 簡報 · {slideIdx + 1}/{slides.length}</span>
            <button type="button" className="btn btn-ghost btn-sm" style={{ color: "#fff", borderColor: "rgba(255,255,255,0.25)" }} onClick={(e) => { e.stopPropagation(); setPresenting(false); }}>離開 Esc</button>
          </div>
          <h1 className="font-display" style={{ fontSize: "clamp(2rem, 5vw, 3.2rem)", marginBottom: "1.25rem" }}>{slides[slideIdx]?.title}</h1>
          <pre style={{ whiteSpace: "pre-wrap", fontFamily: "Outfit, sans-serif", fontSize: "1.15rem", lineHeight: 1.7, opacity: 0.92, flex: 1 }}>
            {slides[slideIdx]?.content}
          </pre>
          <p style={{ opacity: 0.5, fontSize: "0.8rem" }}>← → 或空白鍵翻頁</p>
        </div>
      )}
    </div>
  );
}
