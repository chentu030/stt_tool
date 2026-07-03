import os
import shutil
import tempfile
import glob
import json
import time
import uuid
import subprocess
from typing import Optional, Dict, List
from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import yt_dlp
from faster_whisper import WhisperModel
import requests as http_requests

app = FastAPI(title="Transcription API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Model Loading (auto-detect GPU) ────────────────────────────
try:
    import ctranslate2
    _gpu_ok = ctranslate2.get_cuda_device_count() > 0
except Exception:
    _gpu_ok = False

DEVICE = "cuda" if _gpu_ok else "cpu"
COMPUTE = "float16" if _gpu_ok else "int8"

print(f"Loading Whisper model (small, {COMPUTE}) on {DEVICE}...")
model = WhisperModel("small", device=DEVICE, compute_type=COMPUTE)
print(f"Model loaded on {DEVICE}.")

# ─── YouTube OAuth (yt-dlp YouTube TV client creds) ─────────────
YT_CID = "861556708454-d6dlm3lh05idd8id68urjjnp6cpemup4.apps.googleusercontent.com"
YT_CSE = "SboVhoG9s0rNafixCSGGKXAT"
_tokens: Dict[str, dict] = {}


# ─── Helpers ─────────────────────────────────────────────────────
def _hhmmss(s: float) -> str:
    return f"{int(s//3600):02d}:{int(s%3600//60):02d}:{int(s%60):02d}"


def _duration(path: str) -> float:
    try:
        r = subprocess.run(
            ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", path],
            capture_output=True, text=True, timeout=30,
        )
        return float(r.stdout.strip())
    except Exception:
        return 0.0


def _sse(data: dict, event: str = "progress") -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _transcribe_stream(audio: str):
    """Yield (progress_pct, text_line) during transcription."""
    dur = _duration(audio)
    segs, info = model.transcribe(
        audio, language="zh", vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=500),
        beam_size=1, best_of=1,
    )
    if dur <= 0 and hasattr(info, "duration") and info.duration:
        dur = info.duration

    for seg in segs:
        line = f"[{_hhmmss(seg.start)} -> {_hhmmss(seg.end)}] {seg.text.strip()}\n"
        pct = min(int(seg.end / dur * 100), 99) if dur > 0 else -1
        yield pct, line
    yield 100, ""


# ─── Upload Endpoint (multi-file + SSE progress) ────────────────
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
                yield _sse({"file_index": n, "total_files": total,
                            "filename": fname, "progress": 0,
                            "status": "transcribing", "text": ""})
                lines = []
                for pct, line in _transcribe_stream(path):
                    if line:
                        lines.append(line)
                    yield _sse({"file_index": n, "total_files": total,
                                "filename": fname, "progress": pct,
                                "status": "transcribing", "text": line})

                transcript = "".join(lines)
                yield _sse({"file_index": n, "total_files": total,
                            "filename": fname, "progress": 100,
                            "status": "file_done", "transcript": transcript})
                os.remove(path)

            yield _sse({"status": "all_done"}, event="complete")
        except Exception as e:
            yield _sse({"status": "error", "detail": str(e)}, event="error")
        finally:
            for _, p in saved:
                if os.path.exists(p):
                    os.remove(p)

    return StreamingResponse(gen(), media_type="text/event-stream")


