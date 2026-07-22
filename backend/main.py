import os
import shutil
import tempfile
import glob
import json
import uuid
import subprocess
import asyncio
import threading
import time
import random
import requests
from typing import Optional, Dict, List, Callable
from concurrent.futures import ThreadPoolExecutor
from fastapi import FastAPI, File, UploadFile, HTTPException, Form, Header, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import queue as thread_queue
import yt_dlp
import replicate
import httpx

# ─── Firebase Admin ──────────────────────────────────────────────
import firebase_admin
from firebase_admin import credentials as fb_creds, firestore, storage as fb_storage, auth as fb_auth
from google.cloud.firestore_v1.base_query import FieldFilter

import base64
import re
import html
import mimetypes
from urllib.parse import quote
sa_key_json = os.environ.get("FIREBASE_SA_KEY")
sa_key_b64 = os.environ.get("FIREBASE_SA_KEY_B64")
if sa_key_b64:
    sa_key_json = base64.b64decode(sa_key_b64).decode("utf-8")
if sa_key_json:
    cred = fb_creds.Certificate(json.loads(sa_key_json))
    firebase_admin.initialize_app(cred, {"storageBucket": "stt-tool-f6e6d.firebasestorage.app"})
else:
    firebase_admin.initialize_app(options={"storageBucket": "stt-tool-f6e6d.firebasestorage.app"})

fstore = firestore.client()
bucket = fb_storage.bucket()

# ─── FastAPI ─────────────────────────────────────────────────────
app = FastAPI(title="Transcription API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Replicate API ───────────────────────────────────────────────
REPLICATE_API_TOKEN = os.environ.get("REPLICATE_API_TOKEN", "")
if REPLICATE_API_TOKEN:
    os.environ["REPLICATE_API_TOKEN"] = REPLICATE_API_TOKEN
print(f"Replicate API configured: {'yes' if REPLICATE_API_TOKEN else 'NO TOKEN!'}")

# The default replicate client only allows a 30s read/write timeout, which is far
# too short for uploading a whole audio file and waiting on a long transcription.
# Use a generous timeout so big files and long predictions don't get cut off.
_replicate_client = replicate.Client(
    api_token=REPLICATE_API_TOKEN or None,
    timeout=httpx.Timeout(600.0, connect=15.0),
)

# incredibly-fast-whisper: L40S GPU, batched + flash-attn. ~10-20x faster than openai/whisper.
WHISPER_MODEL = (
    "vaibhavs10/incredibly-fast-whisper:"
    "3ab86df6c8f54c11309d4d1f930ac292bad43ace52d10c80d87eb258b3c9f79c"
)
DEFAULT_LANGUAGE = os.environ.get("WHISPER_LANGUAGE", "None")


def _normalize_whisper_language(raw: Optional[str]) -> str:
    """Map UI / env language prefs to incredibly-fast-whisper language codes.

    \"None\" means auto-detect (do not force a language).

    UI \"zh-TW\" / \"zh-CN\" intentionally map to None: forcing ``chinese`` on
    English audio makes Whisper emit Chinese gibberish / pseudo-translation.
    Chinese results are still normalized to Traditional via OpenCC afterward.
    """
    v = (raw or "").strip()
    if not v or v.lower() in ("none", "auto", "detect", "null"):
        return "None"
    key = v.lower().replace("_", "-")
    # Prefer Traditional Chinese in the product UI — do NOT force ASR language.
    if key in ("zh", "zh-tw", "zh-cn", "zh-hk", "chinese", "cht", "chs"):
        return "None"
    mapping = {
        "en": "english",
        "english": "english",
        "ja": "japanese",
        "jp": "japanese",
        "japanese": "japanese",
        "ko": "korean",
        "korean": "korean",
        "yue": "cantonese",
        "cantonese": "cantonese",
    }
    return mapping.get(key, v)

# Split long audio into chunks so we can report real position progress
# and keep each Replicate request small & stable.
CHUNK_SEC = int(os.environ.get("CHUNK_SEC", "600"))  # 10 min per chunk

# ─── Cloud Tasks (background jobs that survive closing the browser) ──────────
# Project NUMBER is embedded in the Cloud Run URL (whisper-api-<number>...).
GCP_PROJECT = os.environ.get("GCP_PROJECT", "1016448029865")
TASKS_LOCATION = os.environ.get("TASKS_LOCATION", "asia-east1")
TASKS_QUEUE = os.environ.get("TASKS_QUEUE", "whisper-jobs")
SERVICE_URL = os.environ.get("SERVICE_URL", "")  # e.g. https://whisper-api-...run.app
TASK_SECRET = os.environ.get("TASK_SECRET", "")

def _enqueue_task(job_id: str) -> bool:
    """Enqueue a Cloud Task that will POST /api/jobs/process. Returns False if
    Cloud Tasks isn't configured (caller then falls back to inline processing)."""
    if not (SERVICE_URL and TASK_SECRET and GCP_PROJECT):
        return False
    try:
        from google.cloud import tasks_v2
        from google.protobuf import duration_pb2
        client = tasks_v2.CloudTasksClient()
        parent = client.queue_path(GCP_PROJECT, TASKS_LOCATION, TASKS_QUEUE)
        task = {
            "http_request": {
                "http_method": tasks_v2.HttpMethod.POST,
                "url": f"{SERVICE_URL}/api/jobs/process",
                "headers": {"Content-Type": "application/json", "X-Task-Secret": TASK_SECRET},
                "body": json.dumps({"job_id": job_id}).encode(),
            },
            "dispatch_deadline": duration_pb2.Duration(seconds=1800),  # 30 min (HTTP task max)
        }
        client.create_task(parent=parent, task=task)
        return True
    except Exception as e:
        print(f"[tasks] enqueue failed, will process inline: {e}")
        return False

def _delete_uploads(job_data: dict):
    """Delete the uploaded source audio from Storage (results are kept)."""
    for sp in job_data.get("storage_paths", []):
        try:
            bucket.blob(sp).delete()
        except Exception:
            pass

# ─── YouTube Cookie Auth ─────────────────────────────────────────
_cookies: Dict[str, str] = {}  # cookie_id -> cookie file content

# ─── Background task executor ───────────────────────────────────
executor = ThreadPoolExecutor(max_workers=4)

# How many files inside a single job are transcribed in parallel. Each file is
# an ffmpeg extraction (CPU burst) + a Replicate call (mostly network wait), so
# overlapping them speeds up multi-file jobs a lot. Bounded to avoid CPU/Replicate
# overload on one instance.
FILE_PARALLELISM = int(os.environ.get("FILE_PARALLELISM", "4"))

# ─── Helpers ─────────────────────────────────────────────────────
def _hhmmss(s: float) -> str:
    s = max(0, int(s))
    return f"{s//3600:02d}:{s%3600//60:02d}:{s%60:02d}"

def _sse(data: dict, event: str = "progress") -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"

def _ffprobe_duration(path: str) -> float:
    """Return audio/video duration in seconds, or 0.0 if unknown."""
    try:
        out = subprocess.check_output(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", path],
            stderr=subprocess.STDOUT,
        )
        return float(out.decode().strip())
    except Exception:
        return 0.0

def _extract_audio(src: str, dst: str, start: Optional[float] = None, dur: Optional[float] = None):
    """Extract (and re-encode) audio to 16kHz mono mp3. Optionally a [start, start+dur] slice."""
    cmd = ["ffmpeg", "-y", "-loglevel", "error"]
    if start is not None and start > 0:
        cmd += ["-ss", str(start)]
    cmd += ["-i", src]
    if dur is not None:
        cmd += ["-t", str(dur)]
    cmd += ["-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-q:a", "5", dst]
    subprocess.run(cmd, check=True, capture_output=True)

def _plan_segments(total: float) -> List[tuple]:
    """Return list of (start, dur|None). Single whole-file segment if short/unknown."""
    if total <= 0 or total <= CHUNK_SEC:
        return [(0.0, None)]
    segs = []
    s = 0.0
    while s < total:
        segs.append((s, min(CHUNK_SEC, total - s)))
        s += CHUNK_SEC
    return segs

def _replicate_run(audio_path: str, language: str) -> dict:
    """Call incredibly-fast-whisper on one audio file.

    Uses wait=False so the create request returns immediately (no long-held
    connection) and then polls the prediction. This avoids read timeouts on
    long transcriptions, while the custom client's timeout covers the upload.
    """
    lang = _normalize_whisper_language(language)
    with open(audio_path, "rb") as f:
        output = _replicate_client.run(
            WHISPER_MODEL,
            input={
                "audio": f,
                "task": "transcribe",
                "language": lang,
                "timestamp": "chunk",
                "batch_size": 24,
            },
            wait=False,
            use_file_output=False,
        )
    return output

_opencc_converter = None


def _cjk_count(text: str) -> int:
    return sum(1 for ch in text if "\u4e00" <= ch <= "\u9fff")


def _looks_like_chinese(text: str, detected_lang: Optional[str] = None) -> bool:
    """True when transcript (or Whisper language tag) is Chinese and needs zh-TW normalize."""
    lang = (detected_lang or "").strip().lower()
    if lang in ("zh", "chinese", "yue", "cantonese", "zh-cn", "zh-tw", "zh-hk"):
        return True
    if not text:
        return False
    cjk = _cjk_count(text)
    if cjk == 0:
        return False
    # Enough CJK, or CJK-heavy among letters/CJK (short Chinese lines still convert)
    letters = sum(1 for ch in text if ch.isalpha() or ("\u4e00" <= ch <= "\u9fff"))
    if cjk >= 2 and (letters == 0 or cjk / max(letters, 1) >= 0.25):
        return True
    return cjk >= 8


def _to_traditional(text: str, detected_lang: Optional[str] = None) -> str:
    """If result is Chinese, convert Simplified → Traditional (Taiwan phrasing).

    Whisper auto-detect often emits Simplified; English/other languages are left as-is.
    """
    if not text:
        return text
    if not _looks_like_chinese(text, detected_lang):
        return text
    global _opencc_converter
    try:
        if _opencc_converter is None:
            from opencc import OpenCC
            _opencc_converter = OpenCC("s2twp")
        return _opencc_converter.convert(text)
    except Exception as e:
        print(f"[opencc] conversion skipped: {e}")
        return text


def _format_output(output, offset: float = 0.0) -> str:
    """Turn model output into '[hh:mm:ss -> hh:mm:ss] text' lines with a time offset."""
    detected = None
    if isinstance(output, dict):
        detected = output.get("language") or output.get("detected_language")
    result = None
    if isinstance(output, dict) and output.get("chunks"):
        lines = []
        for c in output["chunks"]:
            ts = c.get("timestamp") or [None, None]
            start = ts[0] if ts and ts[0] is not None else 0.0
            end = ts[1] if len(ts) > 1 and ts[1] is not None else start
            text = (c.get("text") or "").strip()
            if text:
                text = _to_traditional(text, detected)
                lines.append(f"[{_hhmmss(start + offset)} -> {_hhmmss(end + offset)}] {text}\n")
        if lines:
            result = "".join(lines)
    if result is None and isinstance(output, dict) and output.get("text"):
        result = output["text"]
    if result is None and isinstance(output, str):
        result = output
    if result is None:
        result = str(output)
    return _to_traditional(result, detected)

def _transcribe_audio_file(
    src_path: str,
    on_progress: Optional[Callable[[float, float], None]] = None,
    language: str = DEFAULT_LANGUAGE,
) -> str:
    """Transcribe one file in a single Replicate call.

    incredibly-fast-whisper batches the whole file internally (30s windows in
    parallel on the GPU), so one call is dramatically faster than splitting the
    audio into sequential chunks. We downsample the audio to 16 kHz mono mp3 once
    to keep the upload small and stable, then send the whole file at once.
    """
    total = _ffprobe_duration(src_path)
    if on_progress:
        on_progress(0.0, total)
    tmpd = tempfile.mkdtemp()
    try:
        audio_path = os.path.join(tmpd, "audio.mp3")
        try:
            _extract_audio(src_path, audio_path)
        except Exception:
            # If re-encoding fails (odd format), send the original file directly.
            audio_path = src_path
        output = _replicate_run(audio_path, language)
        text = _format_output(output, offset=0.0)
        if on_progress:
            on_progress(total, total)
        return text
    finally:
        shutil.rmtree(tmpd, ignore_errors=True)

def _verify_token(authorization: Optional[str]) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing or invalid token")
    try:
        decoded = fb_auth.verify_id_token(authorization[7:])
        return decoded["uid"]
    except Exception:
        raise HTTPException(401, "Invalid Firebase token")

# ─── Streaming bridge: run sync transcription in a thread, stream SSE ─────────
def _stream_transcription(saved: List[tuple]):
    """saved = [(display_name, local_path), ...]. Returns an async generator of SSE."""
    total_files = len(saved)

    async def gen():
        loop = asyncio.get_event_loop()
        q: asyncio.Queue = asyncio.Queue()

        def worker():
            try:
                for idx, (fname, path) in enumerate(saved):
                    n = idx + 1

                    def cb(done: float, tot: float):
                        loop.call_soon_threadsafe(q.put_nowait, {
                            "status": "transcribing", "file_index": n, "total_files": total_files,
                            "filename": fname, "processed_seconds": round(done),
                            "total_seconds": round(tot),
                            "progress": int(done / tot * 100) if tot else 0,
                        })

                    loop.call_soon_threadsafe(q.put_nowait, {
                        "status": "transcribing", "file_index": n, "total_files": total_files,
                        "filename": fname, "processed_seconds": 0, "total_seconds": 0, "progress": 0,
                    })
                    text = _transcribe_audio_file(path, cb)
                    loop.call_soon_threadsafe(q.put_nowait, {
                        "status": "file_done", "file_index": n, "total_files": total_files,
                        "filename": fname, "transcript": text, "progress": 100,
                    })
                    try:
                        os.remove(path)
                    except OSError:
                        pass
                loop.call_soon_threadsafe(q.put_nowait, {"status": "all_done"})
            except Exception as e:
                loop.call_soon_threadsafe(q.put_nowait, {"status": "error", "detail": str(e)})

        threading.Thread(target=worker, daemon=True).start()

        try:
            while True:
                item = await q.get()
                if item["status"] == "all_done":
                    yield _sse({"status": "all_done"}, event="complete")
                    break
                if item["status"] == "error":
                    yield _sse(item, event="error")
                    break
                yield _sse(item)
        finally:
            for _, p in saved:
                if os.path.exists(p):
                    try:
                        os.remove(p)
                    except OSError:
                        pass

    return gen

# ─── Upload Endpoint (SSE, instant mode) ─────────────────────────
@app.post("/api/transcribe/upload")
async def transcribe_upload(files: List[UploadFile] = File(...)):
    saved: List[tuple] = []
    for f in files:
        ext = os.path.splitext(f.filename or ".mp4")[1]
        fd, path = tempfile.mkstemp(suffix=ext)
        os.close(fd)
        with open(path, "wb") as buf:
            shutil.copyfileobj(f.file, buf)
        saved.append((f.filename or "unknown", path))
    gen = _stream_transcription(saved)
    return StreamingResponse(gen(), media_type="text/event-stream")

# ─── YouTube Endpoint (SSE, instant mode) ────────────────────────
@app.post("/api/transcribe/youtube")
async def transcribe_youtube(url: str = Form(...), token_id: Optional[str] = Form(None)):
    temp_dir = tempfile.mkdtemp()

    async def gen():
        try:
            yield _sse({"status": "downloading", "progress": 0, "filename": url})
            out_tpl = os.path.join(temp_dir, "%(title)s__%(id)s.%(ext)s")
            opts: dict = {"format": "bestaudio/best", "outtmpl": out_tpl,
                "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"}],
                "quiet": True, "no_warnings": True, "noplaylist": False}
            if token_id and token_id in _cookies:
                cookie_path = os.path.join(temp_dir, "cookies.txt")
                with open(cookie_path, "w", encoding="utf-8") as f:
                    f.write(_cookies[token_id])
                opts["cookiefile"] = cookie_path
            await asyncio.get_event_loop().run_in_executor(
                executor, lambda: yt_dlp.YoutubeDL(opts).download([url]))
            yield _sse({"status": "download_complete", "progress": 100})

            audio_files = sorted(glob.glob(os.path.join(temp_dir, "*.mp3")))
            if not audio_files:
                audio_files = sorted([f for f in glob.glob(os.path.join(temp_dir, "*"))
                    if os.path.isfile(f) and "_ytcache" not in f and not f.endswith((".txt", ".json"))])
            if not audio_files:
                yield _sse({"status": "error", "detail": "No audio downloaded"}, event="error")
                return

            saved = []
            for ap in audio_files:
                bn = os.path.basename(ap)
                title = bn.rsplit("__", 1)[0] if "__" in bn else bn.rsplit(".", 1)[0]
                saved.append((title, ap))
            gen2 = _stream_transcription(saved)
            async for chunk in gen2():
                yield chunk
        except Exception as e:
            yield _sse({"status": "error", "detail": str(e)}, event="error")
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    return StreamingResponse(gen(), media_type="text/event-stream")

