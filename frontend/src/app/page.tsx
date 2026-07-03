"use client";

import { useState, useRef } from "react";
import ThemeToggle from "@/components/ThemeToggle";

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [cookiesFile, setCookiesFile] = useState<File | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cookiesInputRef = useRef<HTMLInputElement>(null);

  const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000/api/transcribe";

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setFile(e.dataTransfer.files[0]);
      setYoutubeUrl("");
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setYoutubeUrl("");
    }
  };

  const onUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleTranscribe = async () => {
    if (!file && !youtubeUrl) {
      setError("Please upload a file or provide a YouTube URL.");
      return;
    }

    setIsTranscribing(true);
    setError("");
    setTranscript("");

    try {
      let res;
      if (file) {
        const formData = new FormData();
        formData.append("file", file);
        res = await fetch(`${API_BASE}/upload`, {
          method: "POST",
          body: formData,
        });
      } else {
        // YouTube: always use FormData to support optional cookies file
        const formData = new FormData();
        formData.append("url", youtubeUrl);
        if (cookiesFile) {
          formData.append("cookies", cookiesFile);
        }
        res = await fetch(`${API_BASE}/youtube`, {
          method: "POST",
          body: formData,
        });
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.detail || `Server Error: ${res.status}`);
      }

      const data = await res.json();
      setTranscript(data.transcript);
    } catch (err: any) {
      setError(err.message || "Failed to transcribe audio.");
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleCopy = () => {
    if (transcript) {
      navigator.clipboard.writeText(transcript);
    }
  };

  const handleDownload = () => {
    if (!transcript) return;
    const element = document.createElement("a");
    const fileToDownload = new Blob([transcript], { type: "text/plain" });
    element.href = URL.createObjectURL(fileToDownload);

    let filename = "transcript.txt";
    if (file) {
      filename = file.name.replace(/\.[^/.]+$/, "") + ".txt";
    } else if (youtubeUrl) {
      try {
        const urlObj = new URL(youtubeUrl);
        const v = urlObj.searchParams.get("v");
        if (v) {
          filename = `youtube_${v}.txt`;
        } else {
          filename = "youtube_transcript.txt";
        }
      } catch {
        filename = "youtube_transcript.txt";
      }
    }

    element.download = filename;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  return (
    <>
      <div className="wavy-bg"></div>

      <main className="container">
        {/* Floating Navbar */}
        <nav className="navbar">
          <div className="nav-logo font-display">
            <span className="logo-icon"></span>
            AIVOICE
          </div>
          <div className="nav-menu">
            <ThemeToggle />
          </div>
        </nav>

        {/* Hero Section */}
        <section className="hero">
          <h1 className="font-display">
            Transcribing <span>voice</span>
            <br />
            with the power of AI.
          </h1>
          <p style={{ fontSize: "1.1rem", maxWidth: "600px", margin: "0 auto", color: "var(--text-muted)" }}>
            Upload your audio/video files or paste a YouTube URL to generate accurate, timestamped transcripts powered by Whisper AI.
          </p>
        </section>

        {/* Bento Grid */}
        <section className="bento-grid">
          {/* Card 1: File Upload (Large) */}
          <div className="bento-card col-span-8 card-purple" style={{ display: "flex", flexDirection: "column" }}>
            <h2 className="font-display" style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>
              Upload Media
            </h2>
            <p style={{ color: "rgba(0,0,0,0.6)", marginBottom: "1.5rem" }}>
              Drag and drop your audio or video file here.
            </p>

            <div
              className={`upload-zone ${dragActive ? "active" : ""}`}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={onUploadClick}
              style={{ flex: 1, minHeight: "200px" }}
            >
              <input ref={fileInputRef} type="file" style={{ display: "none" }} accept="audio/*,video/*" onChange={handleChange} />
              <div className="upload-icon-large">
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
              </div>
              <p style={{ fontWeight: 600, fontSize: "1.2rem" }}>{file ? file.name : "Select or drop file"}</p>
              {!file && (
                <p style={{ fontSize: "0.9rem", color: "rgba(0,0,0,0.5)", marginTop: "0.5rem" }}>
                  MP4, MP3, M4A, WAV up to 2GB
                </p>
              )}
            </div>

            {file && (
              <div style={{ marginTop: "1.5rem", textAlign: "right" }}>
                <button className="pill-button" disabled={isTranscribing} onClick={handleTranscribe}>
                  {isTranscribing ? "Processing..." : "Start Transcription"}
                </button>
              </div>
            )}
          </div>

          {/* Card 2: YouTube Input */}
          <div className="bento-card col-span-4 card-yellow" style={{ display: "flex", flexDirection: "column" }}>
            <h2 className="font-display" style={{ fontSize: "1.8rem", marginBottom: "0.5rem" }}>
              Or use YouTube
            </h2>
            <p style={{ color: "rgba(0,0,0,0.6)", marginBottom: "1rem", fontSize: "0.9rem" }}>
              Paste a link to any YouTube video or playlist.
            </p>

            <input
              type="text"
              className="input-minimal"
              placeholder="https://youtube.com/..."
              value={youtubeUrl}
              onChange={(e) => {
                setYoutubeUrl(e.target.value);
                if (e.target.value) setFile(null);
              }}
            />

            {/* Advanced: Cookies Upload */}
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              style={{
                background: "none",
                border: "none",
                color: "rgba(0,0,0,0.5)",
                cursor: "pointer",
                fontSize: "0.8rem",
                marginTop: "0.75rem",
                textAlign: "left",
                fontFamily: "inherit",
              }}
            >
              {showAdvanced ? "▾" : "▸"} Advanced (private/member videos)
            </button>

            {showAdvanced && (
              <div style={{ marginTop: "0.5rem" }}>
                <input
                  ref={cookiesInputRef}
                  type="file"
                  accept=".txt"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      setCookiesFile(e.target.files[0]);
                    }
                  }}
                />
                <button
                  className="pill-button outline"
                  style={{ padding: "0.4rem 0.8rem", fontSize: "0.8rem", width: "100%" }}
                  onClick={() => cookiesInputRef.current?.click()}
                >
                  {cookiesFile ? `✓ ${cookiesFile.name}` : "Upload cookies.txt"}
                </button>
                <p style={{ fontSize: "0.7rem", color: "rgba(0,0,0,0.4)", marginTop: "0.3rem" }}>
                  Export cookies from your browser using a cookies.txt extension.
                </p>
              </div>
            )}

            <div style={{ marginTop: "auto", paddingTop: "1.5rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div className="visualizer">
                <div className="bar"></div>
                <div className="bar"></div>
                <div className="bar"></div>
                <div className="bar"></div>
                <div className="bar"></div>
              </div>
              <button
                className="icon-btn"
                style={{ width: "50px", height: "50px" }}
                disabled={isTranscribing || !youtubeUrl}
                onClick={handleTranscribe}
              >
                {isTranscribing ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" strokeDasharray="31" strokeDashoffset="10">
                      <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite" />
                    </circle>
                  </svg>
                ) : (
                  "▶"
                )}
              </button>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div
              className="col-span-12"
              style={{
                color: "#ef4444",
                padding: "1rem",
                background: "rgba(239, 68, 68, 0.1)",
                borderRadius: "var(--radius-lg)",
                fontSize: "0.95rem",
              }}
            >
              ⚠ {error}
            </div>
          )}

          {/* Card 3: Transcript Output */}
          {(transcript || isTranscribing) && (
            <div className="bento-card col-span-12" style={{ marginTop: "0.5rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
                <h2 className="font-display" style={{ fontSize: "1.8rem" }}>
                  Transcription Result
                </h2>
                {transcript && (
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button className="pill-button outline" style={{ padding: "0.5rem 1rem", fontSize: "0.9rem" }} onClick={handleCopy}>
                      Copy
                    </button>
                    <button className="pill-button" style={{ padding: "0.5rem 1rem", fontSize: "0.9rem" }} onClick={handleDownload}>
                      Download .txt
                    </button>
                  </div>
                )}
              </div>

              {isTranscribing && !transcript ? (
                <div style={{ textAlign: "center", padding: "4rem 0", color: "var(--text-muted)" }}>
                  <div className="visualizer" style={{ justifyContent: "center", marginBottom: "1rem", color: "var(--bg-secondary)" }}>
                    <div className="bar"></div>
                    <div className="bar"></div>
                    <div className="bar"></div>
                    <div className="bar"></div>
                    <div className="bar"></div>
                  </div>
                  <p className="font-display" style={{ fontSize: "1.2rem" }}>
                    Processing audio with Whisper AI...
                  </p>
                  <p style={{ fontSize: "0.9rem", marginTop: "0.5rem" }}>This may take several minutes depending on the file length.</p>
                </div>
              ) : (
                <textarea className="transcript-display" value={transcript} readOnly placeholder="Your timestamped transcript will appear here..." />
              )}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
