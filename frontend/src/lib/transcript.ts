export interface Segment {
  id: string;
  startSec: number;
  endSec: number;
  text: string;
}

const TS_LINE =
  /^\[(\d{1,2}):(\d{2})(?::(\d{2}))?\s*->\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\]\s*(.*)$/;

function parseClock(hOrM: string, mOrS: string, s?: string): number {
  if (s !== undefined) {
    return Number(hOrM) * 3600 + Number(mOrS) * 60 + Number(s);
  }
  return Number(hOrM) * 60 + Number(mOrS);
}

export function formatClock(sec: number, withHours = true): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (withHours || h > 0) return `${pad(h)}:${pad(m)}:${pad(r)}`;
  return `${pad(m)}:${pad(r)}`;
}

export function formatSrtClock(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = Math.floor(s % 60);
  const ms = Math.round((s % 1) * 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(r)},${pad(ms, 3)}`;
}

export function formatVttClock(sec: number): string {
  return formatSrtClock(sec).replace(",", ".");
}

export function parseTranscript(raw: string): Segment[] {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const segs: Segment[] = [];
  let i = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(TS_LINE);
    if (m) {
      const start = parseClock(m[1], m[2], m[3]);
      const end = parseClock(m[4], m[5], m[6]);
      segs.push({
        id: `s${i++}`,
        startSec: start,
        endSec: Math.max(end, start),
        text: (m[7] || "").trim(),
      });
    } else {
      segs.push({
        id: `s${i++}`,
        startSec: segs.length ? segs[segs.length - 1].endSec : 0,
        endSec: (segs.length ? segs[segs.length - 1].endSec : 0) + 5,
        text: trimmed,
      });
    }
  }
  return segs;
}

export function segmentsToTimestampedText(segs: Segment[]): string {
  return segs
    .map((s) => `[${formatClock(s.startSec)} -> ${formatClock(s.endSec)}] ${s.text}`)
    .join("\n");
}

export function segmentsToPlainText(segs: Segment[]): string {
  return segs.map((s) => s.text).filter(Boolean).join("\n");
}

export function toSrt(segs: Segment[]): string {
  return segs
    .filter((s) => s.text.trim())
    .map((s, idx) => {
      return `${idx + 1}\n${formatSrtClock(s.startSec)} --> ${formatSrtClock(s.endSec)}\n${s.text.trim()}\n`;
    })
    .join("\n");
}

export function toVtt(segs: Segment[]): string {
  const body = segs
    .filter((s) => s.text.trim())
    .map((s) => `${formatVttClock(s.startSec)} --> ${formatVttClock(s.endSec)}\n${s.text.trim()}\n`)
    .join("\n");
  return `WEBVTT\n\n${body}`;
}

export function downloadText(filename: string, content: string, mime = "text/plain;charset=utf-8") {
  const el = document.createElement("a");
  el.href = URL.createObjectURL(new Blob([content], { type: mime }));
  el.download = filename;
  document.body.appendChild(el);
  el.click();
  document.body.removeChild(el);
  URL.revokeObjectURL(el.href);
}

export function applyReplace(
  segs: Segment[],
  find: string,
  replace: string,
  all: boolean
): Segment[] {
  if (!find) return segs;
  let done = false;
  return segs.map((s) => {
    if (!all && done) return s;
    if (!s.text.includes(find)) return s;
    if (all) return { ...s, text: s.text.split(find).join(replace) };
    done = true;
    return { ...s, text: s.text.replace(find, replace) };
  });
}