# ─── Background Job Processing ───────────────────────────────────
# Firestore documents have a 1 MiB limit; keep big transcripts in Storage only.
INLINE_LIMIT = 700_000  # bytes of combined transcript text kept inline in Firestore

# ─── YouTube download with free-proxy rotation ───────────────────
# YouTube blocks datacenter IPs (Cloud Run), so we route yt-dlp through free
# public proxies (same idea as the stock crawler), trying until one works.
YT_PROXY_ENABLED = os.environ.get("YT_PROXY_ENABLED", "1") == "1"
YT_MAX_PROXY_ATTEMPTS = int(os.environ.get("YT_MAX_PROXY_ATTEMPTS", "15"))
YT_PROXY_SOURCES = [
    "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",
    "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt",
    "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/http/data.txt",
]
_yt_proxy_cache: dict = {"list": [], "ts": 0.0}
_yt_proxy_lock = threading.Lock()

def _fetch_free_proxies(limit: int = 500) -> List[str]:
    """Download & cache (10 min) free http proxy lists as 'ip:port' strings."""
    with _yt_proxy_lock:
        if _yt_proxy_cache["list"] and time.time() - _yt_proxy_cache["ts"] < 600:
            return list(_yt_proxy_cache["list"])
    found = set()
    for src in YT_PROXY_SOURCES:
        try:
            r = requests.get(src, timeout=10)
            for line in r.text.strip().splitlines():
                line = line.strip().replace("http://", "").replace("https://", "")
                if line and ":" in line and line.count(".") == 3:
                    found.add(line)
        except Exception:
            pass
    lst = list(found)
    random.shuffle(lst)
    lst = lst[:limit]
    with _yt_proxy_lock:
        _yt_proxy_cache["list"] = lst
        _yt_proxy_cache["ts"] = time.time()
    return list(lst)

def _filter_live_proxies(candidates: List[str], want: int = 25,
                         timeout: int = 6, threads: int = 60) -> List[str]:
    """Quickly keep proxies that can actually reach YouTube (filters dead ones)."""
    live: List[str] = []
    live_lock = threading.Lock()

    def check(p: str):
        if len(live) >= want:
            return
        try:
            r = requests.get(
                "https://www.youtube.com/robots.txt",
                proxies={"http": f"http://{p}", "https": f"http://{p}"},
                timeout=timeout,
            )
            if r.status_code == 200 and "User-agent" in r.text:
                with live_lock:
                    if len(live) < want:
                        live.append(p)
        except Exception:
            pass

    with ThreadPoolExecutor(max_workers=threads) as pool:
        futs = [pool.submit(check, p) for p in candidates]
        for f in futs:
            if len(live) >= want:
                break
            try:
                f.result(timeout=timeout + 2)
            except Exception:
                pass
    return live

def _collect_audio(temp_dir: str) -> List[tuple]:
    out: List[tuple] = []
    for mp3 in sorted(glob.glob(os.path.join(temp_dir, "*.mp3"))):
        bn = os.path.basename(mp3)
        title = bn.rsplit("__", 1)[0] if "__" in bn else bn.rsplit(".", 1)[0]
        out.append((title, mp3))
    if not out:
        for f in sorted(glob.glob(os.path.join(temp_dir, "*"))):
            if os.path.isfile(f) and "_ytcache" not in f and \
               not f.endswith((".txt", ".json", ".part", ".ytdl")):
                out.append((os.path.basename(f), f))
    return out

def _download_youtube(url: str, temp_dir: str, cookie_content: Optional[str] = None,
                      on_status: Optional[Callable[[str], None]] = None) -> List[tuple]:
    """Download YouTube audio, trying direct first then rotating free proxies.

    Cookies (if given) are used on every attempt so private/members-only videos
    keep working. Raises RuntimeError if no attempt succeeds.
    """
    cookie_path = None
    if cookie_content:
        cookie_path = os.path.join(temp_dir, "cookies.txt")
        with open(cookie_path, "w", encoding="utf-8") as f:
            f.write(cookie_content)

    def _clear_media():
        for f in glob.glob(os.path.join(temp_dir, "*")):
            if f == cookie_path or not os.path.isfile(f):
                continue
            try:
                os.remove(f)
            except OSError:
                pass

    def _attempt(proxy: Optional[str]) -> List[tuple]:
        _clear_media()
        opts: dict = {
            "format": "bestaudio/best",
            "outtmpl": os.path.join(temp_dir, "%(title)s__%(id)s.%(ext)s"),
            "postprocessors": [{"key": "FFmpegExtractAudio",
                                "preferredcodec": "mp3", "preferredquality": "192"}],
            "quiet": True, "no_warnings": True, "noplaylist": False,
            "socket_timeout": 20, "retries": 1, "fragment_retries": 1,
        }
        if cookie_path:
            opts["cookiefile"] = cookie_path
        if proxy:
            opts["proxy"] = f"http://{proxy}"
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download([url])
        return _collect_audio(temp_dir)

    # 1) Try direct — cheap, and works if this instance's IP isn't flagged.
    last_err = None
    try:
        if on_status:
            on_status("嘗試直連下載 YouTube…")
        got = _attempt(None)
        if got:
            return got
    except Exception as e:
        last_err = e

    if not YT_PROXY_ENABLED:
        raise RuntimeError(f"YouTube 直連下載失敗:{last_err}")

    # 2) Rotate through free proxies.
    if on_status:
        on_status("直連被 YouTube 擋下,改用免費代理嘗試…")
    live = _filter_live_proxies(_fetch_free_proxies(), want=YT_MAX_PROXY_ATTEMPTS + 10)
    tried = 0
    for p in live:
        if tried >= YT_MAX_PROXY_ATTEMPTS:
            break
        tried += 1
        if on_status:
            on_status(f"透過免費代理嘗試中… ({tried}/{min(len(live), YT_MAX_PROXY_ATTEMPTS)})")
        try:
            got = _attempt(p)
            if got:
                return got
        except Exception as e:
            last_err = e
            continue

    raise RuntimeError(
        f"YouTube 下載失敗:試了 {tried} 個免費代理都不成功。"
        f"此影片可能需要 cookies,或改用付費住宅代理。最後錯誤:{last_err}"
    )

