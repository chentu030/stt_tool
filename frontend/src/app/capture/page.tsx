"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import {
  loginWithGoogle, createJob, updateJobStatus, uploadFile, listenToJob, Job,
} from "@/lib/firebase";

export default function CapturePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState({ status: "", pct: 0, label: "" });
  const [extReady, setExtReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const API = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000/api";

  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window) return;
      if (e.data?.source === "stt-ext" && e.data.type === "READY") setExtReady(true);
    };
    window.addEventListener("message", onMsg);
    window.postMessage({ source: "stt-page", type: "PING" }, "*");
    return () => window.removeEventListener("message", onMsg);
  }, []);

  useEffect(() => () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
  }, []);

  const startRecording = async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const file = new File([blob], `recording-${Date.now()}.webm`, { type: "audio/webm" });
        setFiles((prev) => [...prev, file]);
        setYoutubeUrl("");
      };
      mediaRef.current = rec;
      rec.start();
      setRecording(true);
      setRecSecs(0);
      timerRef.current = window.setInterval(() => setRecSecs((s) => s + 1), 1000);
    } catch {
      setError("無法開啟麥克風，請檢查權限。");
    }
  };

  const stopRecording = () => {
    mediaRef.current?.stop();
    setRecording(false);
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const extractAndUpload = (
    url: string, uid: string, jobId: string, idToken: string,
    onProgress?: (stage: string, pct: number) => void,
  ) => new Promise<{ filename: string; storagePath: string }>((resolve, reject) => {
    const reqId = Math.random().toString(36).slice(2);
    const timer = setTimeout(() => reject(new Error("擴充逾時")), 900000);
    const onMsg = (e: MessageEvent) => {
      if (e.source !== window) return;
      const d = e.data;
      if (d?.source !== "stt-ext" || d.reqId !== reqId) return;
      if (d.type === "EXTRACT_PROGRESS") {
        onProgress?.(d.stage, d.pct ?? 0);
        return;
      }
      if (d.type !== "EXTRACT_RESULT") return;
      clearTimeout(timer);
      window.removeEventListener("message", onMsg);
      if (!d.result?.ok) reject(new Error(d.result?.error || "擷取失敗"));
      else resolve({ filename: d.result.filename, storagePath: d.result.storagePath });
    };
    window.addEventListener("message", onMsg);
    window.postMessage({ source: "stt-page", type: "EXTRACT_AND_UPLOAD", url, uid, jobId, idToken, reqId }, "*");
  });

  const submit = async () => {
    if (!user) return;
    if (!files.length && !youtubeUrl) {
      setError("請上傳檔案、貼上 YouTube，或先錄音。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const useExt = !files.length && !!youtubeUrl && extReady;
      let jobId = "";
      let storagePaths: string[] = [];
      let ytForServer = youtubeUrl;
      let sourceType: "upload" | "youtube" = files.length ? "upload" : "youtube";
      let filenames = files.length ? files.map((f) => f.name) : [youtubeUrl];

      if (useExt) {
        jobId = await createJob(user.uid, "upload", ["YouTube 音訊"], "");
        setProgress({ status: "extracting", pct: 0, label: "解析 YouTube…" });
        const token = await user.getIdToken();
        const r = await extractAndUpload(youtubeUrl, user.uid, jobId, token, (stage, pct) => {
          setProgress({
            status: stage === "uploading" ? "uploading" : "extracting",
            pct,
            label: stage === "parsing" ? "解析中…" : stage === "downloading" ? `下載 ${pct}%` : `上傳 ${pct}%`,
          });
        });
        storagePaths = [r.storagePath];
        filenames = [r.filename];
        await updateJobStatus(jobId, { status: "queued", storage_paths: storagePaths, filenames, total_files: 1 });
        ytForServer = "";
        sourceType = "upload";
      } else {
        jobId = await createJob(user.uid, sourceType, filenames, ytForServer);
        if (files.length) {
          for (let i = 0; i < files.length; i++) {
            const path = `uploads/${user.uid}/${jobId}/${files[i].name}`;
            setProgress({ status: "uploading", pct: 0, label: `上傳 ${files[i].name}` });
            await uploadFile(path, files[i], (pct) => setProgress((p) => ({ ...p, pct, label: `上傳 ${files[i].name} ${pct}%` })));
            storagePaths.push(path);
          }
          await updateJobStatus(jobId, { status: "queued", storage_paths: storagePaths });
        } else {
          await updateJobStatus(jobId, { status: "queued" });
        }
      }

      const token = await user.getIdToken();
      const fd = new FormData();
      fd.append("job_id", jobId);
      if (ytForServer) fd.append("youtube_url", ytForServer);
      fetch(`${API}/jobs/start`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      }).catch(() => {});

      // brief listen then navigate
      listenToJob(jobId, () => {});
      router.push(`/job/${jobId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "失敗");
      setBusy(false);
    }
  };

  if (loading) return <p style={{ color: "var(--text-muted)" }}>載入中…</p>;
  if (!user) {
    return (
      <div style={{ textAlign: "center", padding: "2rem" }}>
        <h1 className="page-title font-display">捕捉</h1>
        <p className="page-sub">登入後即可上傳、貼 YouTube 或錄音。</p>
        <button className="btn" onClick={() => loginWithGoogle()}>登入</button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <h1 className="page-title font-display">捕捉</h1>
      <p className="page-sub">把聲音變成可編輯的知識。完成後會進入逐字稿工作區。</p>

      <div className="card" style={{ padding: "1.25rem", marginBottom: "1rem" }}>
        <h2 className="font-display" style={{ fontSize: "1.1rem", marginBottom: "0.7rem" }}>上傳檔案</h2>
        <input ref={fileRef} type="file" multiple accept="audio/*,video/*" style={{ display: "none" }}
          onChange={(e) => {
            const list = e.target.files;
            if (list?.length) {
              setFiles((p) => [...p, ...Array.from(list)]);
              setYoutubeUrl("");
            }
            e.target.value = "";
          }} />
        <div
          className="upload-zone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files?.length) {
              setFiles((p) => [...p, ...Array.from(e.dataTransfer.files)]);
              setYoutubeUrl("");
            }
          }}
        >
          <p style={{ fontWeight: 600 }}>拖放音訊／影片到這裡</p>
          <button type="button" className="btn btn-sm" style={{ marginTop: "0.8rem" }} onClick={() => fileRef.current?.click()}>
            選擇檔案
          </button>
        </div>
        {files.length > 0 && (
          <ul style={{ marginTop: "0.8rem", listStyle: "none" }}>
            {files.map((f, i) => (
              <li key={i} style={{ display: "flex", justifyContent: "space-between", padding: "0.4rem 0", fontSize: "0.88rem" }}>
                <span>{f.name}</span>
                <button className="btn btn-ghost btn-sm" onClick={() => setFiles((p) => p.filter((_, idx) => idx !== i))}>移除</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="card" style={{ padding: "1.25rem", marginBottom: "1rem" }}>
        <h2 className="font-display" style={{ fontSize: "1.1rem", marginBottom: "0.7rem" }}>YouTube</h2>
        <input
          className="input"
          placeholder="https://youtube.com/..."
          value={youtubeUrl}
          onChange={(e) => { setYoutubeUrl(e.target.value); if (e.target.value) setFiles([]); }}
        />
        <p style={{ marginTop: "0.55rem", fontSize: "0.78rem", color: extReady ? "var(--ok)" : "var(--text-muted)" }}>
          {extReady ? "本機擷取器已啟用" : "未偵測到擴充：將走伺服器下載（可能較慢）"}
        </p>
      </div>

      <div className="card" style={{ padding: "1.25rem", marginBottom: "1rem" }}>
        <h2 className="font-display" style={{ fontSize: "1.1rem", marginBottom: "0.7rem" }}>即時錄音</h2>
        <div style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
          {!recording ? (
            <button className="btn" onClick={startRecording}>開始錄音</button>
          ) : (
            <button className="btn" style={{ background: "var(--danger)" }} onClick={stopRecording}>停止（{recSecs}s）</button>
          )}
          <span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>錄音會加入上方檔案列表</span>
        </div>
      </div>

      {error && (
        <div className="card" style={{ padding: "0.9rem", color: "var(--danger)", marginBottom: "0.8rem" }}>⚠ {error}</div>
      )}
      {busy && (
        <div className="card" style={{ padding: "1rem", marginBottom: "0.8rem" }}>
          <p style={{ marginBottom: "0.5rem", fontSize: "0.9rem" }}>{progress.label || "處理中…"}</p>
          <div className="progress-track"><div className="progress-fill" style={{ width: `${progress.pct || 20}%` }} /></div>
        </div>
      )}

      <button className="btn" style={{ width: "100%" }} disabled={busy} onClick={submit}>
        {busy ? "送出中…" : "開始轉錄"}
      </button>
    </div>
  );
}
