"use client";

import PageLoading from "@/components/motion/PageLoading";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import {
  listenToJob,
  getResultText,
  saveJobTranscripts,
  createNote,
  listenToUserNotes,
  jobDisplayTitle,
  updateJobTitle,
  Job,
} from "@/lib/firebase";
import TranscriptEditor from "@/components/TranscriptEditor";
import { segmentsToPlainText, parseTranscript } from "@/lib/transcript";
import { NOTE_TEMPLATES } from "@/lib/templates";
import { usePrefsOptional } from "@/components/PrefsProvider";
import { toast } from "@/lib/toast";
import { setJobAiContext } from "@/lib/jobAiContext";
import { openGlobalAiRail } from "@/components/shell/GlobalAiDock";
import { createAiStudyNoteFromTranscript } from "@/lib/jobToNote";

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
  const [linkedNoteId, setLinkedNoteId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [titleSaving, setTitleSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    return listenToJob(id, setJob);
  }, [id]);

  useEffect(() => {
    if (!user || !id) return;
    return listenToUserNotes(user.uid, (notes) => {
      const hit = notes.find((n) => n.source_job_id === id);
      setLinkedNoteId(hit?.id || null);
    });
  }, [user, id]);

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

  useEffect(() => {
    if (!job) return;
    setTitleDraft(jobDisplayTitle(job));
  }, [job?.id, job?.title, job?.filenames, job?.youtube_url]);

  useEffect(() => {
    if (!job || job.status !== "done") {
      setJobAiContext(null);
      return;
    }
    const text = liveText || current?.text || "";
    setJobAiContext({
      jobId: job.id,
      title: jobDisplayTitle(job),
      filename: current?.filename,
      transcript: text,
    });
    return () => setJobAiContext(null);
  }, [job, liveText, current?.filename, current?.text]);

  const commitTitle = async () => {
    if (!job || titleSaving) return;
    const next = titleDraft.trim();
    const fallback = job.filenames?.[0] || job.youtube_url || "逐字稿";
    const stored = (job.title || "").trim();
    const toStore = !next || next === fallback ? "" : next;
    if (toStore === stored) {
      setTitleDraft(toStore || fallback);
      return;
    }
    setTitleSaving(true);
    try {
      await updateJobTitle(job.id, toStore);
      setTitleDraft(toStore || fallback);
      toast("已更新名稱");
    } catch (e) {
      setTitleDraft(jobDisplayTitle(job));
      toast(e instanceof Error ? e.message : "名稱儲存失敗");
    } finally {
      setTitleSaving(false);
    }
  };

  const runAiStudyNote = async () => {
    if (!user || !job || !current) return;
    setBusy(true);
    setTplOpen(false);
    try {
      const noteId = await createAiStudyNoteFromTranscript({
        uid: user.uid,
        jobId: job.id,
        title: titleDraft.trim() || jobDisplayTitle(job),
        filename: current.filename,
        transcriptRaw: liveText || current.text,
        assistant: {
          name: prefsCtx?.prefs.aiAssistantName,
          style: prefsCtx?.prefs.aiStyle,
          model: prefsCtx?.prefs.aiModel,
          grounding: prefsCtx?.prefs.aiGrounding,
        },
      });
      setLinkedNoteId(noteId);
      toast("已建立 AI 筆記（含逐字稿 txt）");
      router.push(`/notes/${noteId}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "AI 整理失敗");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <PageLoading />;
  if (!user) return <p>請先登入。</p>;
  if (!job) return <p style={{ color: "var(--text-muted)" }}>找不到此工作。</p>;
  if (job.user_id !== user.uid) return <p>無權限檢視。</p>;

  const title = jobDisplayTitle(job);
  const showWorkspace = job.status === "done" && current;

  return (
    <div className="tx-page">
      <div className="tx-hero">
        <div>
          <Link href="/library" className="tx-back">
            ← 知識庫
          </Link>
          <input
            className="page-title font-display tx-title tx-title-input"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => void commitTitle()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                (e.target as HTMLInputElement).blur();
              }
              if (e.key === "Escape") {
                setTitleDraft(jobDisplayTitle(job));
                (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder="逐字稿名稱"
            aria-label="逐字稿名稱"
            disabled={titleSaving}
          />
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
            {linkedNoteId ? (
              <Link href={`/notes/${linkedNoteId}`} className="btn btn-sm btn-ghost">
                開啟筆記
              </Link>
            ) : null}
            <button
              className="btn btn-sm"
              disabled={busy}
              title="AI 依時間順序整理筆記，並把逐字稿存成 txt 放在筆記最上方"
              onClick={() => void runAiStudyNote()}
            >
              {busy ? "整理中…" : linkedNoteId ? "再建 AI 筆記" : "AI 整理筆記"}
            </button>
            <button
              className="btn btn-sm btn-ghost"
              disabled={busy}
              onClick={() => setTplOpen((v) => !v)}
            >
              範本 ▾
            </button>
            {tplOpen && (
              <div className="doc-more-menu" style={{ right: 0, top: "110%" }}>
                <button
                  type="button"
                  className="doc-more-item"
                  onClick={() => void runAiStudyNote()}
                >
                  AI 整理筆記
                </button>
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
                            t.tags,
                            { sort_order: -Date.now() }
                          );
                          setLinkedNoteId(noteId);
                          toast("已建立筆記");
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
          </div>
        )}
      </div>

      {job.status === "error" && (
        <div className="card tx-alert" style={{ color: "var(--danger)" }}>
          <p style={{ margin: "0 0 0.65rem" }}>{job.error_message || "處理失敗"}</p>
          <Link href="/capture" className="btn btn-sm">
            再捕捉
          </Link>
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
            <div className="tx-editor-ai-hint">
              <span>需要摘要、大綱或提問？用右側 Albireus AI</span>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => openGlobalAiRail()}>
                開啟 AI
              </button>
            </div>
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
        </div>
      )}
    </div>
  );
}