def _ts_value(created_at) -> float:
    """Best-effort epoch seconds from a Firestore timestamp value (for sorting)."""
    try:
        return created_at.timestamp()
    except Exception:
        return 0.0

def _refresh_queue_positions() -> None:
    """Write queue_ahead (number of audio files waiting ahead) onto each queued job.

    Called whenever a job starts or finishes so waiting users get a live position.
    Jobs that are already 'processing' still count as being ahead in line.
    """
    try:
        pending = list(
            fstore.collection("jobs")
            .where(filter=FieldFilter("status", "in", ["queued", "processing"]))
            .stream()
        )
    except Exception:
        return
    rows = []
    for d in pending:
        data = d.to_dict() or {}
        rows.append((
            d.id,
            data.get("status"),
            int(data.get("total_files") or 1),
            _ts_value(data.get("created_at")),
        ))
    rows.sort(key=lambda r: r[3])  # oldest first (FIFO)
    ahead_files = 0
    for jid, status, nfiles, _ in rows:
        if status == "queued":
            try:
                fstore.collection("jobs").document(jid).update({"queue_ahead": ahead_files})
            except Exception:
                pass
        ahead_files += nfiles

def _process_job_sync(job_id: str, job_data: dict):
    """Process a job in background thread, updating Firestore with real progress."""
    job_ref = fstore.collection("jobs").document(job_id)
    try:
        job_ref.update({"status": "processing", "progress": 0, "position_label": "", "queue_ahead": 0})
        _refresh_queue_positions()  # this job left the queue; bump everyone behind
        temp_dir = tempfile.mkdtemp()
        audio_files: List[tuple] = []  # (filename, local_path)

        source = job_data.get("source_type", "upload")

        if source == "upload":
            for sp in job_data.get("storage_paths", []):
                blob = bucket.blob(sp)
                fname = os.path.basename(sp)
                local = os.path.join(temp_dir, fname)
                blob.download_to_filename(local)
                audio_files.append((fname, local))

        elif source == "youtube":
            yt_url = job_data.get("youtube_url", "")
            # Cookie is persisted in the job doc so any Cloud Run instance can use it.
            cookie_content = job_data.get("yt_cookie")
            if not cookie_content:
                yt_token_id = job_data.get("yt_token_id")
                if yt_token_id and yt_token_id in _cookies:
                    cookie_content = _cookies[yt_token_id]
            # Prefer a real video title ASAP (UI shows URL otherwise).
            if not (job_data.get("title") or "").strip():
                yt_title = _youtube_oembed_title(yt_url)
                if yt_title:
                    job_ref.update({"title": yt_title, "filenames": [yt_title]})
                    job_data["title"] = yt_title
            # YouTube blocks datacenter IPs ("Sign in to confirm you're not a bot"),
            # so fall back to rotating free proxies. Cookies (if provided) are used
            # in every attempt so private / members-only videos still work.
            def _yt_status(msg: str):
                job_ref.update({"position_label": msg})
            audio_files = _download_youtube(yt_url, temp_dir, cookie_content, _yt_status)
            # yt-dlp filename embeds the real title — use it for display / transcripts.
            if audio_files:
                dl_title = (audio_files[0][0] or "").strip()
                if dl_title and not dl_title.lower().startswith(("http://", "https://")):
                    job_ref.update({"title": dl_title, "filenames": [t[0] for t in audio_files]})
                    job_data["title"] = dl_title

        if not audio_files:
            job_ref.update({"status": "error", "error_message": "No audio files found"})
            return

        total = len(audio_files)
        uid = job_data.get("user_id", "unknown")
        language = _normalize_whisper_language(
            job_data.get("language") or DEFAULT_LANGUAGE
        )

        # Transcribe the job's files in parallel (bounded), reporting progress by
        # how many files are finished. Each file: transcribe -> store .txt.
        results: List[Optional[dict]] = [None] * total
        lock = threading.Lock()
        counter = {"done": 0, "ok": 0}

        def _work(idx: int, fname: str, local_path: str) -> None:
            try:
                text = _transcribe_audio_file(local_path, language=language)
                ok = True
            except Exception as fe:
                text = f"[轉錄失敗 / transcription failed: {fe}]"
                ok = False
            result_path = f"results/{uid}/{job_id}/{idx:02d}_{fname}.txt"
            try:
                bucket.blob(result_path).upload_from_string(
                    text, content_type="text/plain; charset=utf-8")
            except Exception:
                result_path = ""
            with lock:
                counter["done"] += 1
                if ok:
                    counter["ok"] += 1
                results[idx] = {"filename": fname, "text": text, "path": result_path}
                job_ref.update({
                    "progress": min(int(counter["done"] / total * 100), 99),
                    "current_file": counter["done"], "total_files": total,
                    "position_label": f"{counter['done']}/{total} 檔完成",
                })

        workers = max(1, min(FILE_PARALLELISM, total))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [pool.submit(_work, i, fn, lp)
                       for i, (fn, lp) in enumerate(audio_files)]
            for fut in futures:
                fut.result()

        if counter["ok"] == 0:
            raise RuntimeError(results[0]["text"] if results and results[0]
                               else "All files failed to transcribe")

        all_transcripts = [{"filename": r["filename"], "text": r["text"]} for r in results if r]
        result_paths = [r["path"] for r in results if r and r["path"]]

        # Delete uploaded source audio right away — only results are kept.
        _delete_uploads(job_data)

        # Only keep transcripts inline if small enough for a Firestore doc
        combined_len = sum(len(t["text"].encode("utf-8")) for t in all_transcripts)
        update = {
            "status": "done",
            "progress": 100,
            "position_label": "",
            "result_paths": result_paths,
            "storage_paths": [],
            "yt_cookie": firestore.DELETE_FIELD,  # don't keep cookies around
        }
        update["transcripts"] = all_transcripts if combined_len <= INLINE_LIMIT else []
        job_ref.update(update)

        shutil.rmtree(temp_dir, ignore_errors=True)
        _refresh_queue_positions()  # a slot freed up; advance the queue

    except Exception as e:
        # Clean up uploads/cookie even on failure so nothing is left behind.
        try:
            _delete_uploads(job_data)
        except Exception:
            pass
        job_ref.update({
            "status": "error", "error_message": str(e),
            "storage_paths": [], "yt_cookie": firestore.DELETE_FIELD,
        })
        _refresh_queue_positions()

@app.post("/api/jobs/start")
async def start_job(
    job_id: str = Form(...),
    youtube_url: Optional[str] = Form(None),
    yt_token_id: Optional[str] = Form(None),
    language: Optional[str] = Form(None),
    authorization: Optional[str] = Header(None),
):
    uid = _verify_token(authorization)
    job_ref = fstore.collection("jobs").document(job_id)
    job_doc = job_ref.get()
    if not job_doc.exists:
        raise HTTPException(404, "Job not found")
    job_data = job_doc.to_dict()
    if job_data.get("user_id") != uid:
        raise HTTPException(403, "Not your job")

    updates: dict = {}
    if youtube_url:
        updates["youtube_url"] = youtube_url
        # Resolve video title early so library / job pages don't show the raw URL.
        existing_title = (job_data.get("title") or "").strip()
        looks_like_url = existing_title.lower().startswith(("http://", "https://")) or not existing_title
        fn0 = ""
        filenames = job_data.get("filenames") or []
        if filenames:
            fn0 = str(filenames[0] or "").strip()
        if looks_like_url or fn0.lower().startswith(("http://", "https://")) or fn0 == youtube_url:
            yt_title = await asyncio.get_event_loop().run_in_executor(
                executor, _youtube_oembed_title, youtube_url
            )
            if yt_title:
                updates["title"] = yt_title
                updates["filenames"] = [yt_title]
    # Persist the cookie into the job doc so any Cloud Run instance (the one the
    # background task lands on) can read it — in-memory would not survive.
    if yt_token_id and yt_token_id in _cookies:
        updates["yt_cookie"] = _cookies[yt_token_id]
    # Whisper language: "None"/auto = detect; zh-TW/en/… map to model codes.
    lang = _normalize_whisper_language(language or job_data.get("language") or DEFAULT_LANGUAGE)
    updates["language"] = lang
    if updates:
        job_ref.update(updates)
        job_data = {**job_data, **updates}

    # Preferred: hand off to Cloud Tasks so the job survives closing the browser.
    if _enqueue_task(job_id):
        job_ref.update({"status": "queued"})
        _refresh_queue_positions()  # compute this job's initial place in line
        return {"status": "queued", "job_id": job_id}

    # Fallback (Cloud Tasks not configured): process within this request.
    # In this mode the browser tab must stay open until it finishes.
    await asyncio.get_event_loop().run_in_executor(
        executor, _process_job_sync, job_id, job_data)
    return {"status": "done", "job_id": job_id}

# ─── Cloud Tasks target: runs the job to completion ──────────────
@app.post("/api/jobs/process")
async def process_job(request: Request):
    if not TASK_SECRET or request.headers.get("X-Task-Secret", "") != TASK_SECRET:
        raise HTTPException(403, "Forbidden")
    body = await request.json()
    job_id = body.get("job_id")
    if not job_id:
        raise HTTPException(400, "Missing job_id")
    job_ref = fstore.collection("jobs").document(job_id)
    job_doc = job_ref.get()
    if not job_doc.exists:
        raise HTTPException(404, "Job not found")
    job_data = job_doc.to_dict()
    # Idempotency: if a retry arrives after completion, don't process (or bill) again.
    if job_data.get("status") == "done":
        return {"status": "already_done"}
    await asyncio.get_event_loop().run_in_executor(
        executor, _process_job_sync, job_id, job_data)
    return {"status": "done"}

# ─── YouTube Cookie Upload ───────────────────────────────────────
@app.post("/api/youtube/cookie/upload")
async def yt_cookie_upload(cookie_file: UploadFile = File(...)):
    content = (await cookie_file.read()).decode("utf-8", errors="replace")
    if "youtube.com" not in content.lower() and ".youtube.com" not in content.lower():
        raise HTTPException(400, "This doesn't look like a YouTube cookies.txt file")
    cid = str(uuid.uuid4())
    _cookies[cid] = content
    return {"status": "ok", "cookie_id": cid}

# ─── 背單字 App 整合端點 ──────────────────────────────────────────
# 給「快速背單字」聽力頁使用：
#   - 上傳音檔/影片 → 永久存進 Firebase Storage（可跨裝置播放）+ Replicate 轉逐字稿
#   - YouTube → 有字幕優先用字幕，沒字幕才下載音訊轉錄；影片由前端內嵌播放
# 回傳含時間戳的 segments，前端再做翻譯/重點分析。

_VIDEO_EXTS = {".mp4", ".mkv", ".avi", ".mov", ".webm", ".m4v"}

