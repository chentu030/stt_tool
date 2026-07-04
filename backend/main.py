import os
import shutil
import tempfile
import glob
import json
import uuid
import subprocess
import asyncio
import threading
from typing import Optional, Dict, List
from concurrent.futures import ThreadPoolExecutor
from fastapi import FastAPI, File, UploadFile, HTTPException, Form, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import yt_dlp
import replicate
import requests as http_requests

# ─── Firebase Admin ──────────────────────────────────────────────
import firebase_admin
from firebase_admin import credentials as fb_creds, firestore, storage as fb_storage, auth as fb_auth

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

# ─── YouTube Cookie Auth ─────────────────────────────────────────
_cookies: Dict[str, str] = {}  # cookie_id -> cookie file content

# ─── Background task executor ───────────────────────────────────
executor = ThreadPoolExecutor(max_workers=2)

# ─── Helpers ─────────────────────────────────────────────────────
def _hhmmss(s: float) -> str:
    return f"{int(s//3600):02d}:{int(s%3600//60):02d}:{int(s%60):02d}"

def _sse(data: dict, event: str = "progress") -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"

def _transcribe_replicate(audio_path: str) -> str:
    """Send audio to Replicate openai/whisper and return timestamped transcript."""
    with open(audio_path, "rb") as f:
        output = replicate.run(
            "openai/whisper",
            input={
                "audio": f,
                "model": "large-v3",
                "language": "zh",
                "translate": False,
                "temperature": 0,
                "transcription": "plain text",
                "suppress_tokens": "-1",
                "logprob_threshold": -1.0,
                "no_speech_threshold": 0.6,
                "condition_on_previous_text": True,
                "compression_ratio_threshold": 2.4,
            }
        )
    # output is a dict with 'segments' and 'transcription'
    if isinstance(output, dict) and "segments" in output:
        lines = []
        for seg in output["segments"]:
            start = seg.get("start", 0)
            end = seg.get("end", 0)
            text = seg.get("text", "").strip()
            if text:
                lines.append(f"[{_hhmmss(start)} -> {_hhmmss(end)}] {text}\n")
        return "".join(lines)
    elif isinstance(output, dict) and "transcription" in output:
        return output["transcription"]
    elif isinstance(output, str):
        return output
    else:
        return str(output)

def _verify_token(authorization: Optional[str]) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing or invalid token")
    try:
        decoded = fb_auth.verify_id_token(authorization[7:])
        return decoded["uid"]
    except Exception:
        raise HTTPException(401, "Invalid Firebase token")

# ─── Upload Endpoint (SSE, instant mode) ─────────────────────────
@app.post("/api/transcribe/upload")
async def transcribe_upload(files: List[UploadFile] = File(...)):
    total = len(files)
    saved: List[tuple] = []
    for f in files:
        ext = os.path.splitext(f.filename or ".mp4")[1]
        fd, path = tempfile.mkstemp(suffix=ext)
        os.close(fd)
        with open(path, "wb") as buf:
            shutil.copyfileobj(f.file, buf)
        saved.append((f.filename or "unknown", path))

    async def gen():
        try:
            for idx, (fname, path) in enumerate(saved):
                n = idx + 1
                yield _sse({"file_index": n, "total_files": total, "filename": fname,
                            "progress": 0, "status": "transcribing", "text": ""})
                # Call Replicate API
                transcript = await asyncio.get_event_loop().run_in_executor(
                    executor, _transcribe_replicate, path)
                yield _sse({"file_index": n, "total_files": total, "filename": fname,
                            "progress": 100, "status": "file_done", "transcript": transcript})
                os.remove(path)
            yield _sse({"status": "all_done"}, event="complete")
        except Exception as e:
            yield _sse({"status": "error", "detail": str(e)}, event="error")
        finally:
            for _, p in saved:
                if os.path.exists(p): os.remove(p)
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
            with yt_dlp.YoutubeDL(opts) as ydl:
                ydl.download([url])
            yield _sse({"status": "download_complete", "progress": 100})

            audio_files = sorted(glob.glob(os.path.join(temp_dir, "*.mp3")))
            if not audio_files:
                audio_files = sorted([f for f in glob.glob(os.path.join(temp_dir, "*"))
                    if os.path.isfile(f) and "_ytcache" not in f and not f.endswith((".txt", ".json"))])
            if not audio_files:
                yield _sse({"status": "error", "detail": "No audio downloaded"}, event="error")
                return

            total = len(audio_files)
            for idx, ap in enumerate(audio_files):
                n = idx + 1
                bn = os.path.basename(ap)
                title = bn.rsplit("__", 1)[0] if "__" in bn else bn.rsplit(".", 1)[0]
                yield _sse({"file_index": n, "total_files": total, "filename": title,
                            "progress": 0, "status": "transcribing"})
                # Call Replicate API
                transcript = await asyncio.get_event_loop().run_in_executor(
                    executor, _transcribe_replicate, ap)
                yield _sse({"file_index": n, "total_files": total, "filename": title,
                            "progress": 100, "status": "file_done", "transcript": transcript})
            yield _sse({"status": "all_done"}, event="complete")
        except Exception as e:
            yield _sse({"status": "error", "detail": str(e)}, event="error")
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)
    return StreamingResponse(gen(), media_type="text/event-stream")