# ─── YouTube Endpoint (SSE progress + OAuth support) ─────────────
@app.post("/api/transcribe/youtube")
async def transcribe_youtube(
    url: str = Form(...),
    token_id: Optional[str] = Form(None),
):
    temp_dir = tempfile.mkdtemp()

    async def gen():
        try:
            yield _sse({"status": "downloading", "progress": 0, "filename": url})
            out_tpl = os.path.join(temp_dir, "%(title)s__%(id)s.%(ext)s")
            opts: dict = {
                "format": "bestaudio/best",
                "outtmpl": out_tpl,
                "postprocessors": [{"key": "FFmpegExtractAudio",
                                    "preferredcodec": "mp3",
                                    "preferredquality": "192"}],
                "quiet": True, "no_warnings": True, "noplaylist": False,
            }
            # Inject OAuth token into yt-dlp cache
            if token_id and token_id in _tokens:
                cache = os.path.join(temp_dir, "_ytcache")
                os.makedirs(os.path.join(cache, "yt-dlp"), exist_ok=True)
                with open(os.path.join(cache, "yt-dlp", "youtube-oauth2-token.json"), "w") as f:
                    json.dump(_tokens[token_id], f)
                opts.update({"username": "oauth2", "password": "", "cachedir": cache})

            with yt_dlp.YoutubeDL(opts) as ydl:
                ydl.download([url])

            yield _sse({"status": "download_complete", "progress": 100})

            audio_files = sorted(glob.glob(os.path.join(temp_dir, "*.mp3")))
            if not audio_files:
                audio_files = sorted([
                    f for f in glob.glob(os.path.join(temp_dir, "*"))
                    if os.path.isfile(f) and "_ytcache" not in f
                    and not f.endswith((".txt", ".json"))
                ])
            if not audio_files:
                yield _sse({"status": "error", "detail": "No audio downloaded"}, event="error")
                return

            total = len(audio_files)
            all_tx = []
            for idx, ap in enumerate(audio_files):
                n = idx + 1
                bn = os.path.basename(ap)
                title = bn.rsplit("__", 1)[0] if "__" in bn else bn.rsplit(".", 1)[0]
                yield _sse({"file_index": n, "total_files": total,
                            "filename": title, "progress": 0,
                            "status": "transcribing"})
                lines = []
                for pct, line in _transcribe_stream(ap):
                    if line:
                        lines.append(line)
                    yield _sse({"file_index": n, "total_files": total,
                                "filename": title, "progress": pct,
                                "status": "transcribing", "text": line})
                tx = "".join(lines)
                all_tx.append(f"=== {title} ===\n{tx}" if total > 1 else tx)
                yield _sse({"file_index": n, "total_files": total,
                            "filename": title, "progress": 100,
                            "status": "file_done", "transcript": tx})

            yield _sse({"status": "all_done",
                        "transcript": "\n".join(all_tx)}, event="complete")
        except Exception as e:
            yield _sse({"status": "error", "detail": str(e)}, event="error")
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    return StreamingResponse(gen(), media_type="text/event-stream")


# ─── YouTube OAuth Device Code Flow ─────────────────────────────
@app.post("/api/youtube/auth/start")
async def yt_auth_start():
    r = http_requests.post("https://oauth2.googleapis.com/device/code", data={
        "client_id": YT_CID,
        "scope": "https://www.googleapis.com/auth/youtube",
    })
    if r.status_code != 200:
        raise HTTPException(500, f"OAuth start failed: {r.text}")
    d = r.json()
    return {"device_code": d["device_code"], "user_code": d["user_code"],
            "verification_url": d["verification_url"],
            "expires_in": d["expires_in"], "interval": d.get("interval", 5)}


@app.post("/api/youtube/auth/poll")
async def yt_auth_poll(device_code: str = Form(...)):
    r = http_requests.post("https://oauth2.googleapis.com/token", data={
        "client_id": YT_CID, "client_secret": YT_CSE,
        "device_code": device_code,
        "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
    })
    d = r.json()
    if "access_token" in d:
        tid = str(uuid.uuid4())
        _tokens[tid] = {
            "access_token": d["access_token"],
            "refresh_token": d.get("refresh_token", ""),
            "token_type": d.get("token_type", "Bearer"),
            "expires_at": time.time() + d.get("expires_in", 3600),
        }
        return {"status": "authorized", "token_id": tid}
    if d.get("error") == "authorization_pending":
        return {"status": "pending"}
    if d.get("error") == "slow_down":
        return {"status": "slow_down"}
    return {"status": "error",
            "detail": d.get("error_description", d.get("error", "Unknown"))}


@app.get("/api/health")
async def health():
    return {"status": "ok", "device": DEVICE, "compute_type": COMPUTE}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