def _output_to_segments(output) -> List[dict]:
    """把 Replicate 輸出轉成 [{start,end,text}]（含繁體化）。"""
    detected = None
    if isinstance(output, dict):
        detected = output.get("language") or output.get("detected_language")
    segs: List[dict] = []
    if isinstance(output, dict) and output.get("chunks"):
        for c in output["chunks"]:
            ts = c.get("timestamp") or [None, None]
            start = ts[0] if ts and ts[0] is not None else 0.0
            end = ts[1] if len(ts) > 1 and ts[1] is not None else start
            text = _to_traditional((c.get("text") or "").strip(), detected)
            if text:
                segs.append({"start": round(float(start), 2), "end": round(float(end if end is not None else start), 2), "text": text})
    if not segs and isinstance(output, dict) and output.get("text"):
        segs.append({"start": 0.0, "end": 0.0, "text": _to_traditional(output["text"].strip(), detected)})
    return segs

def _transcribe_to_segments(src_path: str, language: str) -> List[dict]:
    """降頻成 16k mono mp3 後送 Replicate，回傳 segments。"""
    tmpd = tempfile.mkdtemp()
    try:
        audio = os.path.join(tmpd, "audio.mp3")
        try:
            _extract_audio(src_path, audio)
        except Exception:
            audio = src_path
        output = _replicate_run(audio, language or "None")
        return _output_to_segments(output)
    finally:
        shutil.rmtree(tmpd, ignore_errors=True)

def _store_media_public(local_path: str, orig_name: str) -> tuple:
    """把媒體存進 Storage 並回傳可公開播放的 Firebase 下載網址與類型（video/audio）。"""
    ext = os.path.splitext(orig_name or "")[1].lower() or ".bin"
    path = f"beidanzi_media/{uuid.uuid4().hex}{ext}"
    token = uuid.uuid4().hex
    ctype = mimetypes.guess_type(orig_name or path)[0] or "application/octet-stream"
    blob = bucket.blob(path)
    blob.metadata = {"firebaseStorageDownloadTokens": token}
    blob.upload_from_filename(local_path, content_type=ctype)
    url = (f"https://firebasestorage.googleapis.com/v0/b/{bucket.name}/o/"
           f"{quote(path, safe='')}?alt=media&token={token}")
    media_type = "video" if ext in _VIDEO_EXTS else "audio"
    return url, media_type

def _yt_id(url: str) -> str:
    m = re.search(r"(?:v=|youtu\.be/|/embed/|/shorts/)([A-Za-z0-9_-]{11})", url or "")
    return m.group(1) if m else ""

def _parse_vtt(vtt_text: str) -> List[dict]:
    segs: List[dict] = []
    ts = r"(\d{2}):(\d{2}):(\d{2})[.,](\d{3})"
    line_re = re.compile(rf"{ts}\s*-->\s*{ts}")
    def to_sec(h, m, s, ms):
        return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000.0
    for b in re.split(r"\n\n+", vtt_text.replace("\r", "")):
        lines = [l for l in b.split("\n") if l.strip()]
        if not lines:
            continue
        m = None
        text_lines = []
        for l in lines:
            mm = line_re.search(l)
            if mm and m is None:
                m = mm
            elif m is not None:
                # 去掉 VTT 時間標註／karaoke 標籤
                cleaned = re.sub(r"<[^>]+>", "", l)
                cleaned = re.sub(r"\d{2}:\d{2}:\d{2}[.,]\d{3}", "", cleaned)
                if cleaned.strip():
                    text_lines.append(cleaned)
        if not m:
            continue
        start = to_sec(*m.group(1, 2, 3, 4))
        end = to_sec(*m.group(5, 6, 7, 8))
        text = re.sub(r"<[^>]+>", "", " ".join(text_lines))
        text = html.unescape(text)
        text = re.sub(r"\s+", " ", text).replace("\xa0", " ").strip()
        if not text:
            continue
        if segs and segs[-1]["text"] == text:
            segs[-1]["end"] = round(end, 2)
        else:
            segs.append({"start": round(start, 2), "end": round(end, 2), "text": text})
    return _merge_caption_sentences(_dedupe_rollup_captions(segs))


def _longest_suffix_prefix_overlap(a: str, b: str) -> str:
    """最長字串：同時是 a 的後綴與 b 的前綴（YouTube 滾動字幕用）。"""
    max_n = min(len(a), len(b))
    # 優先在空白斷點重疊，避免切到單字中間
    for n in range(max_n, 0, -1):
        if a[-n:] != b[:n]:
            continue
        if n == len(a) or n == len(b) or a[-n:].startswith(" ") or (len(a) > n and a[-n - 1] == " ") or (n < len(b) and b[n] == " "):
            return a[-n:]
    for n in range(max_n, 7, -1):  # 至少約一個短片語
        if a[-n:] == b[:n]:
            return a[-n:]
    return ""


