"use client";

import { useState, useRef, useCallback } from "react";
import ThemeToggle from "@/components/ThemeToggle";

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
  const [files, setFiles] = useState<File[]>([]);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcripts, setTranscripts] = useState<FileTranscript[]>([]);
  const [error, setError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [progress, setProgress] = useState<ProgressInfo>({ fileIndex: 0, totalFiles: 0, filename: "", progress: 0, status: "" });
  const [liveText, setLiveText] = useState("");

  // YouTube OAuth
  const [ytAuth, setYtAuth] = useState<"none" | "pending" | "authorized">("none");
  const [ytUserCode, setYtUserCode] = useState("");
  const [ytVerifyUrl, setYtVerifyUrl] = useState("");
  const [ytTokenId, setYtTokenId] = useState("");
  const [ytDeviceCode, setYtDeviceCode] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000/api";

  // ─── File handling ──────────────────────────────────────────
  const addFiles = (newFiles: FileList | File[]) => {
    const arr = Array.from(newFiles);
    setFiles((prev) => [...prev, ...arr]);
    setYoutubeUrl("");
  };

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

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

  // ─── SSE stream reader ──────────────────────────────────────
  const readSSE = useCallback(async (response: Response) => {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

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
              setTranscripts((prev) => [...prev, { filename: d.filename, text: d.transcript }]);
              setLiveText("");
            } else if (d.status === "all_done") {
              setIsTranscribing(false);
            } else if (d.status === "error") {
              setError(d.detail || "Transcription failed");
              setIsTranscribing(false);
            }
          } catch { /* skip malformed */ }
        }
      }
    }
  }, []);

  // ─── Transcribe ─────────────────────────────────────────────
  const handleTranscribe = async () => {
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
        res = await fetch(`${API_BASE}/transcribe/upload`, { method: "POST", body: fd });
      } else {
        const fd = new FormData();
        fd.append("url", youtubeUrl);
        if (ytTokenId) fd.append("token_id", ytTokenId);
        res = await fetch(`${API_BASE}/transcribe/youtube`, { method: "POST", body: fd });
      }
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      await readSSE(res);
    } catch (err: any) {
      setError(err.message || "Failed");
      setIsTranscribing(false);
    }
  };

  // ─── YouTube OAuth ──────────────────────────────────────────
  const startYtAuth = async () => {
    try {
      const res = await fetch(`${API_BASE}/youtube/auth/start`, { method: "POST" });
      const data = await res.json();
      setYtUserCode(data.user_code);
      setYtVerifyUrl(data.verification_url);
      setYtDeviceCode(data.device_code);
      setYtAuth("pending");
      pollYtAuth(data.device_code, data.interval || 5);
    } catch {
      setError("Failed to start YouTube auth");
    }
  };

  const pollYtAuth = async (deviceCode: string, interval: number) => {
    const poll = async () => {
      const fd = new FormData();
      fd.append("device_code", deviceCode);
      const res = await fetch(`${API_BASE}/youtube/auth/poll`, { method: "POST", body: fd });
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
    el.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    el.download = filename.replace(/\.[^/.]+$/, "") + ".txt";
    document.body.appendChild(el);
    el.click();
    document.body.removeChild(el);
  };

  const downloadAll = () => {
    transcripts.forEach((t) => downloadTxt(t.filename, t.text));
  };

  // ─── Progress bar label ─────────────────────────────────────
  const progressLabel = () => {
    if (progress.status === "downloading") return "Downloading from YouTube...";
    if (progress.status === "download_complete") return "Download complete, starting transcription...";
    if (progress.totalFiles > 1)
      return `File ${progress.fileIndex}/${progress.totalFiles}: ${progress.filename} — ${progress.progress}%`;
    if (progress.filename)
      return `${progress.filename} — ${progress.progress}%`;
    return "Starting...";
  };

  const overallProgress = () => {
    if (progress.totalFiles <= 0) return 0;
    const fileDone = ((progress.fileIndex - 1) / progress.totalFiles) * 100;
    const filePart = (progress.progress / progress.totalFiles);
    return Math.min(Math.round(fileDone + filePart), 100);
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
          <div className="nav-menu"><ThemeToggle /></div>
        </nav>

        <section className="hero">
          <h1 className="font-display">
            Transcribing <span>voice</span><br />with the power of AI.
          </h1>
          <p style={{ fontSize: "1.1rem", maxWidth: "600px", margin: "0 auto", color: "var(--text-muted)" }}>
            Upload multiple audio/video files or paste a YouTube URL to generate accurate, timestamped transcripts powered by Whisper AI on GPU.
          </p>
        </section>

        <section className="bento-grid">
          {/* ── Card 1: File Upload ── */}
          <div className="bento-card col-span-8 card-purple" style={{ display: "flex", flexDirection: "column" }}>
            <h2 className="font-display" style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>Upload Media</h2>
            <p style={{ color: "rgba(0,0,0,0.6)", marginBottom: "1rem" }}>
              Drag and drop one or more audio/video files.
            </p>

            <div
              className={`upload-zone ${dragActive ? "active" : ""}`}
              onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              style={{ minHeight: files.length ? "120px" : "200px", flex: files.length ? undefined : 1 }}
            >
              <input ref={fileInputRef} type="file" multiple accept="audio/*,video/*"
                style={{ display: "none" }} onChange={handleFileInput} />
              <div className="upload-icon-large">
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
              </div>
              <p style={{ fontWeight: 600, fontSize: "1.1rem" }}>
                {files.length ? `${files.length} file(s) selected` : "Select or drop files"}
              </p>
              {!files.length && (
                <p style={{ fontSize: "0.85rem", color: "rgba(0,0,0,0.5)", marginTop: "0.4rem" }}>
                  MP4, MP3, M4A, WAV — multiple files supported
                </p>
              )}
            </div>

            {/* File queue */}
            {files.length > 0 && (
              <div style={{ marginTop: "1rem", maxHeight: "160px", overflowY: "auto" }}>
                {files.map((f, i) => (
                  <div key={i} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "0.4rem 0.6rem", borderRadius: "8px",
                    background: "rgba(0,0,0,0.05)", marginBottom: "0.3rem", fontSize: "0.85rem"
                  }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                      {f.name}
                    </span>
                    <span style={{ color: "rgba(0,0,0,0.4)", marginLeft: "0.5rem", whiteSpace: "nowrap" }}>
                      {(f.size / 1024 / 1024).toFixed(1)} MB
                    </span>
                    <button onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                      style={{ background: "none", border: "none", cursor: "pointer", marginLeft: "0.5rem",
                        color: "rgba(0,0,0,0.4)", fontSize: "1.1rem" }}>×</button>
                  </div>
                ))}
              </div>
            )}

            {files.length > 0 && (
              <div style={{ marginTop: "1rem", textAlign: "right" }}>
                <button className="pill-button" disabled={isTranscribing} onClick={handleTranscribe}>
                  {isTranscribing ? "Processing..." : `Transcribe ${files.length} file(s)`}
                </button>
              </div>
            )}
          </div>

          {/* ── Card 2: YouTube ── */}
          <div className="bento-card col-span-4 card-yellow" style={{ display: "flex", flexDirection: "column" }}>
            <h2 className="font-display" style={{ fontSize: "1.8rem", marginBottom: "0.5rem" }}>YouTube</h2>
            <p style={{ color: "rgba(0,0,0,0.6)", marginBottom: "1rem", fontSize: "0.85rem" }}>
              Paste a link to any video or playlist.
            </p>

            <input type="text" className="input-minimal" placeholder="https://youtube.com/..."
              value={youtubeUrl}
              onChange={(e) => { setYoutubeUrl(e.target.value); if (e.target.value) setFiles([]); }} />

            {/* YouTube OAuth */}
            <div style={{ marginTop: "0.75rem" }}>
              {ytAuth === "none" && (
                <button onClick={startYtAuth} className="pill-button outline"
                  style={{ width: "100%", padding: "0.5rem", fontSize: "0.8rem" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2" style={{ marginRight: "6px", verticalAlign: "middle" }}>
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0110 0v4" />
                  </svg>
                  Connect YouTube (private videos)
                </button>
              )}
              {ytAuth === "pending" && (
                <div style={{
                  padding: "0.6rem", borderRadius: "10px", background: "rgba(0,0,0,0.08)",
                  fontSize: "0.8rem", textAlign: "center"
                }}>
                  <p style={{ marginBottom: "0.4rem" }}>Go to:</p>
                  <a href={ytVerifyUrl} target="_blank" rel="noopener noreferrer"
                    style={{ color: "#2563eb", fontWeight: 700, textDecoration: "underline", fontSize: "0.9rem" }}>
                    {ytVerifyUrl}
                  </a>
                  <p style={{ margin: "0.5rem 0 0.3rem" }}>Enter code:</p>
                  <div style={{
                    fontFamily: "monospace", fontSize: "1.4rem", fontWeight: 800,
                    letterSpacing: "0.15em", color: "#000", padding: "0.3rem",
                    background: "rgba(255,255,255,0.8)", borderRadius: "6px"
                  }}>
                    {ytUserCode}
                  </div>
                  <p style={{ marginTop: "0.4rem", color: "rgba(0,0,0,0.4)", fontSize: "0.7rem" }}>
                    Waiting for authorization...
                  </p>
                </div>
              )}
              {ytAuth === "authorized" && (
                <div style={{
                  padding: "0.5rem", borderRadius: "10px", background: "rgba(34,197,94,0.15)",
                  fontSize: "0.85rem", textAlign: "center", color: "#15803d", fontWeight: 600
                }}>
                  ✓ YouTube connected
                </div>
              )}
            </div>

            <div style={{ marginTop: "auto", paddingTop: "1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div className="visualizer">
                {[0, 1, 2, 3, 4].map((i) => <div key={i} className="bar"></div>)}
              </div>
              <button className="icon-btn" style={{ width: "50px", height: "50px" }}
                disabled={isTranscribing || !youtubeUrl} onClick={handleTranscribe}>
                {isTranscribing ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" strokeDasharray="31" strokeDashoffset="10">
                      <animateTransform attributeName="transform" type="rotate"
                        from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite" />
                    </circle>
                  </svg>
                ) : "▶"}
              </button>
            </div>
          </div>

          {/* ── Error ── */}
          {error && (
            <div className="col-span-12" style={{
              color: "#ef4444", padding: "1rem", background: "rgba(239,68,68,0.1)",
              borderRadius: "var(--radius-lg)", fontSize: "0.95rem"
            }}>
              ⚠ {error}
            </div>
          )}

          {/* ── Progress Card ── */}
          {isTranscribing && (
            <div className="bento-card col-span-12" style={{ marginTop: "0.5rem" }}>
              <h2 className="font-display" style={{ fontSize: "1.4rem", marginBottom: "1rem" }}>Progress</h2>

              {/* Overall progress bar */}
              <div style={{ marginBottom: "0.5rem", fontSize: "0.9rem", color: "var(--text-muted)" }}>
                {progressLabel()}
              </div>
              <div style={{ width: "100%", height: "8px", background: "var(--bg-secondary)", borderRadius: "4px", overflow: "hidden" }}>
                <div style={{
                  width: `${progress.status === "downloading" ? 30 : overallProgress()}%`,
                  height: "100%",
                  background: "linear-gradient(90deg, var(--accent-1), var(--accent-2))",
                  borderRadius: "4px",
                  transition: "width 0.3s ease"
                }} />
              </div>

              {/* Single file progress */}
              {progress.totalFiles > 1 && progress.status === "transcribing" && (
                <div style={{ marginTop: "0.8rem" }}>
                  <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.3rem" }}>
                    Current file: {progress.progress}%
                  </div>
                  <div style={{ width: "100%", height: "4px", background: "var(--bg-secondary)", borderRadius: "2px", overflow: "hidden" }}>
                    <div style={{
                      width: `${progress.progress}%`, height: "100%",
                      background: "var(--accent-1)", borderRadius: "2px", transition: "width 0.3s ease"
                    }} />
                  </div>
                </div>
              )}

              {/* Live text preview */}
              {liveText && (
                <div style={{
                  marginTop: "1rem", maxHeight: "120px", overflowY: "auto",
                  fontSize: "0.8rem", fontFamily: "monospace", color: "var(--text-muted)",
                  background: "var(--bg-secondary)", padding: "0.8rem", borderRadius: "8px",
                  whiteSpace: "pre-wrap"
                }}>
                  {liveText.slice(-500)}
                </div>
              )}
            </div>
          )}

          {/* ── Results Card ── */}
          {transcripts.length > 0 && (
            <div className="bento-card col-span-12" style={{ marginTop: "0.5rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
                <h2 className="font-display" style={{ fontSize: "1.8rem" }}>
                  Transcription Results ({transcripts.length})
                </h2>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  {transcripts.length > 1 && (
                    <button className="pill-button outline" style={{ padding: "0.5rem 1rem", fontSize: "0.85rem" }}
                      onClick={downloadAll}>
                      Download All .txt
                    </button>
                  )}
                </div>
              </div>

              {transcripts.map((t, i) => (
                <div key={i} style={{
                  marginBottom: "1rem", border: "1px solid var(--bg-secondary)",
                  borderRadius: "12px", overflow: "hidden"
                }}>
                  <div style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "0.8rem 1rem", background: "var(--bg-secondary)"
                  }}>
                    <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>{t.filename}</span>
                    <div style={{ display: "flex", gap: "0.4rem" }}>
                      <button className="pill-button outline" style={{ padding: "0.3rem 0.7rem", fontSize: "0.75rem" }}
                        onClick={() => navigator.clipboard.writeText(t.text)}>
                        Copy
                      </button>
                      <button className="pill-button" style={{ padding: "0.3rem 0.7rem", fontSize: "0.75rem" }}
                        onClick={() => downloadTxt(t.filename, t.text)}>
                        .txt
                      </button>
                    </div>
                  </div>
                  <textarea className="transcript-display" readOnly value={t.text}
                    style={{ minHeight: "150px", borderRadius: 0, border: "none" }} />
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
