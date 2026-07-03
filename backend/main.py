import os
import shutil
import tempfile
import glob
from typing import Optional
from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import yt_dlp
from faster_whisper import WhisperModel

app = FastAPI(title="Transcription API")

# Allow CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Adjust in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load model globally on CPU as Cloud Run is CPU-only
print("Loading Whisper model (small, int8 quantized) on CPU...")
model = WhisperModel("small", device="cpu", compute_type="int8")
print("Model loaded successfully.")


def seconds_to_hhmmss(seconds: float) -> str:
    """Convert seconds to HH:MM:SS format"""
    hours = int(seconds // 3600)
    mins = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    return f"{hours:02d}:{mins:02d}:{secs:02d}"


def transcribe_audio(audio_path: str) -> str:
    """Transcribe audio file using faster-whisper and return formatted text."""
    segments, info = model.transcribe(
        audio_path,
        language="zh",
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=500),
        beam_size=1,
        best_of=1
    )

    transcript = ""
    for segment in segments:
        start_str = seconds_to_hhmmss(segment.start)
        end_str = seconds_to_hhmmss(segment.end)
        transcript += f"[{start_str} -> {end_str}] {segment.text.strip()}\n"

    return transcript


@app.post("/api/transcribe/upload")
async def transcribe_upload(file: UploadFile = File(...)):
    """Handle direct file upload and transcribe."""
    try:
        # Create a temporary file to store the upload
        fd, temp_file_path = tempfile.mkstemp(suffix=os.path.splitext(file.filename)[1] or ".mp4")
        os.close(fd)

        with open(temp_file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        # Transcribe
        transcript = transcribe_audio(temp_file_path)

        # Cleanup
        os.remove(temp_file_path)

        return {"filename": file.filename, "transcript": transcript}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/transcribe/youtube")
async def transcribe_youtube(
    url: str = Form(...),
    cookies: Optional[UploadFile] = File(None)
):
    """
    Handle YouTube URL and transcribe.
    Supports:
    - Public / unlisted videos (no cookies needed)
    - Private / member-only videos (requires cookies.txt upload)
    - Playlists (processes each video sequentially)
    """
    if not url:
        raise HTTPException(status_code=400, detail="URL is required")

    temp_dir = tempfile.mkdtemp()
    cookie_path = None

    try:
        # If cookies file was uploaded, save it to disk temporarily
        if cookies and cookies.filename:
            cookie_path = os.path.join(temp_dir, "cookies.txt")
            with open(cookie_path, "wb") as f:
                shutil.copyfileobj(cookies.file, f)

        output_template = os.path.join(temp_dir, "%(title)s__%(id)s.%(ext)s")

        ydl_opts = {
            'format': 'bestaudio/best',
            'outtmpl': output_template,
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }],
            'quiet': True,
            'no_warnings': True,
            'noplaylist': False,  # Allow playlists
        }

        if cookie_path:
            ydl_opts['cookiefile'] = cookie_path

        # Download audio(s)
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            print(f"Downloading audio from {url}...")
            ydl.download([url])

        # Find all downloaded audio files
        audio_files = sorted(glob.glob(os.path.join(temp_dir, "*.mp3")))
        if not audio_files:
            # Fallback: try any audio format
            audio_files = sorted([
                f for f in glob.glob(os.path.join(temp_dir, "*"))
                if not f.endswith(".txt") and os.path.isfile(f)
            ])

        if not audio_files:
            raise Exception("Failed to download audio from the provided URL.")

        # Transcribe each file
        all_transcripts = []
        for audio_path in audio_files:
            basename = os.path.basename(audio_path)
            # Extract title from filename (format: title__id.ext)
            title = basename.rsplit("__", 1)[0] if "__" in basename else basename.rsplit(".", 1)[0]
            print(f"Transcribing: {title}...")
            transcript = transcribe_audio(audio_path)

            if len(audio_files) > 1:
                # For playlists, add a header for each video
                all_transcripts.append(f"=== {title} ===\n{transcript}")
            else:
                all_transcripts.append(transcript)

        combined_transcript = "\n".join(all_transcripts)

        # Cleanup
        shutil.rmtree(temp_dir)

        return {"url": url, "transcript": combined_transcript}
    except Exception as e:
        # Cleanup on error
        if os.path.exists(temp_dir):
            shutil.rmtree(temp_dir)
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
