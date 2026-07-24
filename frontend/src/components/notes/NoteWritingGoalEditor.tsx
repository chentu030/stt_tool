"use client";

import {
  parseWritingGoal,
  withWritingGoal,
  type WritingGoal,
} from "@/lib/writingGoals";
import {
  SOURCE_MATERIAL_PROP,
  noteIsSourceMaterial,
} from "@/lib/writingMaterial";

type Props = {
  propsBag: Record<string, unknown> | undefined;
  onPropsPatch: (props: Record<string, unknown>) => void;
  readOnly?: boolean;
  /** Compact layout for aside */
  compact?: boolean;
};

function fieldNum(v: number | undefined): string {
  return v && v > 0 ? String(v) : "";
}

export default function NoteWritingGoalEditor({
  propsBag,
  onPropsPatch,
  readOnly,
  compact,
}: Props) {
  const goal = parseWritingGoal(propsBag);
  const isSource = noteIsSourceMaterial(propsBag);

  const patchGoal = (patch: Partial<WritingGoal> | null) => {
    if (readOnly) return;
    if (patch === null) {
      onPropsPatch(withWritingGoal(propsBag, null));
      return;
    }
    const next: WritingGoal = { ...(goal || {}) };
    if ("minWords" in patch) next.minWords = patch.minWords;
    if ("maxWords" in patch) next.maxWords = patch.maxWords;
    if ("dailyQuota" in patch) next.dailyQuota = patch.dailyQuota;
    if ("deadline" in patch) next.deadline = patch.deadline;
    onPropsPatch(withWritingGoal(propsBag, next));
  };

  const setSource = (on: boolean) => {
    if (readOnly) return;
    const next = { ...(propsBag || {}) };
    if (on) next[SOURCE_MATERIAL_PROP] = true;
    else delete next[SOURCE_MATERIAL_PROP];
    onPropsPatch(next);
  };

  return (
    <section
      className={`note-writing-goal${compact ? " is-compact" : ""}`}
      aria-label="寫作目標"
    >
      <div className="note-writing-goal-head">
        <strong>寫作目標</strong>
        {!readOnly && goal ? (
          <button type="button" className="doc-cmd" onClick={() => patchGoal(null)}>
            清除
          </button>
        ) : null}
      </div>
      <p className="note-writing-goal-hint">
        字數預設不含素材區塊。可用 /素材 標記區塊。
      </p>
      <div className="note-writing-goal-grid">
        <label>
          <span>最少字數</span>
          <input
            type="number"
            min={0}
            inputMode="numeric"
            disabled={readOnly}
            value={fieldNum(goal?.minWords)}
            placeholder="例如 800"
            onChange={(e) => {
              const n = Number(e.target.value);
              patchGoal({ minWords: Number.isFinite(n) && n > 0 ? n : undefined });
            }}
          />
        </label>
        <label>
          <span>最多字數</span>
          <input
            type="number"
            min={0}
            inputMode="numeric"
            disabled={readOnly}
            value={fieldNum(goal?.maxWords)}
            placeholder="選填"
            onChange={(e) => {
              const n = Number(e.target.value);
              patchGoal({ maxWords: Number.isFinite(n) && n > 0 ? n : undefined });
            }}
          />
        </label>
        <label>
          <span>每日配額</span>
          <input
            type="number"
            min={0}
            inputMode="numeric"
            disabled={readOnly}
            value={fieldNum(goal?.dailyQuota)}
            placeholder="選填"
            onChange={(e) => {
              const n = Number(e.target.value);
              patchGoal({ dailyQuota: Number.isFinite(n) && n > 0 ? n : undefined });
            }}
          />
        </label>
        <label>
          <span>截止日期</span>
          <input
            type="date"
            disabled={readOnly}
            value={goal?.deadline || ""}
            onChange={(e) =>
              patchGoal({ deadline: e.target.value.trim() || undefined })
            }
          />
        </label>
      </div>
      <label className="note-writing-goal-source">
        <input
          type="checkbox"
          checked={isSource}
          disabled={readOnly}
          onChange={(e) => setSource(e.target.checked)}
        />
        整篇標為素材（預設不計入字數／匯出）
      </label>
    </section>
  );
}
