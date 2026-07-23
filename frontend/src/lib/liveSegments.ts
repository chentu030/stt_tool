/** Live recording segment timeline (sidebar) — kept out of note body. */

export type LiveSegment = {
  id: string;
  /** Display label, e.g. 段落 3 or 00:15 */
  label: string;
  startSec: number;
  endSec: number;
  text: string;
  audioUrl?: string;
  createdAt: number;
};

export const LIVE_SEGMENTS_PROP = "live_segments";

export function formatSegClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

export function liveSegmentsFromProps(props: Record<string, unknown> | undefined | null): LiveSegment[] {
  const raw = props?.[LIVE_SEGMENTS_PROP];
  if (!Array.isArray(raw)) return [];
  const out: LiveSegment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : "";
    if (!id) continue;
    out.push({
      id,
      label: typeof o.label === "string" ? o.label : "段落",
      startSec: typeof o.startSec === "number" ? o.startSec : 0,
      endSec: typeof o.endSec === "number" ? o.endSec : 0,
      text: typeof o.text === "string" ? o.text : "",
      audioUrl: typeof o.audioUrl === "string" ? o.audioUrl : undefined,
      createdAt: typeof o.createdAt === "number" ? o.createdAt : Date.now(),
    });
  }
  return out;
}

export function previewSegmentText(text: string, max = 48): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return "（無文字）";
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

/**
 * Detect interleaved 逐段逐字稿 toggles + following audio in body,
 * extract into segments and strip from markdown.
 */
export function migrateInterleavedTranscriptFromBody(body: string): {
  body: string;
  segments: LiveSegment[];
  changed: boolean;
} {
  const src = body || "";
  const segments: LiveSegment[] = [];
  // :::toggle 逐段逐字稿\n...\n:::\n<audio ... src="..." ...>
  const re =
    /\n*:::toggle\s*逐段逐字稿\s*\n([\s\S]*?)\n:::\s*\n*(<audio\b[^>]*\bsrc="([^"]+)"[^>]*>\s*<\/audio>)/gi;
  let m: RegExpExecArray | null;
  let idx = 0;
  while ((m = re.exec(src))) {
    idx += 1;
    const inner = (m[1] || "").trim();
    const audioUrl = (m[3] || "").trim();
    const lines = inner.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    // Often first line is a time stamp
    let label = `段落 ${idx}`;
    let text = inner;
    if (lines.length >= 2 && /^\d{1,2}:\d{2}/.test(lines[0])) {
      label = lines[0];
      text = lines.slice(1).join("\n");
    }
    segments.push({
      id: `migrated-${idx}-${Date.now().toString(36)}`,
      label,
      startSec: 0,
      endSec: 0,
      text,
      audioUrl: audioUrl || undefined,
      createdAt: Date.now(),
    });
  }
  if (!segments.length) {
    return { body: src, segments: [], changed: false };
  }
  const next = src.replace(re, "\n").replace(/\n{3,}/g, "\n\n").trimEnd() + (src.endsWith("\n") ? "\n" : "");
  return { body: next, segments, changed: true };
}

/** Final note-body block written once at end of a live session. */
export function buildLiveSessionBodyMd(opts: {
  audioUrl?: string;
  audioTitle?: string;
  fullTranscript?: string;
  aiOrganize?: string;
}): string {
  const parts: string[] = ["\n\n---\n\n### 整段錄音\n"];
  if (opts.audioUrl) {
    const title = opts.audioTitle || "完整錄音";
    parts.push(
      `<audio class="rich-audio" data-note-audio="1" controls preload="metadata" src="${opts.audioUrl}" title="${title}"></audio>\n`
    );
  }
  const tx = (opts.fullTranscript || "").trim();
  if (tx) {
    parts.push(`\n:::toggle 整段逐字稿\n${tx}\n:::\n`);
  }
  const org = (opts.aiOrganize || "").trim();
  if (org) {
    parts.push(`\n## AI 整理\n\n${org}\n`);
  }
  return parts.join("");
}
