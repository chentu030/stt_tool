"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import {
  listenToJob, getResultText, saveJobTranscripts, createNote, Job,
} from "@/lib/firebase";
import TranscriptEditor from "@/components/TranscriptEditor";
import { segmentsToPlainText, parseTranscript } from "@/lib/transcript";

export default function JobPage() {
  const { id } = useParams<{ id: string }>();
  const { user, loading } = useAuth();
  const router = useRouter();
  const [job, setJob] = useState<Job | null>(null);
  const [fileIdx, setFileIdx] = useState(0);
  const [texts, setTexts] = useState<{ filename: string; text: string }[]>([]);
  const [busy, setBusy] = useState(false);

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
    return () => { cancelled = true; };
  }, [job]);

  if (loading) return <p style={{ color: "var(--text-muted)" }}>載入中…</p>;
  if (!user) return <p>請先登入。</p>;
  if (!job) return <p style={{ color: "var(--text-muted)" }}>找不到此工作。</p>;
  if (job.user_id !== user.uid) return <p>無權限檢視。</p>;

  const current = texts[fileIdx];

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.8rem", flexWrap: "wrap", marginBottom: "0.8rem" }}>
        <div>
          <Link href="/library" style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>← 知識庫</Link>
          <h1 className="page-title font-display" style={{ marginTop: "0.4rem" }}>
            {job.filenames?.[0] || job.youtube_url || "逐字稿"}
          </h1>
          <p className="page-sub" style={{ marginBottom: "0.6rem" }}>
            狀態：{job.status}
            {job.status === "processing" ? ` · ${job.progress}%` : ""}
            {job.status === "queued" && (job.queue_ahead ?? 0) > 0 ? ` · 前面還有 ${job.queue_ahead} 個` : ""}
          </p>
        </div>
        {job.status === "done" && current && (
          <button
            className="btn btn-sm"
            style={{ marginTop: "1.6rem", flexShrink: 0 }}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const plain = segmentsToPlainText(parseTranscript(current.text));
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
        )}
      </div>

      {job.status === "error" && (
        <div className="card" style={{ padding: "1rem", color: "var(--danger)", marginBottom: "1rem" }}>
          {job.error_message || "處理失敗"}
        </div>
      )}

      {["uploading", "queued", "processing"].includes(job.status) && (
        <div className="card" style={{ padding: "1.2rem", marginBottom: "1rem" }}>
          <p style={{ marginBottom: "0.6rem", color: "var(--text-muted)" }}>處理中，可稍後回來。</p>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${job.progress || (job.status === "queued" ? 15 : 40)}%` }} />
          </div>
        </div>
      )}

      {texts.length > 1 && (
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.8rem" }}>
          {texts.map((t, i) => (
            <button key={i} className={`btn btn-sm ${i === fileIdx ? "" : "btn-ghost"}`} onClick={() => setFileIdx(i)}>
              {t.filename}
            </button>
          ))}
        </div>
      )}

      {job.status === "done" && current && (
        <div className="card" style={{ padding: "1rem" }}>
          <TranscriptEditor
            key={`${job.id}-${fileIdx}-${current.filename}`}
            initialText={current.text}
            filename={current.filename}
            onSave={async (text) => {
              const next = texts.map((t, i) => (i === fileIdx ? { ...t, text } : t));
              setTexts(next);
              await saveJobTranscripts(job.id, user.uid, next, job.result_paths || []);
            }}
          />
        </div>
      )}
    </div>
  );
}
