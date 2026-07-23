/** Home「今日節奏」三步 — local only, resets each calendar day. */

export type DailyRhythmStep = "capture" | "open" | "organize";

export type DailyRhythmState = {
  date: string;
  capture: boolean;
  open: boolean;
  organize: boolean;
};

const KEY = "cadence_daily_rhythm_v1";

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function readDailyRhythm(): DailyRhythmState {
  const date = todayKey();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { date, capture: false, open: false, organize: false };
    const p = JSON.parse(raw) as Partial<DailyRhythmState>;
    if (p.date !== date) return { date, capture: false, open: false, organize: false };
    return {
      date,
      capture: !!p.capture,
      open: !!p.open,
      organize: !!p.organize,
    };
  } catch {
    return { date, capture: false, open: false, organize: false };
  }
}

export function markDailyRhythmStep(step: DailyRhythmStep): DailyRhythmState {
  const cur = readDailyRhythm();
  const next = { ...cur, [step]: true };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("cadence-daily-rhythm", { detail: next }));
  }
  return next;
}
