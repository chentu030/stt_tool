/** Continuous mic capture with rotatable segments (live session) + simple one-shot recorder. */

export type VoiceMime = { mimeType: string; ext: string };

export function pickRecorderMime(): VoiceMime {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
  ];
  for (const mimeType of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mimeType)) {
      const ext = mimeType.includes("mp4") ? "m4a" : "webm";
      return { mimeType, ext };
    }
  }
  return { mimeType: "", ext: "webm" };
}

export function formatRecClock(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export class ContinuousDualRecorder {
  private media: MediaStream | null = null;
  private ownsStream = true;
  private fullRec: MediaRecorder | null = null;
  private segRec: MediaRecorder | null = null;
  private fullChunks: Blob[] = [];
  private segChunks: Blob[] = [];
  private mime: VoiceMime = pickRecorderMime();
  private rotating = false;

  async start(existingStream?: MediaStream): Promise<void> {
    this.media =
      existingStream ||
      (await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      }));
    this.ownsStream = !existingStream;
    this.mime = pickRecorderMime();
    const opts = this.mime.mimeType ? { mimeType: this.mime.mimeType } : undefined;

    this.fullChunks = [];
    this.fullRec = new MediaRecorder(this.media, opts);
    this.fullRec.ondataavailable = (e) => {
      if (e.data.size) this.fullChunks.push(e.data);
    };
    this.fullRec.start(1000);

    this.segChunks = [];
    this.segRec = new MediaRecorder(this.media, opts);
    this.segRec.ondataavailable = (e) => {
      if (e.data.size) this.segChunks.push(e.data);
    };
    this.segRec.start(1000);
  }

  get mediaStream(): MediaStream | null {
    return this.media;
  }

  get extension(): string {
    return this.mime.ext;
  }

  get contentType(): string {
    return this.mime.mimeType || "audio/webm";
  }

  /** Stop current segment, return blob, immediately start the next segment (recording continues). */
  async rotateSegment(): Promise<Blob | null> {
    if (!this.media || !this.segRec || this.rotating) return null;
    if (this.segRec.state === "inactive") return null;
    this.rotating = true;
    try {
      const blob = await this.stopRecorder(this.segRec, this.segChunks);
      this.segChunks = [];
      const opts = this.mime.mimeType ? { mimeType: this.mime.mimeType } : undefined;
      this.segRec = new MediaRecorder(this.media, opts);
      this.segRec.ondataavailable = (e) => {
        if (e.data.size) this.segChunks.push(e.data);
      };
      this.segRec.start(1000);
      if (!blob || blob.size < 800) return null;
      return blob;
    } finally {
      this.rotating = false;
    }
  }

  async stopAll(): Promise<{ full: Blob | null; lastSegment: Blob | null }> {
    let lastSegment: Blob | null = null;
    if (this.segRec && this.segRec.state !== "inactive") {
      lastSegment = await this.stopRecorder(this.segRec, this.segChunks);
      if (lastSegment && lastSegment.size < 800) lastSegment = null;
    }
    let full: Blob | null = null;
    if (this.fullRec && this.fullRec.state !== "inactive") {
      full = await this.stopRecorder(this.fullRec, this.fullChunks);
    }
    this.media?.getTracks().forEach((t) => {
      if (this.ownsStream) t.stop();
    });
    this.media = null;
    this.fullRec = null;
    this.segRec = null;
    this.fullChunks = [];
    this.segChunks = [];
    return { full, lastSegment };
  }

  private stopRecorder(rec: MediaRecorder, chunks: Blob[]): Promise<Blob> {
    return new Promise((resolve) => {
      const type = this.mime.mimeType || "audio/webm";
      rec.onstop = () => {
        resolve(new Blob(chunks.slice(), { type }));
      };
      try {
        if (rec.state === "recording") rec.requestData();
      } catch {
        /* ignore */
      }
      rec.stop();
    });
  }
}

export class SimpleVoiceRecorder {
  private stream: MediaStream | null = null;
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private mime: VoiceMime = pickRecorderMime();

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.mime = pickRecorderMime();
    const opts = this.mime.mimeType ? { mimeType: this.mime.mimeType } : undefined;
    this.chunks = [];
    this.rec = new MediaRecorder(this.stream, opts);
    this.rec.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    this.rec.start(250);
  }

  get extension(): string {
    return this.mime.ext;
  }

  async stop(): Promise<Blob | null> {
    if (!this.rec) return null;
    const blob = await new Promise<Blob>((resolve) => {
      const type = this.mime.mimeType || "audio/webm";
      this.rec!.onstop = () => resolve(new Blob(this.chunks.slice(), { type }));
      try {
        if (this.rec!.state === "recording") this.rec!.requestData();
      } catch {
        /* ignore */
      }
      this.rec!.stop();
    });
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.rec = null;
    this.chunks = [];
    return blob.size >= 400 ? blob : null;
  }
}
