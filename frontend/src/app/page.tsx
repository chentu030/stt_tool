"use client";

import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/components/AuthProvider";
import {
  loginWithGoogle, logout, createJob, updateJobStatus,
  uploadFile, listenToJob, getResultText, Job,
} from "@/lib/firebase";
import ThemeToggle from "@/components/ThemeToggle";
import Link from "next/link";

interface FileTranscript {
  filename: string;
  text: string;
}

function fmtSec(s: number): string {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

interface ProgressInfo {
  fileIndex: number;
  totalFiles: number;
  filename: string;
  progress: number;
  status: string;
  positionLabel?: string;
  queueAhead?: number;
}

export default function Home() {
  const { user, loading: authLoading } = useAuth();

  const [files, setFiles] = useState<File[]>([]);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcripts, setTranscripts] = useState<FileTranscript[]>([]);
  const [error, setError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [progress, setProgress] = useState<ProgressInfo>({
    fileIndex: 0, totalFiles: 0, filename: "", progress: 0, status: "", positionLabel: "",
  });
  const [uploadPct, setUploadPct] = useState(0);
  const [bgMode, setBgMode] = useState(false);
  const [bgJobId, setBgJobId] = useState<string | null>(null);

  // YouTube Cookie Auth
  const [ytAuth, setYtAuth] = useState<"none" | "authorized">("none");
  const [ytTokenId, setYtTokenId] = useState("");
  const cookieInputRef = useRef<HTMLInputElement>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const API = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000/api";

  // ─── Listen to background job ───────────────────────────────
  useEffect(() => {
    if (!bgJobId) return;
    const unsub = listenToJob(bgJobId, async (job: Job) => {
      setProgress({
        fileIndex: job.current_file, totalFiles: job.total_files,
        filename: job.filenames[job.current_file - 1] || "", progress: job.progress,
        status: job.status, positionLabel: job.position_label || "",
        queueAhead: job.queue_ahead ?? 0,
      });
      if (job.status === "done") {
        let results = job.transcripts || [];
        // Large transcripts are stored only in Storage (Firestore 1MB doc limit)
        if (results.length === 0 && (job.result_paths?.length ?? 0) > 0) {
          try {
            results = await Promise.all(
              job.result_paths.map(async (p) => ({
                filename: p.split("/").pop()?.replace(/\.txt$/, "") || "transcript",
                text: await getResultText(p),
              }))
            );
          } catch (e) {
            console.error("Failed to load results from storage:", e);
          }
        }
        setTranscripts(results);
        setIsTranscribing(false);
        setBgJobId(null);
      } else if (job.status === "error") {
        setError(job.error_message || "Processing failed");
        setIsTranscribing(false);
        setBgJobId(null);
      }
    });
    return unsub;
  }, [bgJobId]);

  // ─── File handling ──────────────────────────────────────────
  const addFiles = (newFiles: FileList | File[]) => {
    setFiles((prev) => [...prev, ...Array.from(newFiles)]);
    setYoutubeUrl("");
  };
  const removeFile = (idx: number) => setFiles((prev) => prev.filter((_, i) => i !== idx));

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(e.type === "dragenter" || e.type === "dragover");
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  };
  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (fileList && fileList.length > 0) {
      // Copy to array BEFORE resetting input
      const arr = Array.from(fileList);
      console.log("[handleFileInput] selected:", arr.map(f => f.name));
      addFiles(arr);
    }
    // Delay reset to avoid triggering another onChange with empty list
    setTimeout(() => { if (fileInputRef.current) fileInputRef.current.value = ""; }, 100);
  };

  // ─── Cloud mode (upload to Firebase Storage, process via Cloud Tasks) ─
  const handleBackgroundTranscribe = async () => {
    if (!user) return;
    setIsTranscribing(true);
    setBgMode(true);
    setError("");
    setTranscripts([]);
    setUploadPct(0);
    setProgress({
      fileIndex: 0, totalFiles: files.length || 1, filename: "", progress: 0,
      status: files.length ? "uploading" : "queued", positionLabel: "",
    });

    try {
      const filenames = files.map((f) => f.name);
      const jobId = await createJob(
        user.uid,
        files.length ? "upload" : "youtube",
        files.length ? filenames : [youtubeUrl],
        youtubeUrl
      );

      // Attach the progress listener now so upload + processing show live,
      // even while the /jobs/start request stays open on the server.
      setBgJobId(jobId);

      const storagePaths: string[] = [];

      if (files.length) {
        // Upload files to Firebase Storage
        for (let i = 0; i < files.length; i++) {
          const path = `uploads/${user.uid}/${jobId}/${files[i].name}`;
          setUploadPct(0);
          setProgress({
            fileIndex: i + 1, totalFiles: files.length,
            filename: files[i].name, progress: 0, status: "uploading",
          });
          await uploadFile(path, files[i], (pct) => {
            setUploadPct(pct);
            setProgress((p) => ({ ...p, progress: pct }));
          });
          storagePaths.push(path);
        }
        await updateJobStatus(jobId, { status: "queued", storage_paths: storagePaths });
      } else {
        await updateJobStatus(jobId, { status: "queued" });
      }

      // Start backend processing
      const token = await user.getIdToken();
      const fd = new FormData();
      fd.append("job_id", jobId);
      if (youtubeUrl) fd.append("youtube_url", youtubeUrl);
      if (ytTokenId) fd.append("yt_token_id", ytTokenId);

      // Fire-and-forget: keeps the request open (so Cloud Run keeps processing),
      // but the Firestore listener is the source of truth for progress/results,
      // so a dropped connection here won't clobber a completed job.
      fetch(`${API}/jobs/start`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      }).catch((e) => console.error("jobs/start request:", e));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed";
      setError(msg);
      setIsTranscribing(false);
      setBgMode(false);
    }
  };

  // ─── YouTube Cookie Upload ────────────────────────────────────
  const handleCookieUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setError("");
      const fd = new FormData();
      fd.append("cookie_file", file);
      const res = await fetch(`${API}/youtube/cookie/upload`, { method: "POST", body: fd });
      if (!res.ok) {
        const errText = await res.text();
        setError(`Cookie upload failed: ${errText}`);
        return;
      }
      const data = await res.json();
      setYtTokenId(data.cookie_id);
      setYtAuth("authorized");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setError(`Cookie upload error: ${msg}`);
    }
    e.target.value = "";
  };

  // ─── Downloads ──────────────────────────────────────────────
  const downloadTxt = (filename: string, text: string) => {
    const el = document.createElement("a");
    el.href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    el.download = filename.replace(/\.[^/.]+$/, "") + ".txt";
    document.body.appendChild(el);
    el.click();
    document.body.removeChild(el);
  };

  const progressLabel = () => {
    if (progress.status === "uploading")
      return `⬆ Uploading${progress.totalFiles > 1 ? ` file ${progress.fileIndex}/${progress.totalFiles}` : ""}: ${uploadPct}%`;
    if (progress.status === "downloading") return "Downloading from YouTube...";
    if (progress.status === "download_complete") return "Download complete, starting transcription...";
    if (progress.status === "transcribing") {
      const filePart = progress.totalFiles > 1
        ? `File ${progress.fileIndex}/${progress.totalFiles}: ${progress.filename}`
        : progress.filename;
      // Show real audio position (mm:ss / total) when available
      const posPart = progress.positionLabel
        ? ` — ⏱ ${progress.positionLabel}`
        : ` — ${progress.progress}%`;
      return `${filePart}${posPart}`;
    }
    if (progress.status === "processing") {
      // Background mode: position_label carries "N/總 檔完成"
      return progress.positionLabel
        ? `${progress.positionLabel} (${progress.progress}%)`
        : `處理中... ${progress.progress}%`;
    }
    if (progress.status === "queued") {
      return (progress.queueAhead ?? 0) > 0
        ? `排隊中 — 前面還有 ${progress.queueAhead} 個音檔`
        : "排隊中 — 即將開始";
    }
    return "準備中...";
  };

  const overallProgress = () => {
    if (progress.totalFiles <= 0) return 0;
    const done = ((progress.fileIndex - 1) / progress.totalFiles) * 100;
    return Math.min(Math.round(done + progress.progress / progress.totalFiles), 100);
  };

  // ─── Render ─────────────────────────────────────────────────
  return (
    <>
      <div className="wavy-bg"></div>
      <main className="container">
        <nav className="navbar">
          <div className="nav-logo font-display">
            <span className="logo-icon"></span>AIVOICE
          </div>
          <div className="nav-menu" style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            {user && (
              <Link href="/history" className="pill-button outline"
                style={{ padding: "0.4rem 0.8rem", fontSize: "0.8rem", textDecoration: "none" }}>
                History
              </Link>
            )}
            {authLoading ? null : user ? (
              <button onClick={logout} className="pill-button outline"
                style={{ display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.3rem 0.7rem", fontSize: "0.8rem" }}>
                <img src={user.photoURL || ""} alt="" width={22} height={22}
                  style={{ borderRadius: "50%" }} />
                Sign Out
              </button>
            ) : (
              <button onClick={loginWithGoogle} className="pill-button"
                style={{ padding: "0.4rem 1rem", fontSize: "0.85rem" }}>
                <svg width="16" height="16" viewBox="0 0 48 48" style={{ marginRight: "6px", verticalAlign: "middle" }}>
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                </svg>
                Sign In
              </button>
            )}
            <ThemeToggle />
          </div>
        </nav>

        <section className="hero">
          <h1 className="font-display">
            Transcribing <span>voice</span><br />with the power of AI.
          </h1>
          <p style={{ fontSize: "1.1rem", maxWidth: "600px", margin: "0 auto", color: "var(--text-muted)" }}>
            Upload multiple audio/video files or paste a YouTube URL. {user ? "Your results are saved automatically." : "Sign in to save your results."}
          </p>
        </section>

        <section className="bento-grid">
          {/* ── Card 1: File Upload ── */}
          <div className="bento-card col-span-8 card-purple" style={{ display: "flex", flexDirection: "column" }}>
            <h2 className="font-display" style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>Upload Media</h2>
            <p style={{ color: "rgba(0,0,0,0.6)", marginBottom: "1rem" }}>
              Drag and drop one or more audio/video files.
            </p>

            {/* Hidden file input - OUTSIDE the drop zone to avoid event conflicts */}
            <input ref={fileInputRef} type="file" multiple
              style={{ display: "none" }}
              onChange={handleFileInput} />

            <div className={`upload-zone ${dragActive ? "active" : ""}`}
              onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop}
              style={{ minHeight: files.length ? "100px" : "180px", flex: files.length ? undefined : 1,
                cursor: "default" }}>
              <div className="upload-icon-large">
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
              </div>
              <p style={{ fontWeight: 600, fontSize: "1.05rem" }}>
                {files.length ? `${files.length} file(s) selected` : "Drop files here"}
              </p>
              {!files.length && (
                <button type="button" className="pill-button" onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                  style={{ marginTop: "0.7rem", fontSize: "0.9rem", padding: "0.5rem 1.5rem" }}>
                  📁 Choose Files
                </button>
              )}
              {!files.length && (
                <p style={{ fontSize: "0.8rem", color: "rgba(0,0,0,0.5)", marginTop: "0.5rem" }}>
                  MP4, MP3, M4A, WAV — multiple files supported
                </p>
              )}
              {files.length > 0 && (
                <button type="button" className="pill-button outline" onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                  style={{ marginTop: "0.5rem", fontSize: "0.8rem", padding: "0.35rem 1rem" }}>
                  + Add more files
                </button>
              )}
            </div>

            {files.length > 0 && (
              <div style={{ marginTop: "0.8rem", maxHeight: "240px", overflowY: "auto" }}>
                {files.map((f, i) => (
                  <div key={i} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "0.6rem 0.7rem", borderRadius: "10px", minHeight: "44px",
                    background: "rgba(0,0,0,0.05)", marginBottom: "0.35rem", fontSize: "0.85rem",
                  }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                      {f.name}
                    </span>
                    <span style={{ color: "rgba(0,0,0,0.4)", marginLeft: "0.4rem", whiteSpace: "nowrap" }}>
                      {(f.size / 1024 / 1024).toFixed(1)} MB
                    </span>
                    <button onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                      style={{ background: "none", border: "none", cursor: "pointer", marginLeft: "0.4rem",
                        color: "rgba(0,0,0,0.4)", fontSize: "1rem" }}>×</button>
                  </div>
                ))}
              </div>
            )}

            {files.length > 0 && (
              <div style={{ marginTop: "0.8rem", display: "flex", gap: "0.5rem", justifyContent: "flex-end", alignItems: "center" }}>
                {user ? (
                  <button className="pill-button" disabled={isTranscribing}
                    onClick={handleBackgroundTranscribe}
                    title="Shows upload progress, handles large files, and you can close the tab after upload.">
                    {isTranscribing ? "Processing..." : `☁️ Transcribe ${files.length} file(s)`}
                  </button>
                ) : (
                  <button className="pill-button" onClick={loginWithGoogle}>
                    Sign in to transcribe
                  </button>
                )}
              </div>
            )}
          </div>

          {/* ── Card 2: YouTube ── */}
          <div className="bento-card col-span-4 card-yellow" style={{ display: "flex", flexDirection: "column" }}>
            <h2 className="font-display" style={{ fontSize: "1.8rem", marginBottom: "0.5rem" }}>YouTube</h2>
            <p style={{ color: "rgba(0,0,0,0.6)", marginBottom: "0.8rem", fontSize: "0.8rem" }}>
              Paste a link to any video or playlist.
            </p>
            <input type="text" className="input-minimal" placeholder="https://youtube.com/..."
              value={youtubeUrl}
              onChange={(e) => { setYoutubeUrl(e.target.value); if (e.target.value) setFiles([]); }} />

            {/* YouTube Cookie Auth */}
            <div style={{ marginTop: "0.6rem" }}>
              <input ref={cookieInputRef} type="file" accept=".txt" style={{ display: "none" }}
                onChange={handleCookieUpload} />
              {ytAuth === "none" && (
                <button onClick={() => cookieInputRef.current?.click()} className="pill-button outline"
                  style={{ width: "100%", padding: "0.45rem", fontSize: "0.75rem" }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2" style={{ marginRight: "5px", verticalAlign: "middle" }}>
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0110 0v4" />
                  </svg>
                  Upload cookies.txt (private videos)
                </button>
              )}
              {ytAuth === "authorized" && (
                <div style={{ padding: "0.4rem", borderRadius: "10px", background: "rgba(34,197,94,0.15)",
                  fontSize: "0.8rem", textAlign: "center", color: "#15803d", fontWeight: 600 }}>
                  ✓ YouTube cookies loaded
                </div>
              )}
            </div>

            <div style={{ marginTop: "auto", paddingTop: "0.8rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div className="visualizer">
                {[0, 1, 2, 3, 4].map((i) => <div key={i} className="bar"></div>)}
              </div>
              <div style={{ display: "flex", gap: "0.4rem" }}>
                {user ? (
                  <button className="pill-button" style={{ fontSize: "0.85rem" }}
                    disabled={isTranscribing || !youtubeUrl} onClick={handleBackgroundTranscribe}
                    title="Queues the job in the cloud — you can close the tab right after.">
                    {isTranscribing ? "Processing..." : "☁️ Transcribe"}
                  </button>
                ) : (
                  <button className="pill-button" onClick={loginWithGoogle}>
                    Sign in to transcribe
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* ── Error ── */}
          {error && (
            <div className="col-span-12" style={{ color: "#ef4444", padding: "1rem",
              background: "rgba(239,68,68,0.1)", borderRadius: "var(--radius-lg)", fontSize: "0.9rem" }}>
              ⚠ {error}
            </div>
          )}

          {/* ── Background mode notification ── */}
          {bgMode && isTranscribing && (
            <div className="bento-card col-span-12" style={{ textAlign: "center", padding: "2rem",
              background: "linear-gradient(135deg, rgba(168,85,247,0.1), rgba(59,130,246,0.1))" }}>
              <p style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>
                {progress.status === "queued" ? "⏳" : "☁️"}
              </p>
              <h3 className="font-display" style={{ fontSize: "1.3rem", marginBottom: "0.5rem" }}>
                {progress.status === "uploading"
                  ? "上傳中 Uploading"
                  : progress.status === "queued"
                  ? "排隊中 In queue"
                  : "雲端轉錄中 Transcribing"}
              </h3>
              <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "1rem" }}>
                {progress.status === "uploading" ? (
                  <>上傳完成前請保持此分頁開啟。</>
                ) : progress.status === "queued" ? (
                  (progress.queueAhead ?? 0) > 0 ? (
                    <>前面還有 <strong>{progress.queueAhead}</strong> 個音檔正在排隊，輪到你會自動開始。</>
                  ) : (
                    <>即將開始處理…</>
                  )
                ) : (
                  <>上傳已完成 — 現在可以安全關閉此分頁。</>
                )}{" "}
                結果會自動存到你的{" "}
                <Link href="/history" style={{ color: "var(--accent-1)", fontWeight: 600 }}>歷史紀錄</Link>。
              </p>
              <div style={{ width: "100%", maxWidth: "400px", margin: "0 auto", height: "6px",
                background: "var(--bg-secondary)", borderRadius: "3px", overflow: "hidden" }}>
                <div style={{
                  width: progress.status === "queued"
                    ? "100%"
                    : `${progress.status === "uploading" ? overallProgress() : progress.progress}%`,
                  height: "100%",
                  background: progress.status === "queued"
                    ? "linear-gradient(90deg, transparent, var(--accent-1), var(--accent-2), transparent)"
                    : "linear-gradient(90deg, var(--accent-1), var(--accent-2))",
                  borderRadius: "3px", transition: "width 0.5s ease",
                  ...(progress.status === "queued"
                    ? { backgroundSize: "200% 100%", animation: "shimmer 1.5s infinite linear" }
                    : {}),
                }} />
              </div>
              <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>
                {progressLabel()}
              </p>
            </div>
          )}

          {/* ── Results Card ── */}
          {transcripts.length > 0 && (
            <div className="bento-card col-span-12" style={{ marginTop: "0.5rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.2rem" }}>
                <h2 className="font-display" style={{ fontSize: "1.8rem" }}>
                  Transcription Results ({transcripts.length})
                </h2>
                {transcripts.length > 1 && (
                  <button className="pill-button outline" style={{ padding: "0.5rem 1rem", fontSize: "0.8rem" }}
                    onClick={() => transcripts.forEach((t) => downloadTxt(t.filename, t.text))}>
                    Download All
                  </button>
                )}
              </div>
              {transcripts.map((t, i) => (
                <div key={i} style={{ marginBottom: "0.8rem", border: "1px solid var(--bg-secondary)",
                  borderRadius: "12px", overflow: "hidden" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "0.6rem 0.8rem", background: "var(--bg-secondary)" }}>
                    <span style={{ fontWeight: 600, fontSize: "0.85rem" }}>{t.filename}</span>
                    <div style={{ display: "flex", gap: "0.3rem" }}>
                      <button className="pill-button outline" style={{ padding: "0.25rem 0.6rem", fontSize: "0.7rem" }}
                        onClick={() => navigator.clipboard.writeText(t.text)}>Copy</button>
                      <button className="pill-button" style={{ padding: "0.25rem 0.6rem", fontSize: "0.7rem" }}
                        onClick={() => downloadTxt(t.filename, t.text)}>.txt</button>
                    </div>
                  </div>
                  <textarea className="transcript-display" readOnly value={t.text}
                    style={{ minHeight: "140px", borderRadius: 0, border: "none" }} />
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
