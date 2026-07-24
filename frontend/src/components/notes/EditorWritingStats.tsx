"use client";

import { useMemo, useState } from "react";
import type { NoteStats } from "@/lib/noteMeta";
import type { WritingGoalProgress } from "@/lib/writingGoals";

type StatMode = "words" | "chars" | "reading";

type Props = {
  stats: NoteStats;
  goalProgress?: WritingGoalProgress | null;
  className?: string;
};

export default function EditorWritingStats({ stats, goalProgress, className }: Props) {
  const [mode, setMode] = useState<StatMode>("words");

  const label = useMemo(() => {
    if (mode === "chars") return `${stats.chars.toLocaleString()} 字元`;
    if (mode === "reading")
      return stats.readingMins > 0 ? `約 ${stats.readingMins} 分` : "—";
    return `${stats.words.toLocaleString()} 字`;
  }, [mode, stats]);

  const cycle = () => {
    setMode((m) => (m === "words" ? "chars" : m === "chars" ? "reading" : "words"));
  };

  const barPct = (() => {
    if (!goalProgress) return null;
    const g = goalProgress.goal;
    if (g.minWords && goalProgress.minProgress != null) {
      return Math.min(100, Math.round(goalProgress.minProgress * 100));
    }
    if (g.dailyQuota && goalProgress.dailyProgress != null) {
      return Math.min(100, Math.round(goalProgress.dailyProgress * 100));
    }
    if (g.maxWords && g.maxWords > 0) {
      return Math.min(100, Math.round((goalProgress.words / g.maxWords) * 100));
    }
    return null;
  })();

  return (
    <button
      type="button"
      className={`editor-writing-stats${className ? ` ${className}` : ""}${
        goalProgress?.maxOver || goalProgress?.deadlinePassed ? " is-warn" : ""
      }`}
      onClick={cycle}
      title="點擊切換：字數／字元／閱讀時間"
      aria-label={`寫作統計：${label}${goalProgress ? `，目標 ${goalProgress.summary}` : ""}`}
    >
      <span className="editor-writing-stats-main">{label}</span>
      {goalProgress ? (
        <span className="editor-writing-stats-goal">
          {barPct != null ? (
            <span className="editor-writing-stats-bar" aria-hidden>
              <i style={{ width: `${barPct}%` }} />
            </span>
          ) : null}
          <span className="editor-writing-stats-goal-text">
            {goalProgress.goal.minWords
              ? `${goalProgress.words}/${goalProgress.goal.minWords}`
              : goalProgress.goal.dailyQuota
                ? `${goalProgress.words}/${goalProgress.goal.dailyQuota}`
                : goalProgress.summary}
          </span>
        </span>
      ) : null}
    </button>
  );
}