def _dedupe_rollup_captions(segs: List[dict]) -> List[dict]:
    """清除 YouTube 自動字幕常見的滾動／重疊重複（同一句寫兩三次）。

    策略：
    1) 完全相同 → 延長結束時間
    2) 後段以整段前段為前綴（累積變長）→ 用較長文字覆寫
    3) 後段是前段的子字串 → 略過
    4) 前段出現在後段中間（兩行滾動重組）→ 與更早段落合併
    5) 前段後綴與後段前綴重疊 → 只保留真正新增的文字
    """
    out: List[dict] = []
    for seg in segs or []:
        text = re.sub(r"\s+", " ", str(seg.get("text") or "")).strip()
        if not text:
            continue
        start = float(seg.get("start") or 0)
        end = float(seg.get("end") if seg.get("end") is not None else start)
        if not out:
            out.append({"start": round(start, 2), "end": round(end, 2), "text": text})
            continue
        prev = out[-1]
        a = prev["text"]
        b = text
        if b == a:
            prev["end"] = max(prev["end"], round(end, 2))
            continue
        # 累積變長（rollup growing）
        if b.startswith(a) and (start - prev["start"] <= 12):
            prev["text"] = b
            prev["end"] = max(prev["end"], round(end, 2))
            continue
        # 後段是前段子集
        if a.startswith(b) or b in a:
            prev["end"] = max(prev["end"], round(end, 2))
            continue
        # 前段文字被包進後段（兩行字幕重組：舊行 + 新行）
        if a in b and len(a) >= 8:
            idx = b.find(a)
            if idx == 0:
                prev["text"] = b
                prev["end"] = max(prev["end"], round(end, 2))
                continue
            if len(out) >= 2:
                prev2 = out[-2]
                prefix = b[:idx].strip()
                if prefix and (prev2["text"] == prefix or prefix.startswith(prev2["text"]) or prev2["text"] in prefix):
                    prev2["text"] = b
                    prev2["end"] = max(prev2["end"], round(end, 2))
                    out.pop()
                    continue
            # 無法合併到更早段落時，用完整句覆寫碎片
            prev["text"] = b
            prev["start"] = min(prev["start"], round(start, 2))
            prev["end"] = max(prev["end"], round(end, 2))
            continue
        ov = _longest_suffix_prefix_overlap(a, b)
        min_ov = min(10, max(6, min(len(a), len(b)) // 4))
        if len(ov) >= min_ov:
            delta = b[len(ov):].strip()
            if not delta:
                prev["end"] = max(prev["end"], round(end, 2))
                continue
            b = delta
        out.append({"start": round(start, 2), "end": round(end, 2), "text": b})
    return out


_SENT_END_RE = re.compile(r'[.!?。！？]["\'”’)\]]*$')
_ABBREV_END_RE = re.compile(
    r"(?:^|[\s(\[])(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|vs|etc|approx|fig|vol|nos?|u\.s|u\.k|e\.g|i\.e)\.$",
    re.I,
)


def _caption_ends_sentence(text: str) -> bool:
    """判斷字幕片段是否已在完整句尾（避開 Mr. / U.S. 等縮寫）。"""
    t = re.sub(r"\s+", " ", str(text or "")).strip()
    if not t or not _SENT_END_RE.search(t):
        return False
    if t.endswith(".") and _ABBREV_END_RE.search(t):
        return False
    if re.search(r"\b[A-Z]\.$", t):
        return False
    if re.search(r"\d\.$", t):
        return False
    return True


def _split_caption_sentences(text: str) -> List[str]:
    """把已合併的文字再依句號切成完整句（保留句末標點）。"""
    t = re.sub(r"\s+", " ", str(text or "")).strip()
    if not t:
        return []
    parts = re.split(r'(?<=[.!?。！？])\s+(?=[A-Z"“‘「])', t)
    out = [p.strip() for p in parts if p and p.strip()]
    return out or [t]


def _merge_caption_sentences(
    segs: List[dict],
    max_chars: int = 420,
    max_gap: float = 3.5,
) -> List[dict]:
    """把斷在句中的 CC 片段併成完整句子（保留起始時間）。

    YouTube 自動字幕常在 and / the / a 等處切開；此步驟會往後併到句號為止。
    """
    buf: Optional[dict] = None
    merged: List[dict] = []

    def flush():
        nonlocal buf
        if not buf:
            return
        pieces = _split_caption_sentences(buf["text"])
        if len(pieces) <= 1:
            merged.append(buf)
        else:
            # 多句時依字數比例拆時間，方便跳播
            total = max(1, sum(len(p) for p in pieces))
            t0, t1 = buf["start"], max(buf["end"], buf["start"] + 0.4)
            span = max(0.4, t1 - t0)
            cur = t0
            for i, p in enumerate(pieces):
                share = len(p) / total
                nxt = t1 if i == len(pieces) - 1 else round(cur + span * share, 2)
                merged.append({"start": round(cur, 2), "end": round(max(nxt, cur + 0.2), 2), "text": p})
                cur = nxt
        buf = None

    for seg in segs or []:
        text = re.sub(r"\s+", " ", str(seg.get("text") or "")).strip()
        if not text:
            continue
        start = float(seg.get("start") or 0)
        end = float(seg.get("end") if seg.get("end") is not None else start)
        if not buf:
            buf = {"start": round(start, 2), "end": round(end, 2), "text": text}
        else:
            gap = start - buf["end"]
            if gap > max_gap * 2:
                flush()
                buf = {"start": round(start, 2), "end": round(end, 2), "text": text}
            else:
                joiner = "" if buf["text"][-1:] in "-—/" else " "
                buf["text"] = (buf["text"] + joiner + text).replace("  ", " ").strip()
                buf["end"] = round(max(buf["end"], end), 2)

        if buf and _caption_ends_sentence(buf["text"]):
            flush()
        elif buf and len(buf["text"]) >= max_chars:
            flush()

    flush()
    return merged


def _yt_caption_lang_keys(language: Optional[str]) -> List[str]:
    """依偏好語言排出字幕語系候選（含自動字幕常見變體）。

    對中文偏好：先找人工中文字幕，但英文原音 ASR／人工英文字幕排在
    「中文自動翻譯字幕」之前，避免英文片被 YouTube 翻譯軌整段翻成中文。
    """
    keys: List[str] = []
    lang = _normalize_whisper_language(language)
    raw = (language or "").strip().lower().replace("_", "-")
    want_zh = raw in ("zh", "zh-tw", "zh-cn", "zh-hk", "chinese", "cht", "chs") or lang == "chinese"

    if want_zh:
        # Manual / regional Chinese first
        for k in ("zh-TW", "zh-Hant", "zh", "zh-Hans", "zh-CN", "zh-HK"):
            if k not in keys:
                keys.append(k)
        # Original English speech before Chinese auto-translate
        for k in ("en-orig", "en", "en-en", "en-US", "en-GB"):
            if k not in keys:
                keys.append(k)
        return keys

    two = None
    if language and language not in ("None", "auto") and lang not in ("None",):
        two = {
            "english": "en",
            "german": "de",
            "japanese": "ja",
            "french": "fr",
            "korean": "ko",
            "spanish": "es",
            "dutch": "nl",
            "russian": "ru",
            "vietnamese": "vi",
        }.get(lang, (lang or "")[:2].lower() or None)
        if two and two != "ch":
            keys += [two, f"{two}-orig", f"{two}-en", f"{two}-US", f"{two}-GB"]
    # 永遠附上英文備援（多數教育／談話節目預設）
    for k in ("en", "en-orig", "en-en", "en-US", "en-GB"):
        if k not in keys:
            keys.append(k)
    return keys

def _pick_caption_track(info: dict, preferred: List[str]) -> tuple:
    """從 yt-dlp info 挑出最佳字幕軌。回傳 (entries, source) 或 (None, None)。
    source: 'manual' | 'auto'

    Auto Chinese tracks are often machine translations of English speech — prefer
    English ASR / original over zh auto when both exist.
    """
    manuals = info.get("subtitles") or {}
    autos = info.get("automatic_captions") or {}

    def find_in(bucket: dict, keys: List[str]):
        for k in keys:
            if k in bucket and bucket[k]:
                return bucket[k], k
            # 寬鬆比對：en.* / zh-Hans 等
            for bk, entries in bucket.items():
                if bk == k or bk.startswith(k + "-") or bk.startswith(k + "."):
                    if entries:
                        return entries, bk
        return None, None

    entries, _ = find_in(manuals, preferred)
    if entries:
        return entries, "manual"

    # Autos: English original speech before Chinese (often translated) tracks
    en_auto_keys = [k for k in preferred if k == "en" or k.startswith("en")]
    other_auto_keys = [k for k in preferred if k not in en_auto_keys]
    for key_group in (en_auto_keys, other_auto_keys):
        if not key_group:
            continue
        entries, _ = find_in(autos, key_group)
        if entries:
            return entries, "auto"

    # 最後：任意英文／任意第一軌
    for bucket, src in ((manuals, "manual"), (autos, "auto")):
        for k, entries in bucket.items():
            if entries and (k == "en" or k.startswith("en")):
                return entries, src
    for bucket, src in ((manuals, "manual"), (autos, "auto")):
        for k, entries in bucket.items():
            if entries:
                return entries, src
    return None, None

def _download_caption_body(entries: list, proxy: Optional[str] = None) -> Optional[str]:
    """下載字幕內容；優先 vtt，其次 srv3/json3。"""
    order = {"vtt": 0, "srv3": 1, "ttml": 2, "srv2": 3, "srv1": 4, "json3": 5, "srt": 6}
    ranked = sorted(
        [e for e in entries if isinstance(e, dict) and e.get("url")],
        key=lambda e: order.get((e.get("ext") or "").lower(), 99),
    )
    proxies = {"http": f"http://{proxy}", "https": f"http://{proxy}"} if proxy else None
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}
    for e in ranked:
        try:
            r = requests.get(e["url"], timeout=25, proxies=proxies, headers=headers)
            if r.status_code == 200 and (r.text or "").strip():
                ext = (e.get("ext") or "").lower()
                # 若拿到 json3，轉成簡單 text blocks 給 _parse_vtt 前先轉成偽 VTT
                if ext == "json3" or r.text.lstrip().startswith("{"):
                    return _json3_to_vtt(r.text)
                return r.text
        except Exception as ex:
            print(f"[beidanzi] 下載字幕檔失敗 ({e.get('ext')}): {ex}")
            continue
    return None

def _json3_to_vtt(raw: str) -> str:
    """把 YouTube json3 字幕轉成簡易 VTT，供既有 _parse_vtt 使用。"""
    try:
        data = json.loads(raw)
    except Exception:
        return raw
    lines = ["WEBVTT", ""]
    for ev in data.get("events") or []:
        segs = ev.get("segs") or []
        text = "".join(s.get("utf8", "") for s in segs).replace("\n", " ").strip()
        if not text or text == "\n":
            continue
        start_ms = int(ev.get("tStartMs") or 0)
        dur_ms = int(ev.get("dDurationMs") or 2000)
        end_ms = start_ms + max(dur_ms, 200)
        def fmt(ms: int) -> str:
            h = ms // 3600000; ms %= 3600000
            m = ms // 60000; ms %= 60000
            s = ms // 1000; ms %= 1000
            return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"
        lines.append(f"{fmt(start_ms)} --> {fmt(end_ms)}")
        lines.append(text)
        lines.append("")
    return "\n".join(lines)

def _youtube_oembed_title(url: str) -> Optional[str]:
    """用 oEmbed 快速取影片標題（通常不需代理）。"""
    try:
        r = requests.get(
            "https://www.youtube.com/oembed",
            params={"url": url, "format": "json"},
            timeout=10,
            headers={"User-Agent": "Mozilla/5.0"},
        )
        if r.status_code == 200:
            t = (r.json().get("title") or "").strip()
            return t or None
    except Exception as e:
        print(f"[beidanzi] oEmbed 取標題失敗: {e}")
    return None

def _youtube_captions_timedtext(vid: str, language: Optional[str]) -> tuple:
    """不經 yt-dlp，直接打 YouTube timedtext（通常比 extract_info 快很多）。
    回傳 (segments, source, None)。
    """
    if not vid:
        return None, None, None
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
    }
    preferred = _yt_caption_lang_keys(language)
    tracks = []  # (lang, kind)
    try:
        r = requests.get(
            f"https://www.youtube.com/api/timedtext?type=list&v={vid}",
            headers=headers, timeout=8,
        )
        if r.status_code == 200 and r.text:
            for m in re.finditer(r"<track\b([^>]+)/?>", r.text, flags=re.I):
                attrs = m.group(1)
                lang_m = re.search(r'lang_code="([^"]+)"', attrs, flags=re.I)
                if not lang_m:
                    continue
                kind_m = re.search(r'kind="([^"]*)"', attrs, flags=re.I)
                tracks.append((lang_m.group(1), (kind_m.group(1) if kind_m else "").lower()))
    except Exception as e:
        print(f"[beidanzi] timedtext list 失敗: {e}")

    def pick_track():
        for want_asr in (False, True):
            for pref in preferred:
                for lang, kind in tracks:
                    is_asr = kind == "asr"
                    if want_asr != is_asr:
                        continue
                    if lang == pref or lang.startswith(pref + "-") or pref.startswith(lang):
                        return lang, is_asr
            for lang, kind in tracks:
                is_asr = kind == "asr"
                if want_asr != is_asr:
                    continue
                if lang == "en" or lang.startswith("en"):
                    return lang, is_asr
        if tracks:
            lang, kind = tracks[0]
            return lang, kind == "asr"
        return None, False

    lang, is_asr = pick_track()
    candidates = []
    if lang:
        candidates.append((lang, is_asr))
    for pref in preferred:
        candidates.append((pref, False))
        candidates.append((pref, True))
    seen = set()
    for lang, is_asr in candidates:
        key = (lang, is_asr)
        if key in seen or not lang:
            continue
        seen.add(key)
        params = {"v": vid, "lang": lang, "fmt": "vtt"}
        if is_asr:
            params["kind"] = "asr"
        try:
            r = requests.get(
                "https://www.youtube.com/api/timedtext",
                params=params, headers=headers, timeout=10,
            )
            if r.status_code == 200 and (r.text or "").strip() and "-->" in r.text:
                segs = _parse_vtt(r.text)
                if segs:
                    src = "auto" if is_asr else "manual"
                    print(f"[beidanzi] timedtext 抓到字幕 lang={lang} asr={is_asr} segs={len(segs)}")
                    return segs, src, None
        except Exception as e:
            print(f"[beidanzi] timedtext 下載失敗 lang={lang}: {e}")
            continue
    return None, None, None


def _youtube_captions_once(url: str, language: Optional[str], proxy: Optional[str] = None) -> tuple:
    """單次嘗試抓字幕。回傳 (segments, source, title)。"""
    opts: dict = {
        "skip_download": True,
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "socket_timeout": 15,
        "retries": 1,
        # android/ios client 在 Cloud Run 較不易被擋
        "extractor_args": {"youtube": {"player_client": ["android", "ios", "web"]}},
    }
    if proxy:
        opts["proxy"] = f"http://{proxy}"
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
    if not info:
        return None, None, None
    title = (info.get("title") or "").strip() or None
    preferred = _yt_caption_lang_keys(language)
    entries, source = _pick_caption_track(info, preferred)
    if not entries:
        print(f"[beidanzi] 此影片無可用字幕軌（manual={list((info.get('subtitles') or {}).keys())[:8]} auto={list((info.get('automatic_captions') or {}).keys())[:8]}）")
        return None, None, title
    body = _download_caption_body(entries, proxy)
    if not body:
        return None, None, title
    segs = _parse_vtt(body)
    return (segs if segs else None), source, title

def _youtube_captions(url: str, language: Optional[str]) -> tuple:
    """抓 YouTube 現有字幕（含自動字幕）。
    順序：timedtext（快）→ yt-dlp 直連 → 少量代理。回傳 (segments, source, title)。
    """
    last_err = None
    best_title = None
    vid = _yt_id(url)

    # 0) 最快路徑：timedtext API（不靠 yt-dlp）
    try:
        segs, source, _ = _youtube_captions_timedtext(vid or "", language)
        if segs:
            return segs, source, None
    except Exception as e:
        print(f"[beidanzi] timedtext 路徑失敗: {e}")

    # 1) yt-dlp 直連（android client）
    try:
        segs, source, title = _youtube_captions_once(url, language, None)
        best_title = title or best_title
        if segs:
            print(f"[beidanzi] 直連抓到字幕 source={source} segs={len(segs)} title={title!r}")
            return segs, source, title
        # extract 成功但沒字幕 → 再狂試代理通常沒用，直接放棄
        if title is not None:
            print("[beidanzi] 直連已取得影片資訊但無字幕內容，略過大量代理重試")
            return None, None, best_title
    except Exception as e:
        last_err = e
        print(f"[beidanzi] 直連抓字幕失敗: {e}")

    if not YT_PROXY_ENABLED:
        return None, None, best_title

    # 2) 少量代理（字幕場景掃太多會卡很久）
    cap_proxy_tries = min(3, YT_MAX_PROXY_ATTEMPTS)
    live = _filter_live_proxies(_fetch_free_proxies(), want=min(6, cap_proxy_tries + 2))
    tried = 0
    for p in live:
        if tried >= cap_proxy_tries:
            break
        tried += 1
        try:
            segs, source, title = _youtube_captions_once(url, language, p)
            best_title = title or best_title
            if segs:
                print(f"[beidanzi] 代理抓到字幕 source={source} segs={len(segs)} proxy={p} title={title!r}")
                return segs, source, title
        except Exception as e:
            last_err = e
            print(f"[beidanzi] 代理抓字幕失敗 ({tried}): {e}")
            continue
    print(f"[beidanzi] 抓字幕最終失敗（試了 {tried} 個代理）: {last_err}")
    return None, None, best_title

