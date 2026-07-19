"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import {
  listenToJob,
  getResultText,
  saveJobTranscripts,
  createNote,
  Job,
} from "@/lib/firebase";
import TranscriptEditor from "@/components/TranscriptEditor";
import TranscriptChat from "@/components/TranscriptChat";
import { segmentsToPlainText, parseTranscript } from "@/lib/transcript";
import { NOTE_TEMPLATES } from "@/lib/templates";
import { usePrefsOptional } from "@/components/PrefsProvider";

export default function JobPage() {
  const { id } = useParams<{ id: string }>();
  const { user, loading } = useAuth();
  const prefsCtx = usePrefsOptional();
  const router = useRouter();
  const [job, setJob] = useState<Job | null>(null);
  const [fileIdx, setFileIdx] = useState(0);
  const [texts, setTexts] = useState<{ filename: string; text: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [liveText, setLiveText] = useState("");
  const [tplOpen, setTplOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    return listenToJob(id, setJob);
  }, [id]);

  useEffect(() => {
    if (!job || job.status !== "done") return;
    let cancelled = false;
    (async () => {
      let results = job.transcripts || [];
      if (results.length === 0 && job.result_paths?.length) {
        results = await Promise.all(
          job.result_paths.map(async (p) => ({
            filename: p.split("/").pop()?.replace(/\.txt$/, "") || "transcript",
            text: await getResultText(p),
          }))
        );
      }
      if (!cancelled) setTexts(results);
    })();
    return () => {
      cancelled = true;
    };
  }, [job]);

  const current = texts[fileIdx];

  useEffect(() => {
    setLiveText(current?.text || "");
  }, [current?.text, fileIdx, job?.id]);

  if (loading) return <p style={{ color: "var(--text-muted)" }}>載入中…</p>;
  if (!user) return <p>請先登入。</p>;
  if (!job) return <p style={{ color: "var(--text-muted)" }}>找不到此工作。</p>;
  if (job.user_id !== user.uid) return <p>無權限檢視。</p>;

  const title = job.filenames?.[0] || job.youtube_url || "逐字稿";
  const showWorkspace = job.status === "done" && current;

  return (
    <div className="tx-page">
      <div className="tx-hero">
        <div>
          <Link href="/library" className="tx-back">
            ← 知識庫
          </Link>
          <h1 className="page-title font-display tx-title">{title}</h1>
          <p className="page-sub">
            {job.status === "done"
              ? "完成"
              : job.status === "processing"
                ? `處理中 ${job.progress}%`
                : job.status === "queued"
                  ? (job.queue_ahead ?? 0) > 0
                    ? `排隊中 · 前面 ${job.queue_ahead}`
                    : "排隊中"
                  : job.status === "error"
                    ? "失敗"
                    : job.status}
          </p>
        </div>
        {showWorkspace && (
          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", position: "relative" }}>
            <button
              className="btn btn-sm btn-ghost"
              disabled={busy}
              onClick={() => setTplOpen((v) => !v)}
            >
              範本 ▾
            </button>
            {tplOpen && (
              <div className="doc-more-menu" style={{ right: 0, top: "110%" }}>
                {NOTE_TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="doc-more-item"
                    onClick={() => {
                      setTplOpen(false);
                      void (async () => {
                        if (!user || !job) return;
                        setBusy(true);
                        try {
                          const plain = segmentsToPlainText(
                            parseTranscript(liveText || current.text)
                          );
                          const body =
                            t.id === "blank"
                              ? plain
                              : `${t.body.trim()}\n\n---\n\n## 逐字稿\n\n${plain}`;
                          const noteId = await createNote(
                            user.uid,
                            `${t.title}${current.filename || "轉錄"}`.trim(),
                            body,
                            job.id,
                            t.tags
                          );
                          router.push(`/notes/${noteId}`);
                        } finally {
                          setBusy(false);
                        }
                      })();
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            )}
            <button
              className="btn btn-sm btn-ghost"
              disabled={busy}
              title="AI 產出摘要、決議、待辦並寫入會議筆記"
              onClick={async () => {
                setBusy(true);
                try {
                  const plain = segmentsToPlainText(parseTranscript(liveText || current.text));
                  const res = await fetch("/api/ai/generate", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      action: "meeting_pack",
                      title: current.filename || title,
                      body: plain.slice(0, 14000),
                      assistant: {
                        name: prefsCtx?.prefs.aiAssistantName,
                        style: prefsCtx?.prefs.aiStyle,
                        model: prefsCtx?.prefs.aiModel,
                      },
                    }),
                  });
                  const data = await res.json();
                  if (!res.ok) throw new Error(data.error || "AI 失敗");
                  const pack = String(data.text || "").trim();
                  const meeting = NOTE_TEMPLATES.find((t) => t.id === "meeting");
                  const body = [
                    meeting?.body?.trim() || "## 會議",
                    "",
                    "---",
                    "",
                    "## AI 會議整理",
                    "",
                    pack || "（無內容）",
                    "",
                    "---",
                    "",
                    "## 逐字稿",
                    "",
                    plain,
                  ].join("\n");
                  const noteId = await createNote(
                    user.uid,
                    `會議 — ${current.filename || title}`,
                    body,
                    job.id,
                    ["會議", ...(meeting?.tags || [])]
                  );
                  router.push(`/notes/${noteId}`);
                } catch (e) {
                  alert(e instanceof Error ? e.message : "會議整理失敗");
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "整理中…" : "AI 會議筆記"}
            </button>
            <button
              className="btn btn-sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const plain = segmentsToPlainText(parseTranscript(liveText || current.text));
                  const noteId = await createNote(
                    user.uid,
                    current.filename || "來自轉錄的筆記",
                    plain,
                    job.id
                  );
                  router.push(`/notes/${noteId}`);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "建立中…" : "轉成筆記"}
            </button>
          </div>
        )}
      </div>

      {job.status === "error" && (
        <div className="card tx-alert" style={{ color: "var(--danger)" }}>
          {job.error_message || "處理失敗"}
        </div>
      )}

      {["uploading", "queued", "processing"].includes(job.status) && (
        <div className="card tx-alert">
          <p style={{ marginBottom: "0.6rem", color: "var(--text-muted)" }}>
            處理中，可稍後回來。
          </p>
          <div className="progress-track">
            <div
              className="progress-fill"
              style={{
                width: `${job.progress || (job.status === "queued" ? 15 : 40)}%`,
              }}
            />
          </div>
        </div>
      )}

      {texts.length > 1 && (
        <div className="tx-files">
          {texts.map((t, i) => (
            <button
              key={i}
              type="button"
              className={`btn btn-sm ${i === fileIdx ? "" : "btn-ghost"}`}
              onClick={() => setFileIdx(i)}
            >
              {t.filename}
            </button>
          ))}
        </div>
      )}

      {showWorkspace && (
        <div className="tx-layout">
          <div className="card tx-editor">
            <TranscriptEditor
              key={`${job.id}-${fileIdx}-${current.filename}`}
              initialText={current.text}
              filename={current.filename}
              onChange={(text) => setLiveText(text)}
              onSave={async (text) => {
                const next = texts.map((t, i) => (i === fileIdx ? { ...t, text } : t));
                setTexts(next);
                setLiveText(text);
                await saveJobTranscripts(job.id, user.uid, next, job.result_paths || []);
              }}
            />
          </div>
          <TranscriptChat
            jobId={job.id}
            title={title}
            filename={current.filename}
            transcriptText={liveText || current.text}
          />
        </div>
      )}
    </div>
  );
}
