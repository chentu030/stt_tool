/**
 * Per-note writing goals stored on note.props.writing_goal
 */

import { computeNoteStats, type NoteStats } from "@/lib/noteMeta";
import {
  bodyForExport,
  noteIsSourceMaterial,
} from "@/lib/writingMaterial";

export const WRITING_GOAL_PROP = "writing_goal";

export type WritingGoal = {
  /** Minimum word target */
  minWords?: number;
  /** Soft maximum (warn when over) */
  maxWords?: number;
  /** Optional daily word quota for this note */
  dailyQuota?: number;
  /** ISO date YYYY-MM-DD */
  deadline?: string;
};

export type WritingGoalProgress = {
  goal: WritingGoal;
  stats: NoteStats;
  /** Words counting toward goals (素材 excluded) */
  words: number;
  minProgress: number | null; // 0–1+ when minWords set
  maxOver: boolean;
  dailyProgress: number | null;
  deadlineLabel: string | null;
  deadlinePassed: boolean;
  summary: string;
};

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.floor(v);
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return undefined;
}

export function parseWritingGoal(
  props?: Record<string, unknown> | null
): WritingGoal | null {
  const raw = props?.[WRITING_GOAL_PROP];
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const goal: WritingGoal = {
    minWords: num(o.minWords ?? o.min_words),
    maxWords: num(o.maxWords ?? o.max_words),
    dailyQuota: num(o.dailyQuota ?? o.daily_quota),
    deadline:
      typeof o.deadline === "string" && /^\d{4}-\d{2}-\d{2}/.test(o.deadline)
        ? o.deadline.slice(0, 10)
        : undefined,
  };
  if (!goal.minWords && !goal.maxWords && !goal.dailyQuota && !goal.deadline) {
    return null;
  }
  return goal;
}

export function withWritingGoal(
  props: Record<string, unknown> | undefined,
  goal: WritingGoal | null
): Record<string, unknown> {
  const next = { ...(props || {}) };
  if (!goal) {
    delete next[WRITING_GOAL_PROP];
    return next;
  }
  const cleaned: WritingGoal = {};
  if (goal.minWords) cleaned.minWords = goal.minWords;
  if (goal.maxWords) cleaned.maxWords = goal.maxWords;
  if (goal.dailyQuota) cleaned.dailyQuota = goal.dailyQuota;
  if (goal.deadline) cleaned.deadline = goal.deadline;
  if (!cleaned.minWords && !cleaned.maxWords && !cleaned.dailyQuota && !cleaned.deadline) {
    delete next[WRITING_GOAL_PROP];
    return next;
  }
  next[WRITING_GOAL_PROP] = cleaned;
  return next;
}

export function computeWritingGoalProgress(
  bodyMd: string,
  props?: Record<string, unknown> | null
): WritingGoalProgress | null {
  const goal = parseWritingGoal(props);
  if (!goal) return null;
  const whole = noteIsSourceMaterial(props);
  const countable = bodyForExport(bodyMd, {
    includeSource: false,
    wholeNoteIsSource: whole,
  });
  const stats = computeNoteStats(countable);
  const words = stats.words;
  const minProgress =
    goal.minWords && goal.minWords > 0
      ? Math.min(2, words / goal.minWords)
      : null;
  const maxOver = !!(goal.maxWords && words > goal.maxWords);
  const dailyProgress =
    goal.dailyQuota && goal.dailyQuota > 0
      ? Math.min(2, words / goal.dailyQuota)
      : null;
  let deadlineLabel: string | null = null;
  let deadlinePassed = false;
  if (goal.deadline) {
    const d = new Date(`${goal.deadline}T23:59:59`);
    if (!Number.isNaN(d.getTime())) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const end = new Date(d);
      end.setHours(0, 0, 0, 0);
      const diff = Math.ceil((end.getTime() - today.getTime()) / 86400000);
      if (diff < 0) {
        deadlinePassed = true;
        deadlineLabel = `已逾期 ${Math.abs(diff)} 天`;
      } else if (diff === 0) {
        deadlineLabel = "今天截止";
      } else {
        deadlineLabel = `剩 ${diff} 天`;
      }
    }
  }
  const parts: string[] = [];
  if (goal.minWords) parts.push(`${words}/${goal.minWords} 字`);
  else if (goal.dailyQuota) parts.push(`${words}/${goal.dailyQuota} 字（今日）`);
  else parts.push(`${words} 字`);
  if (goal.maxWords) parts.push(`上限 ${goal.maxWords}`);
  if (deadlineLabel) parts.push(deadlineLabel);

  return {
    goal,
    stats,
    words,
    minProgress,
    maxOver,
    dailyProgress,
    deadlineLabel,
    deadlinePassed,
    summary: parts.join(" · "),
  };
}
