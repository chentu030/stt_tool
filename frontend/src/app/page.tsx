"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useAuth } from "@/components/AuthProvider";
import {
  loginWithGoogle, logout, createJob, updateJobStatus,
  uploadFile, listenToJob, Job,
} from "@/lib/firebase";
import ThemeToggle from "@/components/ThemeToggle";
import Link from "next/link";

interface FileTranscript {
  filename: string;
  text: string;
}

interface ProgressInfo {
  fileIndex: number;
  totalFiles: number;
  filename: string;
  progress: number;
  status: string;
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
    fileIndex: 0, totalFiles: 0, filename: "", progress: 0, status: "",
  });
  const [liveText, setLiveText] = useState("");
  const [uploadPct, setUploadPct] = useState(0);
  const [bgMode, setBgMode] = useState(false);
  const [bgJobId, setBgJobId] = useState<string | null>(null);

  // YouTube OAuth
  const [ytAuth, setYtAuth] = useState<"none" | "pending" | "authorized">("none");
  const [ytUserCode, setYtUserCode] = useState("");
  const [ytVerifyUrl, setYtVerifyUrl] = useState("");
  const [ytTokenId, setYtTokenId] = useState("");
  const [ytDeviceCode, setYtDeviceCode] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const API = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000/api";

  // ─── Listen to background job ───────────────────────────────
  useEffect(() => {
    if (!bgJobId) return;
    const unsub = listenToJob(bgJobId, (job: Job) => {
      setProgress({
        fileIndex: job.current_file, totalFiles: job.total_files,
        filename: job.filenames[job.current_file - 1] || "", progress: job.progress,
        status: job.status,
      });
      if (job.status === "done") {
        setTranscripts(job.transcripts || []);
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
    if (e.target.files?.length) addFiles(e.target.files);
    e.target.value = "";
  };

  // ─── SSE stream reader (instant mode) ───────────────────────
  const readSSE = useCallback(async (response: Response) => {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const completedTranscripts: FileTranscript[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop()!;

      for (const part of parts) {
        for (const line of part.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          try {
            const d = JSON.parse(line.slice(6));
            if (d.status === "transcribing") {
              setProgress({
                fileIndex: d.file_index || 0, totalFiles: d.total_files || 0,
                filename: d.filename || "", progress: d.progress || 0, status: "transcribing",
              });
              if (d.text) setLiveText((prev) => prev + d.text);
            } else if (d.status === "downloading") {
              setProgress((p) => ({ ...p, status: "downloading", filename: d.filename || "" }));
            } else if (d.status === "download_complete") {
              setProgress((p) => ({ ...p, status: "download_complete" }));
            } else if (d.status === "file_done") {
              completedTranscripts.push({ filename: d.filename, text: d.transcript });
              setTranscripts([...completedTranscripts]);
              setLiveText("");
            } else if (d.status === "all_done") {
              setIsTranscribing(false);
              // Auto-save to Firestore if logged in
              if (user && completedTranscripts.length > 0) {
                const jobId = await createJob(
                  user.uid, files.length ? "upload" : "youtube",
                  completedTranscripts.map((t) => t.filename),
                  youtubeUrl
                );
                await updateJobStatus(jobId, {
                  status: "done", progress: 100, transcripts: completedTranscripts,
                });
              }
            } else if (d.status === "error") {
              setError(d.detail || "Transcription failed");
              setIsTranscribing(false);
            }
          } catch { /* skip malformed */ }
        }
      }
    }
  }, [user, files, youtubeUrl]);

  // ─── Background mode (upload to Firebase, process in cloud) ─
  const handleBackgroundTranscribe = async () => {
    if (!user) return;
    setIsTranscribing(true);
    setError("");
    setTranscripts([]);
    setLiveText("");

    try {
      const filenames = files.map((f) => f.name);
      const jobId = await createJob(
        user.uid,
        files.length ? "upload" : "youtube",
        files.length ? filenames : [youtubeUrl],
        youtubeUrl
      );

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

      await fetch(`${API}/jobs/start`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });

      setBgJobId(jobId);
      setBgMode(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed";
      setError(msg);
      setIsTranscribing(false);
    }
  };

  // ─── Instant mode (SSE stream) ──────────────────────────────
  const handleInstantTranscribe = async () => {
    if (!files.length && !youtubeUrl) {
      setError("Please upload files or provide a YouTube URL.");
      return;
    }
    setIsTranscribing(true);
    setError("");
    setTranscripts([]);
    setLiveText("");
    setProgress({ fileIndex: 0, totalFiles: 0, filename: "", progress: 0, status: "" });

    try {
      let res: Response;
      if (files.length) {
        const fd = new FormData();
        files.forEach((f) => fd.append("files", f));
        res = await fetch(`${API}/transcribe/upload`, { method: "POST", body: fd });
      } else {
        const fd = new FormData();
        fd.append("url", youtubeUrl);
        if (ytTokenId) fd.append("token_id", ytTokenId);
        res = await fetch(`${API}/transcribe/youtube`, { method: "POST", body: fd });
      }
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      await readSSE(res);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed";
      setError(msg);
      setIsTranscribing(false);
    }
  };

  // ─── YouTube OAuth ──────────────────────────────────────────
  const startYtAuth = async () => {
    try {
      const res = await fetch(`${API}/youtube/auth/start`, { method: "POST" });
      const data = await res.json();
      setYtUserCode(data.user_code);
      setYtVerifyUrl(data.verification_url);
      setYtDeviceCode(data.device_code);
      setYtAuth("pending");
      pollYtAuth(data.device_code, data.interval || 5);
    } catch { setError("Failed to start YouTube auth"); }
  };

  const pollYtAuth = (deviceCode: string, interval: number) => {
    const poll = async () => {
      const fd = new FormData();
      fd.append("device_code", deviceCode);
      const res = await fetch(`${API}/youtube/auth/poll`, { method: "POST", body: fd });
      const data = await res.json();
      if (data.status === "authorized") {
        setYtTokenId(data.token_id);
        setYtAuth("authorized");
      } else if (data.status === "pending" || data.status === "slow_down") {
        setTimeout(poll, (data.status === "slow_down" ? interval + 5 : interval) * 1000);
      } else {
        setError(data.detail || "OAuth failed");
        setYtAuth("none");
      }
    };
    setTimeout(poll, interval * 1000);
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
    if (progress.status === "uploading") return `Uploading ${progress.filename}... ${progress.progress}%`;
    if (progress.status === "downloading") return "Downloading from YouTube...";
    if (progress.status === "download_complete") return "Download complete, starting transcription...";
    if (progress.totalFiles > 1 && progress.status === "transcribing")
      return `File ${progress.fileIndex}/${progress.totalFiles}: ${progress.filename} — ${progress.progress}%`;
    if (progress.filename && progress.status === "transcribing")
      return `${progress.filename} — ${progress.progress}%`;
    if (progress.status === "queued") return "Queued, waiting to start...";
    return "Starting...";
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

            <div className={`upload-zone ${dragActive ? "active" : ""}`}
              onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{ minHeight: files.length ? "100px" : "180px", flex: files.length ? undefined : 1 }}>
              <input ref={fileInputRef} type="file" multiple accept="audio/*,video/*"
                style={{ display: "none" }} onChange={handleFileInput} />
              <div className="upload-icon-large">
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
              </div>
              <p style={{ fontWeight: 600, fontSize: "1.05rem" }}>
                {files.length ? `${files.length} file(s) selected` : "Select or drop files"}
              </p>
              {!files.length && (
                <p style={{ fontSize: "0.8rem", color: "rgba(0,0,0,0.5)", marginTop: "0.3rem" }}>
                  MP4, MP3, M4A, WAV — multiple files supported
                </p>
              )}
            </div>

            {files.length > 0 && (
              <div style={{ marginTop: "0.8rem", maxHeight: "140px", overflowY: "auto" }}>
                {files.map((f, i) => (
                  <div key={i} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "0.35rem 0.5rem", borderRadius: "8px",
                    background: "rgba(0,0,0,0.05)", marginBottom: "0.25rem", fontSize: "0.8rem",
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
              <div style={{ marginTop: "0.8rem", display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                {user && (
                  <button className="pill-button outline" disabled={isTranscribing}
                    onClick={handleBackgroundTranscribe}
                    style={{ fontSize: "0.85rem" }}>
                    ☁️ Background
                  </button>
                )}
                <button className="pill-button" disabled={isTranscribing}
                  onClick={handleInstantTranscribe}>
                  {isTranscribing ? "Processing..." : `⚡ Transcribe ${files.length} file(s)`}
                </button>
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

            {/* YouTube OAuth */}
            <div style={{ marginTop: "0.6rem" }}>
              {ytAuth === "none" && (
                <button onClick={startYtAuth} className="pill-button outline"
                  style={{ width: "100%", padding: "0.45rem", fontSize: "0.75rem" }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2" style={{ marginRight: "5px", verticalAlign: "middle" }}>
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0110 0v4" />
                  </svg>
                  Connect YouTube (private)
                </button>
              )}
              {ytAuth === "pending" && (
                <div style={{ padding: "0.5rem", borderRadius: "10px", background: "rgba(0,0,0,0.08)", fontSize: "0.75rem", textAlign: "center" }}>
                  <p>Go to:</p>
                  <a href={ytVerifyUrl} target="_blank" rel="noopener noreferrer"
                    style={{ color: "#2563eb", fontWeight: 700, textDecoration: "underline", fontSize: "0.85rem" }}>
                    {ytVerifyUrl}
                  </a>
                  <p style={{ margin: "0.4rem 0 0.2rem" }}>Enter code:</p>
                  <div style={{ fontFamily: "monospace", fontSize: "1.3rem", fontWeight: 800,
                    letterSpacing: "0.12em", color: "#000", padding: "0.2rem",
                    background: "rgba(255,255,255,0.8)", borderRadius: "6px" }}>
                    {ytUserCode}
                  </div>
                  <p style={{ marginTop: "0.3rem", color: "rgba(0,0,0,0.4)", fontSize: "0.65rem" }}>
                    Waiting for authorization...
                  </p>
                </div>
              )}
              {ytAuth === "authorized" && (
                <div style={{ padding: "0.4rem", borderRadius: "10px", background: "rgba(34,197,94,0.15)",
                  fontSize: "0.8rem", textAlign: "center", color: "#15803d", fontWeight: 600 }}>
                  ✓ YouTube connected
                </div>
              )}
            </div>

            <div style={{ marginTop: "auto", paddingTop: "0.8rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div className="visualizer">
                {[0, 1, 2, 3, 4].map((i) => <div key={i} className="bar"></div>)}
              </div>
              <div style={{ display: "flex", gap: "0.4rem" }}>
                {user && youtubeUrl && (
                  <button className="pill-button outline" style={{ fontSize: "0.7rem", padding: "0.35rem 0.6rem" }}
                    disabled={isTranscribing} onClick={handleBackgroundTranscribe}>
                    ☁️
                  </button>
                )}
                <button className="icon-btn" style={{ width: "46px", height: "46px" }}
                  disabled={isTranscribing || !youtubeUrl} onClick={handleInstantTranscribe}>
                  {isTranscribing ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" strokeDasharray="31" strokeDashoffset="10">
                        <animateTransform attributeName="transform" type="rotate"
                          from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite" />
                      </circle>
                    </svg>
                  ) : "▶"}
                </button>
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
              <p style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>☁️</p>
              <h3 className="font-display" style={{ fontSize: "1.3rem", marginBottom: "0.5rem" }}>
                Processing in background
              </h3>
              <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "1rem" }}>
                You can safely close this page. Check your{" "}
                <Link href="/history" style={{ color: "var(--accent-1)", fontWeight: 600 }}>history</Link>{" "}
                later for results.
              </p>
              <div style={{ width: "100%", maxWidth: "400px", margin: "0 auto", height: "6px",
                background: "var(--bg-secondary)", borderRadius: "3px", overflow: "hidden" }}>
                <div style={{ width: `${overallProgress()}%`, height: "100%",
                  background: "linear-gradient(90deg, var(--accent-1), var(--accent-2))",
                  borderRadius: "3px", transition: "width 0.5s ease" }} />
              </div>
              <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>
                {progressLabel()}
              </p>
            </div>
          )}

          {/* ── Progress Card (instant mode) ── */}
          {isTranscribing && !bgMode && (
            <div className="bento-card col-span-12" style={{ marginTop: "0.5rem" }}>
              <h2 className="font-display" style={{ fontSize: "1.4rem", marginBottom: "1rem" }}>Progress</h2>
              <div style={{ marginBottom: "0.5rem", fontSize: "0.85rem", color: "var(--text-muted)" }}>
                {progressLabel()}
              </div>
              <div style={{ width: "100%", height: "8px", background: "var(--bg-secondary)",
                borderRadius: "4px", overflow: "hidden" }}>
                <div style={{
                  width: `${progress.status === "downloading" ? 30 : overallProgress()}%`,
                  height: "100%",
                  background: "linear-gradient(90deg, var(--accent-1), var(--accent-2))",
                  borderRadius: "4px", transition: "width 0.3s ease",
                }} />
              </div>
              {progress.totalFiles > 1 && progress.status === "transcribing" && (
                <div style={{ marginTop: "0.6rem" }}>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.2rem" }}>
                    Current file: {progress.progress}%
                  </div>
                  <div style={{ width: "100%", height: "4px", background: "var(--bg-secondary)",
                    borderRadius: "2px", overflow: "hidden" }}>
                    <div style={{ width: `${progress.progress}%`, height: "100%",
                      background: "var(--accent-1)", borderRadius: "2px", transition: "width 0.3s ease" }} />
                  </div>
                </div>
              )}
              {liveText && (
                <div style={{ marginTop: "0.8rem", maxHeight: "100px", overflowY: "auto", fontSize: "0.75rem",
                  fontFamily: "monospace", color: "var(--text-muted)", background: "var(--bg-secondary)",
                  padding: "0.6rem", borderRadius: "8px", whiteSpace: "pre-wrap" }}>
                  {liveText.slice(-500)}
                </div>
              )}
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
