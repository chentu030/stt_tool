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
from fastapi import FastAPI, File, UploadFile, HTTPException, Form, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import yt_dlp
import replicate
import httpx

# ─── Firebase Admin ──────────────────────────────────────────────
import firebase_admin
from firebase_admin import credentials as fb_creds, firestore, storage as fb_storage, auth as fb_auth
from google.cloud.firestore_v1.base_query import FieldFilter

import base64
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
DEFAULT_LANGUAGE = os.environ.get("WHISPER_LANGUAGE", "chinese")

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
executor = ThreadPoolExecutor(max_workers=2)

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
    with open(audio_path, "rb") as f:
        output = _replicate_client.run(
            WHISPER_MODEL,
            input={
                "audio": f,
                "task": "transcribe",
                "language": language,
                "timestamp": "chunk",
                "batch_size": 24,
            },
            wait=False,
            use_file_output=False,
        )
    return output

def _format_output(output, offset: float = 0.0) -> str:
    """Turn model output into '[hh:mm:ss -> hh:mm:ss] text' lines with a time offset."""
    if isinstance(output, dict) and output.get("chunks"):
        lines = []
        for c in output["chunks"]:
            ts = c.get("timestamp") or [None, None]
            start = ts[0] if ts and ts[0] is not None else 0.0
            end = ts[1] if len(ts) > 1 and ts[1] is not None else start
            text = (c.get("text") or "").strip()
            if text:
                lines.append(f"[{_hhmmss(start + offset)} -> {_hhmmss(end + offset)}] {text}\n")
        if lines:
            return "".join(lines)
    if isinstance(output, dict) and output.get("text"):
        return output["text"]
    if isinstance(output, str):
        return output
    return str(output)

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
            # YouTube blocks datacenter IPs ("Sign in to confirm you're not a bot"),
            # so fall back to rotating free proxies. Cookies (if provided) are used
            # in every attempt so private / members-only videos still work.
            def _yt_status(msg: str):
                job_ref.update({"position_label": msg})
            audio_files = _download_youtube(yt_url, temp_dir, cookie_content, _yt_status)

        if not audio_files:
            job_ref.update({"status": "error", "error_message": "No audio files found"})
            return

        total = len(audio_files)
        uid = job_data.get("user_id", "unknown")

        # Transcribe the job's files in parallel (bounded), reporting progress by
        # how many files are finished. Each file: transcribe -> store .txt.
        results: List[Optional[dict]] = [None] * total
        lock = threading.Lock()
        counter = {"done": 0, "ok": 0}

        def _work(idx: int, fname: str, local_path: str) -> None:
            try:
                text = _transcribe_audio_file(local_path)
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
    # Persist the cookie into the job doc so any Cloud Run instance (the one the
    # background task lands on) can read it — in-memory would not survive.
    if yt_token_id and yt_token_id in _cookies:
        updates["yt_cookie"] = _cookies[yt_token_id]
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

@app.get("/api/health")
async def health():
    return {"status": "ok", "engine": "replicate", "model": "incredibly-fast-whisper"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
