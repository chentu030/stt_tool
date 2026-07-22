/** Continuous mic / system-audio capture with rotatable segments (live session) + simple one-shot recorder. */

export type VoiceMime = { mimeType: string; ext: string };

/** mic = 麥克風；system = 分頁／視窗裝置聲音；both = 兩者混音 */
export type LiveAudioSource = "mic" | "system" | "both";

export function liveAudioSourceLabel(source: LiveAudioSource): string {
  if (source === "system") return "裝置聲音";
  if (source === "both") return "麥克風 + 裝置";
  return "麥克風";
}

export function liveAudioSourceHint(source: LiveAudioSource): string {
  if (source === "system") return "線上課程、Drive 播放等分頁／視窗音訊";
  if (source === "both") return "同時錄麥克風與裝置聲音";
  return "錄外部／環境與人聲";
}

export type AcquiredLiveAudio = {
  stream: MediaStream;
  release: () => void;
};

/**
 * Acquire a MediaStream for live recording.
 * System audio uses getDisplayMedia — Chrome: share a tab/window and enable “share audio”.
 */
export async function acquireLiveAudioStream(
  source: LiveAudioSource
): Promise<AcquiredLiveAudio> {
  const owned: MediaStream[] = [];
  let mixCtx: AudioContext | null = null;

  const releaseAll = () => {
    owned.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    owned.length = 0;
    if (mixCtx) {
      void mixCtx.close().catch(() => {});
      mixCtx = null;
    }
  };

  try {
    if (source === "mic") {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      owned.push(mic);
      return {
        stream: mic,
        release: () => {
          mic.getTracks().forEach((t) => t.stop());
        },
      };
    }

    if (typeof navigator.mediaDevices?.getDisplayMedia !== "function") {
      throw new Error("此瀏覽器不支援裝置聲音擷取，請改用麥克風或改用 Chrome／Edge");
    }

    const display = await navigator.mediaDevices.getDisplayMedia({
      // Video is required by Chromium to offer tab/window audio; we discard it.
      video: { frameRate: 1, width: { ideal: 16 }, height: { ideal: 16 } },
      audio: true,
    });
    owned.push(display);
    display.getVideoTracks().forEach((t) => {
      t.stop();
      try {
        display.removeTrack(t);
      } catch {
        /* ignore */
      }
    });
    if (!display.getAudioTracks().length) {
      releaseAll();
      throw new Error("未取得裝置聲音。請選擇「分頁」或「視窗」，並勾選分享音訊。");
    }

    if (source === "system") {
      return {
        stream: display,
        release: () => {
          display.getTracks().forEach((t) => t.stop());
        },
      };
    }

    const mic = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    owned.push(mic);

    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    mixCtx = new Ctx();
    const dest = mixCtx.createMediaStreamDestination();
    mixCtx.createMediaStreamSource(display).connect(dest);
    mixCtx.createMediaStreamSource(mic).connect(dest);
    const ctx = mixCtx;
    return {
      stream: dest.stream,
      release: () => {
        mic.getTracks().forEach((t) => t.stop());
        display.getTracks().forEach((t) => t.stop());
        void ctx.close().catch(() => {});
      },
    };
  } catch (e) {
    releaseAll();
    throw e;
  }
}

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
  private releaseExtra: (() => void) | null = null;
  private fullRec: MediaRecorder | null = null;
  private segRec: MediaRecorder | null = null;
  private fullChunks: Blob[] = [];
  private segChunks: Blob[] = [];
  private mime: VoiceMime = pickRecorderMime();
  private rotating = false;

  async start(existingStream?: MediaStream, releaseExtra?: () => void): Promise<void> {
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
    this.releaseExtra = releaseExtra || null;
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
    try {
      this.releaseExtra?.();
    } catch {
      /* ignore */
    }
    this.releaseExtra = null;
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