@app.post("/api/beidanzi/upload")
async def beidanzi_upload(file: UploadFile = File(...), language: Optional[str] = Form(None)):
    ext = os.path.splitext(file.filename or ".mp4")[1]
    fd, path = tempfile.mkstemp(suffix=ext)
    os.close(fd)
    with open(path, "wb") as buf:
        shutil.copyfileobj(file.file, buf)
    loop = asyncio.get_event_loop()
    try:
        media_url, media_type = await loop.run_in_executor(executor, _store_media_public, path, file.filename or "media")
        segments = await loop.run_in_executor(executor, _transcribe_to_segments, path, language or "None")
        return {
            "mediaUrl": media_url, "mediaType": media_type, "segments": segments,
            "title": os.path.splitext(file.filename or "media")[0],
        }
    except Exception as e:
        raise HTTPException(500, f"轉錄失敗: {e}")
    finally:
        try:
            os.remove(path)
        except OSError:
            pass

@app.post("/api/beidanzi/youtube")
async def beidanzi_youtube(
    url: str = Form(...),
    language: Optional[str] = Form(None),
    force_whisper: Optional[str] = Form(None),
):
    vid = _yt_id(url)
    loop = asyncio.get_event_loop()
    force = str(force_whisper or "").strip().lower() in ("1", "true", "yes", "whisper")
    # 先用 oEmbed 抓標題（快、常成功），稍後再被 yt-dlp 標題覆寫
    title = await loop.run_in_executor(executor, _youtube_oembed_title, url)

    # 1) 字幕優先（除非使用者強制 Whisper；含自動 CC；直連失敗會走代理）
    if not force:
        segs, source, yt_title = await loop.run_in_executor(executor, _youtube_captions, url, language)
        title = yt_title or title
        if segs:
            return {
                "videoId": vid, "segments": segs,
                "captionSource": source or "manual",
                "usedWhisper": False,
                "title": title or f"YouTube {vid}",
            }

    # 2) 沒字幕／抓不到／強制 Whisper → 下載音訊轉錄
    print(f"[beidanzi] {'強制' if force else '無字幕可用，改'}下載音訊 + Whisper: {url}")
    temp_dir = tempfile.mkdtemp()
    try:
        audio_files = await loop.run_in_executor(executor, _download_youtube, url, temp_dir, None, None)
        if not audio_files:
            raise HTTPException(500, "找不到可轉錄的音訊")
        if not title:
            title = audio_files[0][0]  # yt-dlp 下載檔名裡的標題
        segments = await loop.run_in_executor(executor, _transcribe_to_segments, audio_files[0][1], language or "None")
        return {
            "videoId": vid, "segments": segments,
            "captionSource": "whisper",
            "usedWhisper": True,
            "title": title or f"YouTube {vid}",
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"YouTube 轉錄失敗: {e}")
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)

@app.post("/api/beidanzi/store_audio")
async def beidanzi_store_audio(file: UploadFile = File(...)):
    """把前端產生的 AI 語音（WAV）永久存進 Firebase Storage，回傳公開下載網址。"""
    ext = os.path.splitext(file.filename or ".wav")[1].lower() or ".wav"
    fd, path = tempfile.mkstemp(suffix=ext)
    os.close(fd)
    with open(path, "wb") as buf:
        shutil.copyfileobj(file.file, buf)
    try:
        url, _ = await asyncio.get_event_loop().run_in_executor(
            executor, _store_media_public, path, file.filename or "audio.wav")
        return {"url": url}
    except Exception as e:
        raise HTTPException(500, f"存檔失敗: {e}")
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


# ─── 線上詞典補充（背單字：未貼歐路內容時自動抓） ───────────────
_DICT_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)


def _dict_slug(word: str) -> str:
    s = (word or "").strip().lower()
    s = re.sub(r"\s+", "-", s)
    s = re.sub(r"[^a-z0-9'\-]", "", s)
    return s


def _html_to_text(html_str: str) -> str:
    t = html_str or ""
    t = re.sub(r"(?is)<script[^>]*>.*?</script>", " ", t)
    t = re.sub(r"(?is)<style[^>]*>.*?</style>", " ", t)
    t = re.sub(r"(?is)<noscript[^>]*>.*?</noscript>", " ", t)
    t = re.sub(r"(?is)<!--.*?-->", " ", t)
    t = re.sub(r"(?is)<[^>]+>", " ", t)
    t = html.unescape(t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def _clean_dict_chunk(name: str, text: str, max_len: int = 3800) -> str:
    t = text or ""
    t = re.sub(r"\{\{[^}]{0,80}\}\}", " ", t)
    t = re.sub(r"\b(AMP\.setState|searchAutoComplete|changeToLayoutContainer)\S{0,120}", " ", t, flags=re.I)
    t = re.sub(
        r"\b(Log in|Sign up|Cookie|Subscribe|Advertisement|My profile|AI Assistant|Thesaurus \+Plus|Cambridge Dictionary \+Plus)\b",
        " ", t, flags=re.I,
    )
    t = re.sub(r"\s+", " ", t).strip()
    if len(t) < 60:
        return ""
    if len(t) > max_len:
        t = t[:max_len] + "…"
    return f"【{name}】\n{t}"


def _focus_after_word(text: str, word: str) -> str:
    t = text or ""
    w = (word or "").lower()
    if not w:
        return t
    i = t.lower().find(w)
    return t[i:] if i >= 0 else t


def _fetch_free_dict(slug: str) -> dict:
    try:
        r = requests.get(
            f"https://api.dictionaryapi.dev/api/v2/entries/en/{quote(slug)}",
            headers={"Accept": "application/json", "User-Agent": _DICT_UA},
            timeout=10,
        )
        r.raise_for_status()
        data = r.json()
        lines = []
        for en in data or []:
            if en.get("phonetic"):
                lines.append(f"音標 {en['phonetic']}")
            for m in en.get("meanings") or []:
                lines.append(f"詞性 {m.get('partOfSpeech') or ''}")
                for d in (m.get("definitions") or [])[:5]:
                    lines.append(f"- {d.get('definition') or ''}")
                    if d.get("example"):
                        lines.append(f"  例：{d['example']}")
        text = _clean_dict_chunk("Free Dictionary（英英後備）", "\n".join(lines), 3500)
        if not text:
            return {"id": "freedict", "name": "Free Dictionary", "error": "empty"}
        return {
            "id": "freedict",
            "name": "Free Dictionary",
            "text": text,
            "via": "api",
            "url": "https://api.dictionaryapi.dev",
        }
    except Exception as e:
        return {"id": "freedict", "name": "Free Dictionary", "error": str(e)}


def _is_cf_challenge(html: str, status: int = 200) -> bool:
    """偵測 Cloudflare JS／Managed Challenge 頁（不是真正詞典內容）。"""
    t = html or ""
    head = t[:4000]
    if status in (403, 503) and (
        "cloudflare" in t.lower() or "cf-" in t.lower() or "Just a moment" in t
    ):
        return True
    needles = (
        "Just a moment",
        "cf-browser-verification",
        "challenge-platform",
        "Performing security verification",
        "cdn-cgi/challenge",
        "Attention Required! | Cloudflare",
    )
    if any(n in t for n in needles):
        # 真正內容頁極少出現這些字；短頁更肯定是 challenge
        if len(t) < 25000 or "Just a moment" in head:
            return True
    return False


def _fetch_dict_url(url: str, timeout: float = 15.0, proxy: Optional[str] = None) -> str:
    """抓詞典 HTML。優先 curl_cffi（Chrome TLS 指紋），比 requests 更易過 Cloudflare 基礎擋。
    對 Turnstile／Managed Challenge 仍可能失敗，需再搭配代理。
    """
    headers = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7",
        "Cache-Control": "no-cache",
        "Upgrade-Insecure-Requests": "1",
    }
    proxies = {"http": f"http://{proxy}", "https": f"http://{proxy}"} if proxy else None

    # 1) curl_cffi：模擬真實瀏覽器 TLS／HTTP2（能過多數非 JS challenge 的 CF）
    try:
        from curl_cffi import requests as creq  # type: ignore
        r = creq.get(
            url,
            impersonate="chrome131",
            headers=headers,
            timeout=timeout,
            proxies=proxies,
            allow_redirects=True,
        )
        text = r.text or ""
        if _is_cf_challenge(text, getattr(r, "status_code", 200) or 200):
            raise RuntimeError(f"Cloudflare challenge ({getattr(r, 'status_code', '?')})")
        if getattr(r, "status_code", 0) >= 400:
            raise RuntimeError(f"HTTP {r.status_code}")
        return text
    except ImportError:
        pass
    except Exception:
        # 直連／此代理失敗時，再試普通 requests（部分站仍可用）
        if proxy:
            raise

    r = requests.get(
        url,
        headers={**headers, "User-Agent": _DICT_UA},
        timeout=timeout,
        allow_redirects=True,
        proxies=proxies,
    )
    text = r.text or ""
    if _is_cf_challenge(text, r.status_code):
        raise RuntimeError(f"Cloudflare challenge ({r.status_code})")
    r.raise_for_status()
    r.encoding = r.apparent_encoding or "utf-8"
    return r.text


def _fetch_dict_jina(url: str, timeout: float = 20.0, target_selector: Optional[str] = None) -> str:
    headers = {
        "User-Agent": _DICT_UA,
        "Accept": "text/plain",
        "X-Retain-Images": "none",
    }
    if target_selector:
        headers["X-Target-Selector"] = target_selector
    r = requests.get(
        "https://r.jina.ai/" + url,
        headers=headers,
        timeout=timeout,
    )
    r.raise_for_status()
    text = r.text or ""
    if _is_cf_challenge(text, r.status_code):
        raise RuntimeError("Jina also hit Cloudflare")
    return text


def _strip_md_links(text: str) -> str:
    t = text or ""
    t = re.sub(r"!\[([^\]]*)\]\([^)]*\)", " ", t)
    t = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", t)
    t = re.sub(r"\[\[([^\]]*)\]\]", r"\1", t)
    t = re.sub(r"\*+", "", t)
    return t


def _collins_looks_real(text: str, slug: str) -> bool:
    """判斷是否為真正柯林斯釋義（而非 cookie／導覽噪音）。"""
    t = (text or "").lower()
    if len(t) < 80:
        return False
    junk = ("opt-out request", "manage your privacy", "do not share or sell", "agree and close")
    junk_hits = sum(1 for j in junk if j in t)
    has_word_forms = "word forms" in t
    has_cobuild = bool(re.search(rf"\ba {re.escape(slug)} is\b|\ban {re.escape(slug)} is\b", t))
    if junk_hits and not has_word_forms and not has_cobuild:
        return False
    if re.search(r"\b1\.\s*(countable|uncountable|verb|noun|adjective|adverb|phrase)", t):
        return True
    signals = (
        "word forms", "countable noun", "uncountable noun", "transitive verb",
        "in british english", "in american english", "synonyms:",
        f"a {slug} is", f"an {slug} is", "cobuild",
    )
    return sum(1 for s in signals if s in t) >= 1


