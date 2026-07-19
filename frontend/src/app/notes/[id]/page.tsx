"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { useAuth } from "@/components/AuthProvider";
import { getNote, updateNote, listenToUserNotes, pushNoteVersion, listNoteVersions, Note, NoteVersion } from "@/lib/firebase";
import BlockEditor from "@/components/BlockEditor";
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
  const [moreOpen, setMoreOpen] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [slideIdx, setSlideIdx] = useState(0);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versions, setVersions] = useState<NoteVersion[]>([]);
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
      try {
        await pushNoteVersion(note.id, latest.current.title, latest.current.body);
      } catch { /* best-effort */ }
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

  if (loading) return <p style={{ color: "var(--text-muted)", padding: "2rem" }}>載入中…</p>;
  if (!user) return <p style={{ padding: "2rem" }}>請先登入。</p>;
  if (!note) return <p style={{ color: "var(--text-muted)", padding: "2rem" }}>載入筆記中或找不到。</p>;
  if (note.user_id !== user.uid) return <p style={{ padding: "2rem" }}>無權限。</p>;

  const statusLabel =
    status === "saving" ? "儲存中"
      : status === "saved" ? "已儲存"
        : status === "dirty" ? "編輯中"
          : status === "error" ? errorMsg
            : "";

  const addTag = () => {
    const t = tagInput.trim().replace(/^#/, "");
    if (!t || tags.includes(t)) return;
    setTags([...tags, t]);
    setTagInput("");
    markDirty();
  };

  const quietBtn: React.CSSProperties = {
    border: "none",
    background: "transparent",
    color: "var(--text-muted)",
    fontSize: "0.8rem",
    padding: "0.35rem 0.5rem",
    borderRadius: 4,
    cursor: "pointer",
  };

  return (
    <div className="doc-page">
      <div className="doc-topbar">
        <Link href="/library" style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>知識庫</Link>
        <div className="doc-topbar-actions">
          {statusLabel && (
            <span style={{ fontSize: "0.75rem", color: status === "error" ? "var(--danger)" : "var(--text-muted)", marginRight: 4 }}>
              {statusLabel}
            </span>
          )}
          <button type="button" style={quietBtn} onClick={() => setFindOpen(true)}>尋找</button>
          <button type="button" style={quietBtn} disabled={aiBusy || !body.trim()} onClick={() => runAi("summarize")}>
            {aiBusy ? "…" : "摘要"}
          </button>
          <div style={{ position: "relative" }}>
            <button type="button" style={quietBtn} onClick={() => { setMoreOpen((v) => !v); }}>⋯</button>
            {moreOpen && (
              <div className="card" style={{ position: "absolute", right: 0, top: "110%", zIndex: 30, padding: 6, minWidth: 168 }}>
                {[
                  { label: "改寫", fn: () => runAi("rewrite") },
                  { label: "產出大綱", fn: () => runAi("outline") },
                  { label: "簡報模式", fn: () => { setSlideIdx(0); setPresenting(true); } },
                  {
                    label: "版本歷史",
                    fn: async () => {
                      setVersionsOpen(true);
                      setVersions(await listNoteVersions(note.id));
                    },
                  },
                  { label: "匯出 Markdown", fn: () => downloadMarkdown(title, body) },
                  { label: "匯出 PDF", fn: () => downloadPdfViaPrint(title, body) },
                  { label: "匯出 DOCX", fn: () => { void downloadDocx(title, body); } },
                  { label: "匯出簡報大綱", fn: () => downloadPptOutline(title, body) },
                  { label: "手動儲存", fn: () => save(false) },
                ].map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ width: "100%", justifyContent: "flex-start", marginBottom: 2, border: "none" }}
                    onClick={() => { void item.fn(); setMoreOpen(false); }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {aiError && <p style={{ color: "var(--danger)", fontSize: "0.82rem", marginBottom: "0.75rem" }}>{aiError}</p>}

      {versionsOpen && (
        <div style={{ marginBottom: "1.25rem", padding: "0.85rem", background: "var(--bg-elevated)", borderRadius: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <strong style={{ fontSize: "0.85rem" }}>版本歷史</strong>
            <button type="button" style={quietBtn} onClick={() => setVersionsOpen(false)}>關閉</button>
          </div>
          {versions.length === 0 ? (
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>尚無快照。</p>
          ) : versions.map((v) => (
            <button
              key={v.id}
              type="button"
              style={{ ...quietBtn, display: "flex", width: "100%", justifyContent: "space-between", marginBottom: 4 }}
              onClick={() => {
                if (!confirm("還原此版本？")) return;
                setTitle(v.title);
                setBody(v.body_md);
                markDirty();
                setVersionsOpen(false);
              }}
            >
              <span>{v.title || "（無標題）"}</span>
              <span>{v.created_at.toLocaleString("zh-TW")}</span>
            </button>
          ))}
        </div>
      )}

      <input
        className="doc-title"
        value={title}
        onChange={(e) => { setTitle(e.target.value); markDirty(); }}
        placeholder="無標題"
      />

      <div className="doc-props">
        <input
          className="doc-prop-input"
          placeholder="資料夾"
          value={folder}
          onChange={(e) => { setFolder(e.target.value); markDirty(); }}
        />
        {tags.map((t) => (
          <button
            key={t}
            type="button"
            className="badge"
            style={{ cursor: "pointer", border: "none", fontWeight: 500 }}
            onClick={() => { setTags(tags.filter((x) => x !== t)); markDirty(); }}
          >
            #{t}
          </button>
        ))}
        <input
          className="doc-prop-input"
          placeholder="加標籤…"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
        />
        <select
          className="doc-prop-input"
          value={note.status || "backlog"}
          onChange={(e) => {
            const s = e.target.value as Note["status"];
            setNote({ ...note, status: s });
            void updateNote(note.id, { status: s });
          }}
        >
          <option value="backlog">待辦</option>
          <option value="doing">進行中</option>
          <option value="done">完成</option>
        </select>
        {note.source_job_id && (
          <Link href={`/job/${note.source_job_id}`} className="doc-prop-input" style={{ color: "var(--accent-2)" }}>
            來源逐字稿
          </Link>
        )}
      </div>

      <div className="doc-editor-shell">
        <BlockEditor
          valueMd={body}
          onChangeMd={(md) => { setBody(md); markDirty(); }}
          placeholder="輸入文字，或按 / 插入區塊…"
          findOpen={findOpen}
          onFindOpenChange={setFindOpen}
          wikiNotes={allNotes.map((n) => ({ id: n.id, title: n.title, body_md: n.body_md }))}
          onOpenWiki={(noteTitle) => {
            const hit = findNoteByTitle(allNotes, noteTitle);
            if (hit) router.push(`/notes/${hit.id}`);
          }}
        />
      </div>

      <section className="doc-backlinks">
        <h3>連結</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
          <div>
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: 6 }}>此頁連出</p>
            {outbound.length === 0 ? (
              <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>尚無 [[連結]]</p>
            ) : outbound.map((t) => {
              const hit = findNoteByTitle(allNotes, t);
              return hit ? (
                <div key={t}><Link href={`/notes/${hit.id}`} style={{ color: "var(--accent-2)", fontSize: "0.9rem" }}>{t}</Link></div>
              ) : (
                <div key={t} style={{ fontSize: "0.9rem", color: "var(--text-muted)" }}>{t}（未建立）</div>
              );
            })}
          </div>
          <div>
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: 6 }}>連到此頁</p>
            {backlinks.length === 0 ? (
              <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>尚無反向連結</p>
            ) : backlinks.map((n) => (
              <div key={n.id}><Link href={`/notes/${n.id}`} style={{ color: "var(--accent-2)", fontSize: "0.9rem" }}>{n.title}</Link></div>
            ))}
          </div>
        </div>
      </section>

      {presenting && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 100,
            background: "#FFFFFF",
            color: "#37352F",
            display: "flex", flexDirection: "column",
            padding: "4rem 10vw",
          }}
          onClick={() => setSlideIdx((i) => Math.min(i + 1, slides.length - 1))}
        >
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "2.5rem", color: "var(--text-muted)", fontSize: "0.85rem" }}>
            <span>{slideIdx + 1} / {slides.length}</span>
            <button type="button" style={quietBtn} onClick={(e) => { e.stopPropagation(); setPresenting(false); }}>離開</button>
          </div>
          <h1 className="font-display" style={{ fontSize: "clamp(2rem, 5vw, 3rem)", marginBottom: "1.25rem" }}>{slides[slideIdx]?.title}</h1>
          <pre style={{ whiteSpace: "pre-wrap", fontFamily: "Outfit, sans-serif", fontSize: "1.2rem", lineHeight: 1.7, flex: 1 }}>
            {slides[slideIdx]?.content}
          </pre>
        </div>
      )}
    </div>
  );
}
