"use client";

import PageLoading from "@/components/motion/PageLoading";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { useAuth } from "@/components/AuthProvider";
import {
  loginWithGoogle, createJob, updateJobStatus, uploadFile, listenToJob, listenToUserJobs, jobDisplayTitle, type Job,
} from "@/lib/firebase";
import ScrambleText from "@/components/motion/ScrambleText";
import ShinyPill from "@/components/motion/ShinyPill";
import Link from "next/link";
import { libraryJobsUrl } from "@/lib/navApps";
import { toast } from "@/lib/toast";
import { usePrefsOptional } from "@/components/PrefsProvider";
import { loadPrefs } from "@/lib/userPrefs";

const YT_DRAFT_KEY = "cadence_capture_yt_draft";
const YT_RECENT_KEY = "cadence_capture_yt_recent";
const YT_RECENT_MAX = 5;

function loadYtDraft(): string {
  try {
    return localStorage.getItem(YT_DRAFT_KEY) || "";
  } catch {
    return "";
  }
}

function saveYtDraft(url: string) {
  try {
    if (url.trim()) localStorage.setItem(YT_DRAFT_KEY, url.trim());
    else localStorage.removeItem(YT_DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

function loadYtRecent(): string[] {
  try {
    const raw = localStorage.getItem(YT_RECENT_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    return Array.isArray(arr) ? arr.map(String).filter(Boolean).slice(0, YT_RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function pushYtRecent(url: string) {
  const u = url.trim();
  if (!looksLikeYoutube(u)) return;
  try {
    const next = [u, ...loadYtRecent().filter((x) => x !== u)].slice(0, YT_RECENT_MAX);
    localStorage.setItem(YT_RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

function looksLikeYoutube(text: string) {
  const t = text.trim();
  return /youtu\.be\/|youtube\.com\//i.test(t);
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRec(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function CapturePage() {
  const { user, loading } = useAuth();
  const prefsCtx = usePrefsOptional();
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [ytRecent, setYtRecent] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [recentJobs, setRecentJobs] = useState<Job[]>([]);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState({ status: "", pct: 0, label: "" });
  const [extReady, setExtReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const API = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000/api";

  useEffect(() => {
    if (!user) {
      setRecentJobs([]);
      return;
    }
    return listenToUserJobs(user.uid, (jobs) => setRecentJobs(jobs.slice(0, 5)));
  }, [user]);

  useEffect(() => {
    setYoutubeUrl(loadYtDraft());
    setYtRecent(loadYtRecent());
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => saveYtDraft(youtubeUrl), 400);
    return () => window.clearTimeout(t);
  }, [youtubeUrl]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!recording && !busy) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [recording, busy]);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const text = e.clipboardData?.getData("text") || "";
      if (!looksLikeYoutube(text)) return;
      e.preventDefault();
      const u = text.trim();
      setYoutubeUrl(u);
      setFiles([]);
      pushYtRecent(u);
      setYtRecent(loadYtRecent());
      toast("已貼上影片連結");
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

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

  const addFiles = (list: FileList | File[]) => {
    const arr = Array.from(list);
    if (!arr.length) return;
    setFiles((p) => [...p, ...arr]);
    setYoutubeUrl("");
    setError("");
  };

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
      setError("請上傳檔案、貼上連結，或先錄音。");
      toast("請先加入聲音來源");
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
        setProgress({ status: "extracting", pct: 0, label: "解析影片連結…" });
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
      const lang =
        prefsCtx?.prefs.captureLanguage || loadPrefs().captureLanguage || "auto";
      fd.append("language", lang);
      fetch(`${API}/jobs/start`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      }).catch(() => {});

      listenToJob(jobId, () => {});
      saveYtDraft("");
      if (youtubeUrl.trim()) {
        pushYtRecent(youtubeUrl.trim());
        setYtRecent(loadYtRecent());
      }
      setYoutubeUrl("");
      toast("已開始轉錄");
      router.push(`/job/${jobId}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "失敗";
      setError(msg);
      toast(msg);
      setBusy(false);
    }
  };

  const canSubmit = files.length > 0 || !!youtubeUrl.trim();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== "Enter") return;
      if (busy) return;
      if (!(files.length > 0 || youtubeUrl.trim())) return;
      e.preventDefault();
      void submit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, files, youtubeUrl]);

  if (loading) {
    return (
      <div className="capture-page">
        <PageLoading />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="capture-page">
        <div className="capture-stage">
          <ScrambleText words="捕捉" as="h1" className="capture-brand font-display" />
          <p className="capture-lead">登入後開始捕捉。</p>
          <ShinyPill onClick={() => loginWithGoogle()}>登入開始</ShinyPill>
        </div>
      </div>
    );
  }

  return (
    <div className="capture-page">
      <div className="capture-glow" aria-hidden />
      <motion.div
        className="capture-stage"
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      >
        <header className="capture-head">
          <ScrambleText words="捕捉" as="h1" className="capture-brand font-display" speed={22} />
          <p className="capture-lead">上傳、貼連結或錄音。</p>
        </header>

        <div className="capture-recent">
          <div className="capture-recent-head">
            <span>最近轉錄</span>
            <Link href={libraryJobsUrl()}>全部</Link>
          </div>
          {recentJobs.length > 0 ? (
            <ul className="capture-recent-list">
              {recentJobs.map((j) => (
                <li key={j.id}>
                  <Link href={`/job/${j.id}`}>
                    <strong>{jobDisplayTitle(j)}</strong>
                    <span>{j.status}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="capture-recent-empty">還沒有轉錄 · 上傳或錄音開始</p>
          )}
        </div>

        <input
          ref={fileRef}
          type="file"
          multiple
          accept="audio/*,video/*"
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = "";
          }}
        />

        <div
          className={`capture-drop${dragOver ? " is-over" : ""}${files.length ? " has-files" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
          }}
          onClick={() => !busy && fileRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              fileRef.current?.click();
            }
          }}
        >
          <div className="capture-wave" aria-hidden>
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <span key={i} style={{ animationDelay: `${i * 0.12}s` }} />
            ))}
          </div>
          <p className="capture-drop-title">拖放音訊或影片到這裡</p>
          <p className="capture-drop-hint">mp3 / wav / m4a / mp4</p>
          <button
            type="button"
            className="btn btn-soft btn-sm"
            style={{ marginTop: "1rem", pointerEvents: "none" }}
          >
            選擇檔案
          </button>
        </div>

        {files.length > 0 && (
          <ul className="capture-files">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`}>
                <div>
                  <strong>{f.name}</strong>
                  <span>{formatBytes(f.size)}</span>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFiles((p) => p.filter((_, idx) => idx !== i));
                  }}
                >
                  移除
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="capture-divider">
          <span>或用其他方式</span>
        </div>

        <div className="capture-alt">
          <label className="capture-yt">
            <span className="capture-yt-label">影片連結</span>
            <input
              className="input"
              placeholder="貼上 YouTube 網址…"
              value={youtubeUrl}
              disabled={busy || recording}
              onChange={(e) => {
                setYoutubeUrl(e.target.value);
                if (e.target.value) setFiles([]);
              }}
              onBlur={() => {
                if (looksLikeYoutube(youtubeUrl)) {
                  pushYtRecent(youtubeUrl);
                  setYtRecent(loadYtRecent());
                }
              }}
              onClick={(e) => e.stopPropagation()}
            />
            {ytRecent.length > 0 && (
              <div className="capture-yt-recent">
                {ytRecent.map((u) => (
                  <button
                    key={u}
                    type="button"
                    className="capture-yt-chip"
                    disabled={busy || recording}
                    title={u}
                    onClick={(e) => {
                      e.stopPropagation();
                      setYoutubeUrl(u);
                      setFiles([]);
                    }}
                  >
                    {u.replace(/^https?:\/\/(www\.)?/i, "").slice(0, 42)}
                    {u.length > 50 ? "…" : ""}
                  </button>
                ))}
              </div>
            )}
            <span className={`capture-ext${extReady ? " is-on" : ""}`}>
              {extReady ? "本機擷取已連線" : "伺服器下載（較慢）"}
            </span>
          </label>

          <div className="capture-rec">
            {!recording ? (
              <button
                type="button"
                className="capture-rec-btn"
                disabled={busy}
                onClick={startRecording}
              >
                <span className="capture-rec-dot" />
                開始錄音
              </button>
            ) : (
              <button
                type="button"
                className="capture-rec-btn is-live"
                onClick={stopRecording}
              >
                <span className="capture-rec-pulse" />
                停止 {formatRec(recSecs)}
              </button>
            )}
            <p>麥克風錄音會加入上方檔案列表</p>
          </div>
        </div>

        {error && <p className="capture-error">{error}</p>}

        {busy && (
          <div className="capture-progress">
            <div className="capture-progress-row">
              <span>{progress.label || "處理中…"}</span>
              <span>{Math.round(progress.pct || 0)}%</span>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${progress.pct || 12}%` }} />
            </div>
          </div>
        )}

        <div className="capture-cta">
          <ShinyPill
            disabled={busy || !canSubmit}
            onClick={() => { void submit(); }}
            style={{ width: "100%", padding: "0.95rem 1.4rem", fontSize: "1rem" }}
          >
            {busy ? "送出中…" : canSubmit ? "開始轉錄" : "先加入聲音來源"}
          </ShinyPill>
          <p className="capture-foot">完成後自動開啟逐字稿工作區</p>
        </div>
      </motion.div>
    </div>
  );
}