def _extract_collins_body(raw: str, slug: str) -> str:
    """從 HTML 或 Jina markdown 抽出柯林斯真正釋義。"""
    raw = raw or ""
    slug = (slug or "").lower()

    # HTML：優先抓 definitions / dictentry / .def
    if "<" in raw[:800] or "dictentry" in raw or 'class="def"' in raw or "class='def'" in raw:
        chunks: list[str] = []
        patterns = [
            r'(?is)<div[^>]*class="[^"]*content\s+definitions[^"]*"[^>]*>([\s\S]*?)</div>',
            r'(?is)<div[^>]*class="[^"]*dictentry[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*dictentry|$)',
            r'(?is)<div[^>]*class="[^"]*\bhom\b[^"]*"[^>]*>([\s\S]*?)</div>',
            r'(?is)<span[^>]*class="[^"]*\bdef\b[^"]*"[^>]*>([\s\S]*?)</span>',
            r'(?is)<div[^>]*class="[^"]*sense[^"]*"[^>]*>([\s\S]*?)</div>',
        ]
        for pat in patterns:
            for m in re.finditer(pat, raw):
                chunk = _html_to_text(m.group(1))
                if len(chunk) > 40:
                    chunks.append(chunk)
            if len(chunks) >= 3:
                break
        if chunks:
            body = "\n".join(chunks)
            if _collins_looks_real(body, slug):
                return body

    t = _strip_md_links(raw)
    # 砍掉隱私橫幅
    t = re.sub(
        r"(?is)Opt-Out Request Honored.*?(?=Word forms|##\s*\w|\b1\.\s*(?:countable|uncountable)|in British English|in American English)",
        " ",
        t,
    )
    anchors = [
        r"(?i)Word forms\s*:",
        rf"(?i)##\s*{re.escape(slug)}\b",
        r"(?i)in British English",
        r"(?i)in American English",
        r"(?i)\b1\.\s*(?:countable|uncountable|verb|adjective|adverb|noun|phrase)",
        rf"(?i)\bA {re.escape(slug)} is\b",
        rf"(?i)\bAn {re.escape(slug)} is\b",
    ]
    best = t
    for a in anchors:
        m = re.search(a, t)
        if m:
            best = t[m.start():]
            break
    best = re.split(
        r"(?i)\n(?:Browse alphabetically|Trends of |Source:\s*Collins|Get the latest|You may also like)",
        best,
        maxsplit=1,
    )[0]
    best = re.sub(r"\s+", " ", best).strip()
    return best if _collins_looks_real(best, slug) else ""


def _dict_sources(slug: str):
    q = quote(slug)
    return [
        {
            "id": "cambridge",
            "name": "劍橋 Cambridge",
            "cf": True,  # 可能有 Cloudflare，失敗時走代理
            "urls": [
                f"https://dictionary.cambridge.org/dictionary/english-chinese-traditional/{q}",
                f"https://dictionary.cambridge.org/dictionary/english/{q}",
            ],
        },
        {
            "id": "collins",
            "name": "柯林斯 Collins",
            "cf": True,
            # Cloud Run IP 幾乎必被 CF 擋；Jina + CSS 選擇器才能拿到真釋義
            "prefer_jina": True,
            "jina_selectors": [".dictentry", ".content.definitions", "main", "article"],
            "urls": [
                f"https://www.collinsdictionary.com/dictionary/english/{q}",
                f"https://www.collinsdictionary.com/dictionary/english-chinese/{q}",
            ],
        },
        {
            "id": "ldoce",
            "name": "朗文 LDOCE",
            "urls": [f"https://www.ldoceonline.com/dictionary/{q}"],
        },
        {
            "id": "eudic",
            "name": "歐路 Eudic",
            "urls": [f"https://dict.eudic.net/dicts/en/{q}"],
        },
        {
            "id": "etymonline",
            "name": "Etymonline 詞源",
            "urls": [
                f"https://www.etymonline.com/word/{q}",
                f"https://www.etymonline.com/tw/word/{q}",
            ],
        },
    ]


def _body_from_raw(src: dict, raw: str, slug: str) -> str:
    """依來源把原始 HTML／markdown 收成可用正文。"""
    if src.get("id") == "collins":
        return _extract_collins_body(raw, slug)
    return _focus_after_word(_html_to_text(raw) if "<" in (raw or "")[:500] else raw, slug or src.get("id", ""))


def _fetch_one_dict_source(src: dict, slug: str = "") -> dict:
    last_err = ""
    need_proxy = False
    slug = slug or ""

    def _ok_text(raw: str, via: str, url: str):
        body = _body_from_raw(src, raw, slug)
        # Jina markdown 非 HTML 時 _body_from_raw 已處理；一般來源再走 focus
        if src.get("id") != "collins" and (not body or len(body) < 60):
            body = _focus_after_word(raw, slug)
        max_len = 4500 if src.get("id") == "collins" else 3800
        text = _clean_dict_chunk(src["name"], body, max_len)
        if not text:
            raise RuntimeError("empty after clean")
        if src.get("id") == "collins" and not _collins_looks_real(body, slug):
            raise RuntimeError("collins content looks like chrome/nav, not definitions")
        return {"id": src["id"], "name": src["name"], "url": url, "text": text, "via": via}

    # 0) 柯林斯：優先 Jina + CSS 選擇器（避開 CF，且不要抓到導覽噪音）
    if src.get("prefer_jina") or src.get("jina_selectors"):
        for url in src["urls"]:
            for sel in (src.get("jina_selectors") or [None]):
                try:
                    md = _fetch_dict_jina(url, target_selector=sel)
                    return _ok_text(md, f"jina:{sel or 'full'}", url)
                except Exception as e:
                    last_err = str(e)

    # 1) 直連（curl_cffi TLS 模擬）
    for url in src["urls"]:
        try:
            html_str = _fetch_dict_url(url)
            return _ok_text(html_str, "curl_cffi", url)
        except Exception as e:
            last_err = str(e)
            if "Cloudflare" in last_err or "403" in last_err:
                need_proxy = True

    # 2) Cloudflare 站：並行試免費代理 + curl_cffi
    if src.get("cf") or need_proxy:
        try:
            cands = list(_fetch_free_proxies(limit=160))
            random.shuffle(cands)
            cands = cands[:24]
        except Exception as e:
            cands = []
            last_err = f"proxy list: {e}"
        url = src["urls"][0]

        def _try_proxy(p: str):
            html_str = _fetch_dict_url(url, proxy=p, timeout=11.0)
            return _ok_text(html_str, "curl_cffi+proxy", url)

        if cands:
            with ThreadPoolExecutor(max_workers=10) as pool:
                futs = {pool.submit(_try_proxy, p): p for p in cands}
                try:
                    from concurrent.futures import as_completed
                    for fut in as_completed(futs, timeout=50):
                        p = futs[fut]
                        try:
                            out = fut.result()
                            print(f"[dict_fetch] {src['id']} via proxy {p}")
                            for other in futs:
                                other.cancel()
                            return out
                        except Exception as e:
                            last_err = str(e)
                            continue
                except Exception as e:
                    last_err = str(e)

    # 3) Jina 可讀內容後備（無選擇器，再靠 extract 裁切）
    for url in src["urls"]:
        try:
            md = _fetch_dict_jina(url)
            return _ok_text(md, "jina", url)
        except Exception as e:
            last_err = str(e)
    return {"id": src["id"], "name": src["name"], "error": last_err or "failed"}


def _fetch_online_dicts_sync(word: str) -> dict:
    slug = _dict_slug(word)
    if not slug:
        raise ValueError("invalid word")
    sources = _dict_sources(slug)
    results = []
    with ThreadPoolExecutor(max_workers=6) as pool:
        futs = [pool.submit(_fetch_one_dict_source, s, slug) for s in sources]
        futs.append(pool.submit(_fetch_free_dict, slug))
        for f in futs:
            try:
                results.append(f.result(timeout=45))
            except Exception as e:
                results.append({"id": "?", "name": "?", "error": str(e)})
    # 固定來源順序組裝，避免執行緒完成順序把柯林斯擠出 14k 上限
    order = ["cambridge", "collins", "ldoce", "eudic", "etymonline", "freedict"]
    by_id = {r.get("id"): r for r in results if r.get("text")}
    parts = []
    for oid in order:
        if oid in by_id:
            parts.append(by_id[oid]["text"])
    for r in results:
        rid = r.get("id")
        if r.get("text") and rid not in order:
            parts.append(r["text"])
    text = "\n\n".join(parts)[:16000]
    return {
        "word": slug,
        "text": text,
        "sources": [
            {
                "id": r.get("id"),
                "name": r.get("name"),
                "ok": bool(r.get("text")),
                "via": r.get("via"),
                "url": r.get("url"),
                "error": r.get("error"),
                "chars": len(r["text"]) if r.get("text") else 0,
            }
            for r in results
        ],
    }


@app.get("/api/beidanzi/dict_fetch")
async def beidanzi_dict_fetch(word: str = ""):
    """代抓劍橋／柯林斯／朗文／歐路／Etymonline 文字，供背單字 AI 整理補充。"""
    slug = _dict_slug(word)
    if not slug:
        raise HTTPException(400, "請提供 word 參數")
    try:
        out = await asyncio.get_event_loop().run_in_executor(executor, _fetch_online_dicts_sync, slug)
        return out
    except Exception as e:
        raise HTTPException(500, f"詞典抓取失敗: {e}")


@app.get("/api/health")
async def health():
    return {"status": "ok", "engine": "replicate", "model": "incredibly-fast-whisper"}


# ─── Google Cloud Speech-to-Text (chunk / quick voice) ───────────────────────
def _google_stt_language(raw: Optional[str]) -> str:
    s = (raw or "").strip()
    if not s or s.lower() in ("auto", "none", "detect"):
        return "zh-TW"
    low = s.lower().replace("_", "-")
    if low in ("zh", "zh-tw", "zh-hant", "cmn-hant-tw"):
        return "zh-TW"
    if low in ("zh-cn", "zh-hans", "cmn-hans-cn"):
        return "zh-CN"
    if low.startswith("en"):
        return "en-US"
    if low.startswith("ja"):
        return "ja-JP"
    return s


def _transcribe_google_bytes(content: bytes, language: str, mime: str = "") -> str:
    """Sync recognize via Google STT v1. Supports WEBM_OPUS (browser MediaRecorder)."""
    if not content:
        raise ValueError("empty audio")
    try:
        from google.cloud import speech_v1 as speech
    except ImportError as e:
        raise RuntimeError(
            "缺少 google-cloud-speech。請在後端安裝並啟用 Cloud Speech-to-Text API。"
        ) from e

    client = speech.SpeechClient()
    lang = _google_stt_language(language)
    mime_l = (mime or "").lower()
    # Browser MediaRecorder typically produces audio/webm;codecs=opus at 48 kHz.
    if "webm" in mime_l or "opus" in mime_l or content[:4] == b"\x1aE\xdf\xa3":
        encoding = speech.RecognitionConfig.AudioEncoding.WEBM_OPUS
        rate = 48000
    elif "wav" in mime_l or "wave" in mime_l or content[:4] == b"RIFF":
        encoding = speech.RecognitionConfig.AudioEncoding.LINEAR16
        rate = 16000
    elif "flac" in mime_l:
        encoding = speech.RecognitionConfig.AudioEncoding.FLAC
        rate = 16000
    else:
        encoding = speech.RecognitionConfig.AudioEncoding.WEBM_OPUS
        rate = 48000

    config = speech.RecognitionConfig(
        encoding=encoding,
        sample_rate_hertz=rate,
        language_code=lang,
        enable_automatic_punctuation=True,
        model="latest_long",
        alternative_language_codes=["zh-TW", "zh-CN", "en-US"] if lang.startswith("zh") else [],
    )
    audio = speech.RecognitionAudio(content=content)
    # Sync recognize ≈ 1 minute max — keep live segments under ~55s.
    response = client.recognize(config=config, audio=audio)
    parts: List[str] = []
    for result in response.results:
        alt = result.alternatives[0] if result.alternatives else None
        if alt and alt.transcript:
            parts.append(alt.transcript.strip())
    text = "\n".join(parts).strip()
    if not text:
        raise ValueError("Google STT 未辨識到語音（可能太短或太安靜）")
    return text