# ─── Background Job Processing ───────────────────────────────────
def _process_job_sync(job_id: str, job_data: dict):
    """Process a job in background thread, updating Firestore."""
    job_ref = fstore.collection("jobs").document(job_id)
    try:
        job_ref.update({"status": "processing", "progress": 0})
        temp_dir = tempfile.mkdtemp()
        audio_files: List[tuple] = []  # (filename, local_path)

        source = job_data.get("source_type", "upload")

        if source == "upload":
            # Download files from Firebase Storage
            for sp in job_data.get("storage_paths", []):
                blob = bucket.blob(sp)
                fname = os.path.basename(sp)
                local = os.path.join(temp_dir, fname)
                blob.download_to_filename(local)
                audio_files.append((fname, local))

        elif source == "youtube":
            # Download from YouTube
            yt_url = job_data.get("youtube_url", "")
            out_tpl = os.path.join(temp_dir, "%(title)s__%(id)s.%(ext)s")
            opts: dict = {"format": "bestaudio/best", "outtmpl": out_tpl,
                "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"}],
                "quiet": True, "no_warnings": True, "noplaylist": False}
            yt_token_id = job_data.get("yt_token_id")
            if yt_token_id and yt_token_id in _cookies:
                cookie_path = os.path.join(temp_dir, "cookies.txt")
                with open(cookie_path, "w", encoding="utf-8") as f:
                    f.write(_cookies[yt_token_id])
                opts["cookiefile"] = cookie_path
            with yt_dlp.YoutubeDL(opts) as ydl:
                ydl.download([yt_url])
            for mp3 in sorted(glob.glob(os.path.join(temp_dir, "*.mp3"))):
                bn = os.path.basename(mp3)
                title = bn.rsplit("__", 1)[0] if "__" in bn else bn.rsplit(".", 1)[0]
                audio_files.append((title, mp3))
            if not audio_files:
                for f in sorted(glob.glob(os.path.join(temp_dir, "*"))):
                    if os.path.isfile(f) and "_ytcache" not in f and not f.endswith((".txt", ".json")):
                        audio_files.append((os.path.basename(f), f))

        if not audio_files:
            job_ref.update({"status": "error", "error_message": "No audio files found"})
            return

        total = len(audio_files)
        all_transcripts = []
        result_paths = []
        uid = job_data.get("user_id", "unknown")

        for idx, (fname, local_path) in enumerate(audio_files):
            n = idx + 1
            job_ref.update({"current_file": n, "total_files": total,
                "progress": int((idx / total) * 100)})

            # Call Replicate API
            transcript = _transcribe_replicate(local_path)

            job_ref.update({"progress": int(((idx + 1) / total) * 100)})

            all_transcripts.append({"filename": fname, "text": transcript})

            # Upload result to Firebase Storage
            result_path = f"results/{uid}/{job_id}/{fname}.txt"
            blob = bucket.blob(result_path)
            blob.upload_from_string(transcript, content_type="text/plain")
            result_paths.append(result_path)

        job_ref.update({
            "status": "done",
            "progress": 100,
            "transcripts": all_transcripts,
            "result_paths": result_paths,
        })

        shutil.rmtree(temp_dir, ignore_errors=True)

    except Exception as e:
        job_ref.update({"status": "error", "error_message": str(e)})

@app.post("/api/jobs/start")
async def start_job(
    job_id: str = Form(...),
    youtube_url: Optional[str] = Form(None),
    yt_token_id: Optional[str] = Form(None),
    authorization: Optional[str] = Header(None),
):
    uid = _verify_token(authorization)
    job_doc = fstore.collection("jobs").document(job_id).get()
    if not job_doc.exists:
        raise HTTPException(404, "Job not found")
    job_data = job_doc.to_dict()
    if job_data.get("user_id") != uid:
        raise HTTPException(403, "Not your job")

    # Merge extra data
    if youtube_url:
        job_data["youtube_url"] = youtube_url
    if yt_token_id:
        job_data["yt_token_id"] = yt_token_id

    # Start background processing
    executor.submit(_process_job_sync, job_id, job_data)

    return {"status": "started", "job_id": job_id}

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
    return {"status": "ok", "engine": "replicate", "model": "openai/whisper:large-v3"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
