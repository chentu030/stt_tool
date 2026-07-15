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

  // Browser extension ("web TubeMate") that grabs YouTube audio on the user's IP
  const [extReady, setExtReady] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

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
        setError(job.error_message || "處理失敗");
        setIsTranscribing(false);
        setBgJobId(null);
      }
    });
    return unsub;
  }, [bgJobId]);

  // ─── Detect the YouTube extractor extension ─────────────────
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window) return;
      const d = e.data;
      if (d?.source === "stt-ext" && d.type === "READY") setExtReady(true);
    };
    window.addEventListener("message", onMsg);
    // Ask the extension (if installed) to announce itself.
    window.postMessage({ source: "stt-page", type: "PING" }, "*");
    return () => window.removeEventListener("message", onMsg);
  }, []);

  // Extension: parse → download → upload to Firebase directly (no slow base64).
  const extractAndUploadYouTube = (
    url: string,
    uid: string,
    jobId: string,
    idToken: string,
    onProgress?: (stage: string, pct: number) => void,
  ): Promise<{ filename: string; storagePath: string; bytes: number }> =>
    new Promise((resolve, reject) => {
      const reqId = Math.random().toString(36).slice(2);
      const cleanup = () => {
        clearTimeout(timer);
        window.removeEventListener("message", onMsg);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("擴充功能逾時（超過 15 分鐘，可能是影片太長或網路太慢）"));
      }, 900000);
      const onMsg = (e: MessageEvent) => {
        if (e.source !== window) return;
        const d = e.data;
        if (d?.source !== "stt-ext" || d.reqId !== reqId) return;
        if (d.type === "EXTRACT_PROGRESS") {
          onProgress?.(d.stage, d.pct ?? 0);
          return;
        }
        if (d.type !== "EXTRACT_RESULT") return;
        cleanup();
        const r = d.result;
        if (!r?.ok) return reject(new Error(r?.error || "擷取失敗"));
        resolve({ filename: r.filename, storagePath: r.storagePath, bytes: r.bytes });
      };
      window.addEventListener("message", onMsg);
      window.postMessage(
        { source: "stt-page", type: "EXTRACT_AND_UPLOAD", url, uid, jobId, idToken, reqId },
        "*",
      );
    });

  const [extractStage, setExtractStage] = useState("");

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
    // If a YouTube URL is given and the extension is installed, grab the audio
    // locally (user's IP) and treat it as a normal upload — no server download,
    // no proxy, no bot check.
    const useExtension = !files.length && !!youtubeUrl && extReady;
    setProgress({
      fileIndex: 0, totalFiles: files.length || 1, filename: "", progress: 0,
      status: useExtension ? "extracting" : files.length ? "uploading" : "queued",
      positionLabel: "",
    });

    try {
      let uploadList: File[] = files;
      let sourceType: "upload" | "youtube" = files.length ? "upload" : "youtube";
      let ytForServer = youtubeUrl;
      let storagePaths: string[] = [];
      let jobId = "";

      if (useExtension) {
        // Create job first, then let extension upload directly to Storage.
        jobId = await createJob(user.uid, "upload", ["YouTube 音訊"], "");
        setBgJobId(jobId);
        setExtractStage("parsing");
        const token = await user.getIdToken();

        const extResult = await extractAndUploadYouTube(
          youtubeUrl,
          user.uid,
          jobId,
          token,
          (stage, pct) => {
            setExtractStage(stage);
            setProgress({
              fileIndex: 1, totalFiles: 1,
              filename: stage === "parsing" ? "解析 YouTube…" : stage === "downloading" ? "下載音訊…" : "上傳中…",
              progress: pct,
              status: stage === "uploading" ? "uploading" : "extracting",
            });
            if (stage === "uploading") setUploadPct(pct);
          },
        );

        storagePaths = [extResult.storagePath];
        await updateJobStatus(jobId, {
          status: "queued",
          storage_paths: storagePaths,
          filenames: [extResult.filename],
          total_files: 1,
        });
        sourceType = "upload";
        ytForServer = "";
        uploadList = [];
      } else {
        const filenames = uploadList.length ? uploadList.map((f) => f.name) : [youtubeUrl];
        jobId = await createJob(user.uid, sourceType, filenames, ytForServer);
        setBgJobId(jobId);

        if (uploadList.length) {
          for (let i = 0; i < uploadList.length; i++) {
            const path = `uploads/${user.uid}/${jobId}/${uploadList[i].name}`;
            setUploadPct(0);
            setProgress({
              fileIndex: i + 1, totalFiles: uploadList.length,
              filename: uploadList[i].name, progress: 0, status: "uploading",
            });
            await uploadFile(path, uploadList[i], (pct) => {
              setUploadPct(pct);
              setProgress((p) => ({ ...p, progress: pct }));
            });
            storagePaths.push(path);
          }
          await updateJobStatus(jobId, { status: "queued", storage_paths: storagePaths });
        } else {
          await updateJobStatus(jobId, { status: "queued" });
        }
      }

      // Start backend processing
      const token = await user.getIdToken();
      const fd = new FormData();
      fd.append("job_id", jobId);
      if (ytForServer) fd.append("youtube_url", ytForServer);
      if (ytForServer && ytTokenId) fd.append("yt_token_id", ytTokenId);

      // Fire-and-forget: keeps the request open (so Cloud Run keeps processing),
      // but the Firestore listener is the source of truth for progress/results,
      // so a dropped connection here won't clobber a completed job.
      fetch(`${API}/jobs/start`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      }).catch((e) => console.error("jobs/start request:", e));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "失敗";
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
        setError(`Cookie 上傳失敗：${errText}`);
        return;
      }
      const data = await res.json();
      setYtTokenId(data.cookie_id);
      setYtAuth("authorized");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "未知錯誤";
      setError(`Cookie 上傳錯誤：${msg}`);
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
    if (progress.status === "extracting") {
      if (extractStage === "downloading")
        return `下載 YouTube 音訊… ${progress.progress}%`;
      if (extractStage === "parsing")
        return "解析 YouTube 影片…";
      return "正在擷取 YouTube 音訊…";
    }
    if (progress.status === "uploading")
      return `⬆ 上傳中${progress.totalFiles > 1 ? ` 檔案 ${progress.fileIndex}/${progress.totalFiles}` : ""}：${uploadPct}%`;
    if (progress.status === "downloading") return "正在從 YouTube 下載…";
    if (progress.status === "download_complete") return "下載完成，開始轉錄…";
    if (progress.status === "transcribing") {
      const filePart = progress.totalFiles > 1
        ? `檔案 ${progress.fileIndex}/${progress.totalFiles}：${progress.filename}`
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
                歷史紀錄
              </Link>
            )}
            {authLoading ? null : user ? (
              <button onClick={logout} className="pill-button outline"
                style={{ display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.3rem 0.7rem", fontSize: "0.8rem" }}>
                <img src={user.photoURL || ""} alt="" width={22} height={22}
                  style={{ borderRadius: "50%" }} />
                登出
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
                登入
              </button>
            )}
            <ThemeToggle />
          </div>
        </nav>

        <section className="hero">
          <h1 className="font-display">
            用 AI 轉錄<span>語音</span><br />快速又精準。
          </h1>
          <p style={{ fontSize: "1.1rem", maxWidth: "600px", margin: "0 auto", color: "var(--text-muted)" }}>
            上傳多個音訊／影片檔，或貼上 YouTube 連結。{user ? "結果會自動幫你儲存。" : "登入即可自動儲存結果。"}
          </p>
        </section>

        <section className="bento-grid">
          {/* ── Card 1: File Upload ── */}
          <div className="bento-card col-span-8 card-purple" style={{ display: "flex", flexDirection: "column" }}>
            <h2 className="font-display" style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>上傳媒體</h2>
            <p style={{ color: "rgba(0,0,0,0.6)", marginBottom: "1rem" }}>
              拖放一個或多個音訊／影片檔案。
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
                {files.length ? `已選擇 ${files.length} 個檔案` : "把檔案拖放到這裡"}
              </p>
              {!files.length && (
                <button type="button" className="pill-button" onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                  style={{ marginTop: "0.7rem", fontSize: "0.9rem", padding: "0.5rem 1.5rem" }}>
                  📁 選擇檔案
                </button>
              )}
              {!files.length && (
                <p style={{ fontSize: "0.8rem", color: "rgba(0,0,0,0.5)", marginTop: "0.5rem" }}>
                  支援 MP4、MP3、M4A、WAV —— 可多檔一次上傳
                </p>
              )}
              {files.length > 0 && (
                <button type="button" className="pill-button outline" onClick={(e) => {
                    e.stopPropagation();
                    fileInputRef.current?.click();
                  }}
                  style={{ marginTop: "0.5rem", fontSize: "0.8rem", padding: "0.35rem 1rem" }}>
                  + 再新增檔案
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
                    title="會顯示上傳進度、支援大型檔案，上傳完成後即可關閉分頁。">
                    {isTranscribing ? "處理中…" : `☁️ 轉錄 ${files.length} 個檔案`}
                  </button>
                ) : (
                  <button className="pill-button" onClick={loginWithGoogle}>
                    登入以開始轉錄
                  </button>
                )}
              </div>
            )}
          </div>

          {/* ── Card 2: YouTube ── */}
          <div className="bento-card col-span-4 card-yellow" style={{ display: "flex", flexDirection: "column" }}>
            <h2 className="font-display" style={{ fontSize: "1.8rem", marginBottom: "0.5rem" }}>YouTube</h2>
            <p style={{ color: "rgba(0,0,0,0.6)", marginBottom: "0.8rem", fontSize: "0.8rem" }}>
              貼上任何影片的連結。
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
                  上傳 cookies.txt（私人影片用）
                </button>
              )}
              {ytAuth === "authorized" && (
                <div style={{ padding: "0.4rem", borderRadius: "10px", background: "rgba(34,197,94,0.15)",
                  fontSize: "0.8rem", textAlign: "center", color: "#15803d", fontWeight: 600 }}>
                  ✓ 已載入 YouTube cookies
                </div>
              )}
            </div>

            <div style={{ marginTop: "0.6rem", fontSize: "0.72rem", lineHeight: 1.4,
              color: extReady ? "#15803d" : "rgba(0,0,0,0.5)" }}>
              {extReady
                ? "⚡ 本機擷取器已啟用 — 用你自己的 IP 下載，免代理、免 cookies（公開影片）。"
                : "提示：安裝瀏覽器擴充後，可用你自己的 IP 直接下載，避開伺服器被封鎖。"}
            </div>

            <div style={{ marginTop: "auto", paddingTop: "0.8rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div className="visualizer">
                {[0, 1, 2, 3, 4].map((i) => <div key={i} className="bar"></div>)}
              </div>
              <div style={{ display: "flex", gap: "0.4rem" }}>
                {user ? (
                  <button className="pill-button" style={{ fontSize: "0.85rem" }}
                    disabled={isTranscribing || !youtubeUrl} onClick={handleBackgroundTranscribe}
                    title="工作會排入雲端佇列 —— 之後即可關閉分頁。">
                    {isTranscribing ? "處理中…" : "☁️ 開始轉錄"}
                  </button>
                ) : (
                  <button className="pill-button" onClick={loginWithGoogle}>
                    登入以開始轉錄
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* ── Extension install guide ── */}
          <div className="bento-card col-span-12" style={{ padding: "1.2rem 1.5rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.6rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                <span style={{ fontSize: "1.4rem" }}>{extReady ? "✅" : "🧩"}</span>
                <div>
                  <h3 className="font-display" style={{ fontSize: "1.15rem", margin: 0 }}>
                    YouTube 本機擷取器
                  </h3>
                  <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--text-muted)" }}>
                    {extReady
                      ? "已安裝並啟用 —— 貼上 YouTube 網址就會用你自己的 IP 下載。"
                      : "安裝這個瀏覽器擴充，就能用你自己的 IP 下載 YouTube 音訊，避開伺服器被封鎖（免代理、免 cookies）。"}
                  </p>
                </div>
              </div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <a className="pill-button" href="/youtube-extractor.zip" download
                  style={{ textDecoration: "none", fontSize: "0.85rem", padding: "0.5rem 1.1rem" }}>
                  ⬇️ 下載擴充
                </a>
                <button className="pill-button outline" style={{ fontSize: "0.85rem", padding: "0.5rem 1.1rem" }}
                  onClick={() => setShowGuide((v) => !v)}>
                  {showGuide ? "收合教學" : "安裝教學"}
                </button>
              </div>
            </div>

            {showGuide && (
              <div style={{ marginTop: "1.2rem", borderTop: "1px solid var(--bg-secondary)", paddingTop: "1.2rem",
                fontSize: "0.9rem", lineHeight: 1.9 }}>
                <ol style={{ margin: 0, paddingLeft: "1.3rem" }}>
                  <li>點上方「<strong>⬇️ 下載擴充</strong>」，取得 <code>youtube-extractor.zip</code>。</li>
                  <li>
                    對下載的 zip 按右鍵 →「<strong>解壓縮全部</strong>」，解到任何一個好找的資料夾
                    （例如桌面）。<br />
                    <span style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>
                      解壓後會得到一個資料夾，裡面要有 <code>manifest.json</code> 這個檔案。
                    </span>
                  </li>
                  <li>
                    打開 Chrome 或 Edge，在網址列輸入下面這行並按 Enter：
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", margin: "0.4rem 0" }}>
                      <code style={{ background: "var(--bg-secondary)", padding: "0.25rem 0.6rem", borderRadius: "6px" }}>
                        chrome://extensions
                      </code>
                      <button className="pill-button outline" style={{ fontSize: "0.72rem", padding: "0.2rem 0.6rem" }}
                        onClick={() => navigator.clipboard.writeText("chrome://extensions")}>
                        複製
                      </button>
                      <span style={{ color: "var(--text-muted)", fontSize: "0.8rem" }}>
                        （Edge 請用 <code>edge://extensions</code>）
                      </span>
                    </div>
                  </li>
                  <li>打開右上角的「<strong>開發人員模式 / Developer mode</strong>」開關。</li>
                  <li>點左上角「<strong>載入未封裝項目 / Load unpacked</strong>」，選剛剛解壓縮出來的資料夾。</li>
                  <li>回到本頁按 <strong>F5 重新整理</strong>，看到上方變成「✅ 已啟用」就完成了。</li>
                </ol>
                <p style={{ marginTop: "0.8rem", marginBottom: 0, color: "var(--text-muted)", fontSize: "0.82rem" }}>
                  註：目前支援公開影片的單一影片；私人／會員影片請改用 YouTube 卡片的「上傳 cookies.txt」。
                </p>
              </div>
            )}
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
                {progress.status === "queued" ? "⏳" : progress.status === "extracting" ? "🎧" : "☁️"}
              </p>
              <h3 className="font-display" style={{ fontSize: "1.3rem", marginBottom: "0.5rem" }}>
                {progress.status === "extracting"
                  ? "擷取音訊中"
                  : progress.status === "uploading"
                  ? "上傳中"
                  : progress.status === "queued"
                  ? "排隊中"
                  : "雲端轉錄中"}
              </h3>
              <p style={{ color: "var(--text-muted)", fontSize: "0.9rem", marginBottom: "1rem" }}>
                {progress.status === "extracting" ? (
                  <>正在背景開啟 YouTube 分頁擷取音訊，可能會短暫看到新分頁，完成後會自動關閉。請保持此分頁開啟。</>
                ) : progress.status === "uploading" ? (
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
                  width: progress.status === "queued" || progress.status === "extracting"
                    ? "100%"
                    : `${progress.status === "uploading" ? overallProgress() : progress.progress}%`,
                  height: "100%",
                  background: progress.status === "queued" || progress.status === "extracting"
                    ? "linear-gradient(90deg, transparent, var(--accent-1), var(--accent-2), transparent)"
                    : "linear-gradient(90deg, var(--accent-1), var(--accent-2))",
                  borderRadius: "3px", transition: "width 0.5s ease",
                  ...(progress.status === "queued" || progress.status === "extracting"
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
                  轉錄結果（{transcripts.length}）
                </h2>
                {transcripts.length > 1 && (
                  <button className="pill-button outline" style={{ padding: "0.5rem 1rem", fontSize: "0.8rem" }}
                    onClick={() => transcripts.forEach((t) => downloadTxt(t.filename, t.text))}>
                    全部下載
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
                        onClick={() => navigator.clipboard.writeText(t.text)}>複製</button>
                      <button className="pill-button" style={{ padding: "0.25rem 0.6rem", fontSize: "0.7rem" }}
                        onClick={() => downloadTxt(t.filename, t.text)}>下載 .txt</button>
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