@app.post("/api/stt/google")
async def stt_google(
    file: UploadFile = File(...),
    language: Optional[str] = Form(None),
):
    """Transcribe a short audio clip with Google Cloud Speech-to-Text (for live segments / quick voice)."""
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "空音訊")
    # Soft guard — sync recognize is not for long files
    if len(raw) > 12 * 1024 * 1024:
        raise HTTPException(400, "音訊過大，請縮短段落（建議 60 秒內）")
    mime = file.content_type or ""
    lang = language or DEFAULT_LANGUAGE

    def run():
        return _transcribe_google_bytes(raw, lang, mime)

    try:
        text = await asyncio.get_event_loop().run_in_executor(executor, run)
        return {"text": text, "engine": "google-stt", "language": _google_stt_language(lang)}
    except Exception as e:
        msg = str(e)
        if "default credentials" in msg.lower() or "GOOGLE_APPLICATION_CREDENTIALS" in msg:
            raise HTTPException(
                503,
                "尚未設定 Google 憑證。請在 Cloud Run / 本機設定 GOOGLE_APPLICATION_CREDENTIALS，並啟用 Speech-to-Text API。",
            ) from e
        if "PERMISSION_DENIED" in msg or "403" in msg:
            raise HTTPException(403, f"Speech-to-Text 權限不足：{msg}") from e
        raise HTTPException(500, f"Google STT 失敗：{msg}") from e


@app.get("/api/stt/google/health")
async def stt_google_health():
    try:
        from google.cloud import speech_v1 as speech  # noqa: F401
        ok_pkg = True
    except Exception:
        ok_pkg = False
    try:
        from google.cloud.speech_v2 import SpeechClient as SpeechClientV2  # noqa: F401
        ok_v2 = True
    except Exception:
        ok_v2 = False
    creds = bool(os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")) or bool(
        os.environ.get("GOOGLE_CLOUD_PROJECT") or os.environ.get("GCLOUD_PROJECT") or os.environ.get("GCP_PROJECT")
    )
    return {
        "package": ok_pkg,
        "package_v2": ok_v2,
        "credentials_hint": creds,
        "ready": ok_pkg or ok_v2,
        "stream": True,
        "location": os.environ.get("GOOGLE_STT_LOCATION", "asia-southeast1"),
        "model": os.environ.get("GOOGLE_STT_MODEL", "chirp_2"),
        "note": "Cloud Run 可用服務帳號 ADC；串流走 /api/stt/google/stream（WebSocket）。",
    }


def _google_project_id() -> str:
    return (
        os.environ.get("GCP_PROJECT")
        or os.environ.get("GOOGLE_CLOUD_PROJECT")
        or os.environ.get("GCLOUD_PROJECT")
        or ""
    ).strip()


def _google_stt_v2_language(raw: Optional[str]) -> str:
    """V2 Chirp prefers BCP-47 like cmn-Hant-TW."""
    s = (raw or "").strip()
    if not s or s.lower() in ("auto", "none", "detect"):
        return "cmn-Hant-TW"
    low = s.lower().replace("_", "-")
    if low in ("zh", "zh-tw", "zh-hant", "cmn-hant-tw"):
        return "cmn-Hant-TW"
    if low in ("zh-cn", "zh-hans", "cmn-hans-cn"):
        return "cmn-Hans-CN"
    if low.startswith("en"):
        return "en-US"
    if low.startswith("ja"):
        return "ja-JP"
    if low.startswith("cmn-"):
        return s
    return s


def _run_google_stream_v2(
    audio_q: "thread_queue.Queue[Optional[bytes]]",
    on_event: Callable[[dict], None],
    language: str,
) -> None:
    """Blocking V2 StreamingRecognize with interim results. PCM LINEAR16 @ 16 kHz mono."""
    from google.api_core.client_options import ClientOptions
    from google.cloud.speech_v2 import SpeechClient
    from google.cloud.speech_v2.types import cloud_speech as cst

    project = _google_project_id()
    if not project:
        raise RuntimeError("缺少 GCP_PROJECT / GOOGLE_CLOUD_PROJECT")

    location = (os.environ.get("GOOGLE_STT_LOCATION") or "asia-southeast1").strip()
    model = (os.environ.get("GOOGLE_STT_MODEL") or "chirp_2").strip()
    lang = _google_stt_v2_language(language)
    recognizer = f"projects/{project}/locations/{location}/recognizers/_"

    if location and location != "global":
        client = SpeechClient(
            client_options=ClientOptions(api_endpoint=f"{location}-speech.googleapis.com")
        )
    else:
        client = SpeechClient()

    # Prefer explicit LINEAR16 PCM (browser sends s16le @ 16kHz mono).
    enc = getattr(cst.ExplicitDecodingConfig.AudioEncoding, "LINEAR16", None)
    if enc is None:
        enc = getattr(cst, "AudioEncoding", None)
        enc = getattr(enc, "LINEAR16", 1) if enc else 1
    recognition_config = cst.RecognitionConfig(
        explicit_decoding_config=cst.ExplicitDecodingConfig(
            encoding=enc,
            sample_rate_hertz=16000,
            audio_channel_count=1,
        ),
        language_codes=[lang],
        model=model,
        features=cst.RecognitionFeatures(enable_automatic_punctuation=True),
    )
    streaming_config = cst.StreamingRecognitionConfig(
        config=recognition_config,
        streaming_features=cst.StreamingRecognitionFeatures(interim_results=True),
    )
    config_request = cst.StreamingRecognizeRequest(
        recognizer=recognizer,
        streaming_config=streaming_config,
    )

    def requests():
        yield config_request
        while True:
            chunk = audio_q.get()
            if chunk is None:
                break
            if not chunk:
                continue
            # gRPC message limit ~25KB
            view = memoryview(chunk)
            step = 24000
            for i in range(0, len(view), step):
                yield cst.StreamingRecognizeRequest(audio=bytes(view[i : i + step]))

    metadata = [("x-goog-request-params", f"recognizer={recognizer}")]
    on_event({"type": "ready", "engine": "google-stt-v2", "model": model, "language": lang, "location": location})
    for response in client.streaming_recognize(requests=requests(), metadata=metadata):
        for result in response.results:
            if not result.alternatives:
                continue
            text = (result.alternatives[0].transcript or "").strip()
            if not text:
                continue
            on_event(
                {
                    "type": "final" if result.is_final else "interim",
                    "text": text,
                    "stability": float(getattr(result, "stability", 0) or 0),
                }
            )


def _run_google_stream_v1(
    audio_q: "thread_queue.Queue[Optional[bytes]]",
    on_event: Callable[[dict], None],
    language: str,
) -> None:
    """V1 streaming fallback — strong interim results for zh-TW."""
    from google.cloud import speech_v1 as speech

    lang = _google_stt_language(language)
    client = speech.SpeechClient()
    config = speech.RecognitionConfig(
        encoding=speech.RecognitionConfig.AudioEncoding.LINEAR16,
        sample_rate_hertz=16000,
        language_code=lang,
        enable_automatic_punctuation=True,
        model="latest_long",
        alternative_language_codes=["zh-TW", "zh-CN", "en-US"] if lang.startswith("zh") else [],
    )
    streaming_config = speech.StreamingRecognitionConfig(
        config=config,
        interim_results=True,
    )

    def requests():
        yield speech.StreamingRecognizeRequest(streaming_config=streaming_config)
        while True:
            chunk = audio_q.get()
            if chunk is None:
                break
            if not chunk:
                continue
            view = memoryview(chunk)
            step = 24000
            for i in range(0, len(view), step):
                yield speech.StreamingRecognizeRequest(audio_content=bytes(view[i : i + step]))

    on_event({"type": "ready", "engine": "google-stt-v1", "model": "latest_long", "language": lang})
    for response in client.streaming_recognize(requests()):
        for result in response.results:
            if not result.alternatives:
                continue
            text = (result.alternatives[0].transcript or "").strip()
            if not text:
                continue
            on_event(
                {
                    "type": "final" if result.is_final else "interim",
                    "text": text,
                    "stability": float(getattr(result, "stability", 0) or 0),
                }
            )


@app.websocket("/api/stt/google/stream")
async def stt_google_stream(websocket: WebSocket):
    """
    Real-time StreamingRecognize bridge.
    Client protocol:
      1) text JSON: {"language":"zh-TW"}
      2) binary frames: raw PCM s16le mono @ 16 kHz (≤ ~25KB / frame)
      3) text JSON: {"type":"end"} to finish
    Server events (JSON text):
      ready | interim | final | error | closed
    """
    await websocket.accept()
    try:
        init_raw = await websocket.receive_text()
        init = json.loads(init_raw) if init_raw else {}
    except Exception:
        await websocket.send_json({"type": "error", "message": "請先傳送 JSON 設定 {language}"})
        await websocket.close()
        return

    language = str(init.get("language") or DEFAULT_LANGUAGE or "zh-TW")
    prefer_v2 = str(init.get("engine") or "v2").lower() != "v1"
    audio_q: thread_queue.Queue = thread_queue.Queue(maxsize=250)
    loop = asyncio.get_running_loop()
    out_q: asyncio.Queue = asyncio.Queue()
    stop_flag = threading.Event()

    def emit(ev: dict):
        if stop_flag.is_set():
            return
        try:
            asyncio.run_coroutine_threadsafe(out_q.put(ev), loop)
        except Exception:
            pass

    def worker():
        try:
            if prefer_v2 and _google_project_id():
                try:
                    _run_google_stream_v2(audio_q, emit, language)
                    return
                except Exception as e:
                    emit({"type": "info", "message": f"V2 串流改走 V1：{e}"})
                    # drain leftover? start fresh — client keeps sending
            _run_google_stream_v1(audio_q, emit, language)
        except Exception as e:
            emit({"type": "error", "message": str(e)})
        finally:
            emit({"type": "closed"})

    t = threading.Thread(target=worker, daemon=True, name="google-stt-stream")
    t.start()

    async def pump_out():
        while True:
            ev = await out_q.get()
            try:
                await websocket.send_json(ev)
            except Exception:
                break
            if ev.get("type") == "closed":
                break

    out_task = asyncio.create_task(pump_out())
    try:
        while True:
            msg = await websocket.receive()
            if msg.get("type") == "websocket.disconnect":
                break
            if "bytes" in msg and msg["bytes"] is not None:
                data = msg["bytes"]
                try:
                    audio_q.put(data, timeout=1.0)
                except thread_queue.Full:
                    try:
                        audio_q.get_nowait()
                    except Exception:
                        pass
                    try:
                        audio_q.put_nowait(data)
                    except Exception:
                        pass
            elif "text" in msg and msg["text"] is not None:
                try:
                    payload = json.loads(msg["text"])
                except Exception:
                    continue
                if payload.get("type") == "end":
                    audio_q.put(None)
                    break
    except WebSocketDisconnect:
        pass
    except Exception as e:
        emit({"type": "error", "message": str(e)})
    finally:
        stop_flag.set()
        try:
            audio_q.put_nowait(None)
        except Exception:
            pass
        try:
            await asyncio.wait_for(asyncio.shield(out_task), timeout=3.0)
        except Exception:
            out_task.cancel()
        try:
            await websocket.close()
        except Exception:
            pass


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
