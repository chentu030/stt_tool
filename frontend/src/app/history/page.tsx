"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { listenToUserJobs, deleteJob, getResultText, Job } from "@/lib/firebase";
import ThemeToggle from "@/components/ThemeToggle";
import Link from "next/link";

export default function HistoryPage() {
  const { user, loading } = useAuth();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // For large transcripts stored only in Storage (not inline in Firestore)
  const [loaded, setLoaded] = useState<Record<string, { filename: string; text: string }[]>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const unsub = listenToUserJobs(user.uid, setJobs);
    return unsub;
  }, [user]);

  // Return the transcripts for a job (inline if present, else from Storage cache)
  const getTranscripts = (job: Job) =>
    (job.transcripts && job.transcripts.length > 0) ? job.transcripts : (loaded[job.id] || []);

  const loadFromStorage = async (job: Job) => {
    if (loaded[job.id]) return loaded[job.id];
    if (!job.result_paths?.length) return [];
    setLoadingId(job.id);
    try {
      const results = await Promise.all(
        job.result_paths.map(async (p) => ({
          filename: p.split("/").pop()?.replace(/\.txt$/, "") || "transcript",
          text: await getResultText(p),
        }))
      );
      setLoaded((prev) => ({ ...prev, [job.id]: results }));
      return results;
    } catch (e) {
      console.error("Failed to load transcript from storage:", e);
      return [];
    } finally {
      setLoadingId(null);
    }
  };

  const handleView = async (job: Job) => {
    if (expandedId === job.id) { setExpandedId(null); return; }
    setExpandedId(job.id);
    if ((!job.transcripts || job.transcripts.length === 0) && job.result_paths?.length) {
      await loadFromStorage(job);
    }
  };

  const handleDownloadAll = async (job: Job) => {
    let ts = getTranscripts(job);
    if (ts.length === 0 && job.result_paths?.length) {
      ts = await loadFromStorage(job);
    }
    ts.forEach((t) => downloadTxt(t.filename, t.text));
  };

  const downloadTxt = (filename: string, text: string) => {
    const el = document.createElement("a");
    el.href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    el.download = filename.replace(/\.[^/.]+$/, "") + ".txt";
    document.body.appendChild(el);
    el.click();
    document.body.removeChild(el);
  };

  const statusBadge = (status: string, progress: number) => {
    const map: Record<string, { bg: string; text: string; label: string }> = {
      uploading: { bg: "rgba(59,130,246,0.15)", text: "#3b82f6", label: `Uploading...` },
      queued: { bg: "rgba(234,179,8,0.15)", text: "#eab308", label: "Queued" },
      processing: { bg: "rgba(168,85,247,0.15)", text: "#a855f7", label: `Processing ${progress}%` },
      done: { bg: "rgba(34,197,94,0.15)", text: "#22c55e", label: "Complete" },
      error: { bg: "rgba(239,68,68,0.15)", text: "#ef4444", label: "Failed" },
    };
    const s = map[status] || map.queued;
    return (
      <span style={{
        display: "inline-block", padding: "0.25rem 0.6rem", borderRadius: "20px",
        fontSize: "0.75rem", fontWeight: 600, background: s.bg, color: s.text,
      }}>
        {s.label}
      </span>
    );
  };

  if (loading) return (
    <main className="container" style={{ paddingTop: "8rem", textAlign: "center" }}>
      <p style={{ color: "var(--text-muted)" }}>Loading...</p>
    </main>
  );

  if (!user) return (
    <main className="container" style={{ paddingTop: "8rem", textAlign: "center" }}>
      <h1 className="font-display" style={{ fontSize: "2rem", marginBottom: "1rem" }}>Please sign in</h1>
      <p style={{ color: "var(--text-muted)", marginBottom: "2rem" }}>Sign in with Google to view your transcription history.</p>
      <Link href="/" className="pill-button">← Back to Home</Link>
    </main>
  );

  return (
    <>
      <div className="wavy-bg"></div>
      <main className="container">
        <nav className="navbar">
          <Link href="/" className="nav-logo font-display" style={{ textDecoration: "none", color: "inherit" }}>
            <span className="logo-icon"></span>AIVOICE
          </Link>
          <div className="nav-menu" style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
            <ThemeToggle />
          </div>
        </nav>

        <section style={{ paddingTop: "2rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
            <h1 className="font-display" style={{ fontSize: "2.5rem" }}>
              My <span>Transcripts</span>
            </h1>
            <Link href="/" className="pill-button outline" style={{ padding: "0.5rem 1.2rem", fontSize: "0.9rem" }}>
              ← New Transcription
            </Link>
          </div>

          {jobs.length === 0 ? (
            <div className="bento-card" style={{ textAlign: "center", padding: "4rem 2rem" }}>
              <p style={{ fontSize: "3rem", marginBottom: "1rem" }}>📝</p>
              <p style={{ color: "var(--text-muted)", fontSize: "1.1rem" }}>No transcriptions yet.</p>
              <Link href="/" className="pill-button" style={{ marginTop: "1.5rem", display: "inline-block" }}>
                Start Transcribing
              </Link>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
              {jobs.map((job) => (
                <div key={job.id} className="bento-card" style={{ padding: "1.2rem 1.5rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.4rem" }}>
                        <span style={{ fontWeight: 700, fontSize: "1rem" }}>
                          {job.source_type === "youtube" ? "🎬" : "📁"}{" "}
                          {job.filenames[0] || job.youtube_url || "Untitled"}
                        </span>
                        {job.total_files > 1 && (
                          <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                            +{job.total_files - 1} more
                          </span>
                        )}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.8rem", fontSize: "0.8rem", color: "var(--text-muted)" }}>
                        <span>{job.created_at.toLocaleDateString("zh-TW", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                        {statusBadge(job.status, job.progress)}
                      </div>

                      {/* Progress bar for active jobs */}
                      {(job.status === "processing" || job.status === "uploading") && (
                        <div style={{ marginTop: "0.6rem", width: "100%", height: "4px", background: "var(--bg-secondary)", borderRadius: "2px", overflow: "hidden" }}>
                          <div style={{
                            width: `${job.progress}%`, height: "100%",
                            background: "linear-gradient(90deg, var(--accent-1), var(--accent-2))",
                            borderRadius: "2px", transition: "width 0.5s ease"
                          }} />
                        </div>
                      )}
                    </div>

                    <div style={{ display: "flex", gap: "0.4rem", marginLeft: "1rem" }}>
                      {job.status === "done" && (
                        <>
                          <button className="pill-button" style={{ padding: "0.35rem 0.7rem", fontSize: "0.75rem" }}
                            onClick={() => handleView(job)}>
                            {expandedId === job.id ? "Hide" : "View"}
                          </button>
                          <button className="pill-button outline" style={{ padding: "0.35rem 0.7rem", fontSize: "0.75rem" }}
                            onClick={() => handleDownloadAll(job)}>
                            Download
                          </button>
                        </>
                      )}
                      <button style={{
                        background: "none", border: "none", cursor: "pointer",
                        color: "var(--text-muted)", fontSize: "1.1rem", padding: "0.2rem"
                      }} onClick={() => {
                        if (confirm("Delete this transcription?"))
                          deleteJob(job.id, job.storage_paths || [], job.result_paths || []);
                      }}>×</button>
                    </div>
                  </div>

                  {/* Expanded transcript view */}
                  {expandedId === job.id && (
                    <div style={{ marginTop: "1rem", borderTop: "1px solid var(--bg-secondary)", paddingTop: "1rem" }}>
                      {loadingId === job.id && getTranscripts(job).length === 0 && (
                        <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>Loading transcript…</p>
                      )}
                      {getTranscripts(job).map((t, i) => (
                        <div key={i} style={{ marginBottom: "0.8rem" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
                            <span style={{ fontWeight: 600, fontSize: "0.85rem" }}>{t.filename}</span>
                            <div style={{ display: "flex", gap: "0.3rem" }}>
                              <button className="pill-button outline" style={{ padding: "0.2rem 0.5rem", fontSize: "0.7rem" }}
                                onClick={() => navigator.clipboard.writeText(t.text)}>Copy</button>
                              <button className="pill-button" style={{ padding: "0.2rem 0.5rem", fontSize: "0.7rem" }}
                                onClick={() => downloadTxt(t.filename, t.text)}>.txt</button>
                            </div>
                          </div>
                          <textarea className="transcript-display" readOnly value={t.text}
                            style={{ minHeight: "120px", fontSize: "0.8rem" }} />
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Error message */}
                  {job.status === "error" && job.error_message && (
                    <p style={{ marginTop: "0.5rem", color: "#ef4444", fontSize: "0.8rem" }}>
                      Error: {job.error_message}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
