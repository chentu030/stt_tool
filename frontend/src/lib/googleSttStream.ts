/** Browser → WebSocket → Google StreamingRecognize (interim + final). */

function apiBase(): string {
  const raw = (process.env.NEXT_PUBLIC_API_BASE || "").trim();
  if (raw) return raw.replace(/^http:\/\//i, "https://").replace(/\/$/, "");
  return "http://localhost:8000/api";
}

export function googleSttStreamUrl(): string {
  const base = apiBase();
  if (base.startsWith("https://")) return `${base.replace(/^https/, "wss")}/stt/google/stream`;
  if (base.startsWith("http://")) return `${base.replace(/^http/, "ws")}/stt/google/stream`;
  return `ws://localhost:8000/api/stt/google/stream`;
}

function floatTo16BitPCM(input: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(input.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

/** Downsample Float32 mono to 16 kHz. */
function downsample(buffer: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return buffer;
  if (fromRate < toRate) return buffer;
  const ratio = fromRate / toRate;
  const newLen = Math.floor(buffer.length / ratio);
  const result = new Float32Array(newLen);
  for (let i = 0; i < newLen; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.floor((i + 1) * ratio);
    let sum = 0;
    let count = 0;
    for (let j = start; j < end && j < buffer.length; j++) {
      sum += buffer[j];
      count++;
    }
    result[i] = count ? sum / count : 0;
  }
  return result;
}

export type StreamSttEvent =
  | { type: "ready"; engine?: string; model?: string; language?: string; location?: string }
  | { type: "interim"; text: string; stability?: number }
  | { type: "final"; text: string; stability?: number }
  | { type: "info"; message: string }
  | { type: "error"; message: string }
  | { type: "closed" };

type StreamHandlers = {
  onEvent: (ev: StreamSttEvent) => void;
  language?: string;
};

/**
 * Capture mic as PCM s16le @ 16kHz and stream to backend Google STT.
 * Keeps its own MediaStream; call stop() to end.
 * Auto-reconnects before Google's ~5 min stream limit.
 */
export class GoogleLiveSttSession {
  private ws: WebSocket | null = null;
  private ctx: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private ownsMic = true;
  private mute = false;
  private stopped = false;
  private handlers: StreamHandlers;
  private restartTimer: number | null = null;

  constructor(handlers: StreamHandlers) {
    this.handlers = handlers;
  }

  async start(opts?: { language?: string; stream?: MediaStream; ownStream?: boolean }): Promise<void> {
    this.stopped = false;
    this.handlers = { ...this.handlers, language: opts?.language || this.handlers.language };
    if (opts?.stream) {
      this.stream = opts.stream;
      this.ownsMic = opts.ownStream !== true;
    } else {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      this.ownsMic = true;
    }
    await this.openAudioGraph();
    try {
      await this.openSocket();
    } catch (e) {
      await this.teardownAudioGraph();
      throw e;
    }
    // Restart stream under 5-minute Google limit
    this.restartTimer = window.setInterval(() => {
      if (this.stopped) return;
      void this.reopenSocket();
    }, 4 * 60 * 1000);
  }

  /** Temporarily pause sending (e.g. while swapping recorders) — uncommon. */
  setMuted(v: boolean) {
    this.mute = v;
  }

  private intentionalClose = false;

  private async openAudioGraph() {
    if (!this.stream) throw new Error("沒有音訊串流");
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    if (this.ctx.state === "suspended") await this.ctx.resume();

    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.processor = this.ctx.createScriptProcessor(4096, 1, 1);
    const fromRate = this.ctx.sampleRate;
    this.processor.onaudioprocess = (ev) => {
      if (this.stopped || this.mute || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const input = ev.inputBuffer.getChannelData(0);
      const down = downsample(input, fromRate, 16000);
      const pcm = floatTo16BitPCM(down);
      try {
        this.ws.send(pcm);
      } catch {
        /* ignore transient */
      }
    };
    this.source.connect(this.processor);
    const silent = this.ctx.createGain();
    silent.gain.value = 0;
    this.processor.connect(silent);
    silent.connect(this.ctx.destination);
  }

  private async teardownAudioGraph() {
    try {
      this.processor?.disconnect();
      this.source?.disconnect();
    } catch {
      /* ignore */
    }
    this.processor = null;
    this.source = null;
    try {
      await this.ctx?.close();
    } catch {
      /* ignore */
    }
    this.ctx = null;
  }

  private async openSocket(): Promise<void> {
    const url = googleSttStreamUrl();
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.binaryType = "arraybuffer";
      const t = window.setTimeout(() => reject(new Error("STT 串流連線逾時")), 12000);
      ws.onopen = () => {
        window.clearTimeout(t);
        ws.send(JSON.stringify({ language: this.handlers.language || "zh-TW", engine: "v2" }));
        resolve();
      };
      ws.onerror = () => {
        window.clearTimeout(t);
        reject(new Error("STT 串流連線失敗"));
      };
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(String(ev.data)) as StreamSttEvent;
          this.handlers.onEvent(data);
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => {
        if (this.stopped || this.intentionalClose) return;
        this.handlers.onEvent({ type: "info", message: "串流中斷，嘗試重連…" });
        void this.reopenSocket().catch((e) => {
          this.handlers.onEvent({
            type: "error",
            message: e instanceof Error ? e.message : "串流重連失敗",
          });
        });
      };
    });
  }

  private async reopenSocket(): Promise<void> {
    const old = this.ws;
    this.ws = null;
    this.intentionalClose = true;
    try {
      old?.send(JSON.stringify({ type: "end" }));
    } catch {
      /* ignore */
    }
    try {
      old?.close();
    } catch {
      /* ignore */
    }
    this.intentionalClose = false;
    if (this.stopped) return;
    await this.openSocket();
    this.handlers.onEvent({ type: "info", message: "串流已續接（約每 4 分鐘續約）" });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.restartTimer) {
      window.clearInterval(this.restartTimer);
      this.restartTimer = null;
    }
    try {
      this.ws?.send(JSON.stringify({ type: "end" }));
    } catch {
      /* ignore */
    }
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
    await this.teardownAudioGraph();
    if (this.ownsMic) {
      this.stream?.getTracks().forEach((t) => t.stop());
    }
    this.stream = null;
  }
}
