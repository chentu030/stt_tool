"use client";

import { useEffect, useImperativeHandle, forwardRef, useState } from "react";
import {
  CHECKIN_TEMPLATES,
  MOODS,
  MoodId,
  promptForDate,
} from "@/lib/journalMeta";
import AiMarkdown from "@/components/AiMarkdown";

export type JournalComposerHandle = {
  save: () => void;
  isDirty: () => boolean;
};

type Props = {
  dateKey: string;
  initialText?: string;
  mood?: MoodId;
  energy?: number;
  busy?: boolean;
  onSave: (payload: { text: string; mood?: MoodId; energy?: number; appendTemplate?: string }) => void;
  onOpenFull: () => void;
  onDirtyChange?: (dirty: boolean) => void;
};

const JournalComposer = forwardRef<JournalComposerHandle, Props>(function JournalComposer(
  {
    dateKey,
    initialText = "",
    mood,
    energy = 3,
    busy,
    onSave,
    onOpenFull,
    onDirtyChange,
  },
  ref
) {
  const [text, setText] = useState(initialText);
  const [m, setM] = useState<MoodId | undefined>(mood);
  const [e, setE] = useState(energy);
  const [mode, setMode] = useState<"preview" | "edit">(initialText.trim() ? "preview" : "edit");
  const prompt = promptForDate(dateKey);

  const dirty =
    text !== initialText || m !== mood || e !== (energy || 3);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useImperativeHandle(
    ref,
    () => ({
      save: () => onSave({ text, mood: m, energy: e }),
      isDirty: () => dirty,
    }),
    [text, m, e, dirty, onSave]
  );

  return (
    <div className="jn-composer">
      <div className="jn-composer-top">
        <div>
          <h2 className="font-display">{dateKey}</h2>
          <p className="jn-prompt">今日提問：{prompt}</p>
        </div>
        <div className="jn-composer-top-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setMode((x) => (x === "preview" ? "edit" : "preview"))}
            title={mode === "preview" ? "編輯 Markdown 原文" : "預覽 Markdown / LaTeX"}
          >
            {mode === "preview" ? "編輯原文" : "預覽"}
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenFull}>
            完整編輯
          </button>
        </div>
      </div>

      <div className="jn-mood-row">
        <span>情緒</span>
        <div className="jn-moods">
          {MOODS.map((x) => (
            <button
              key={x.id}
              type="button"
              className={`jn-mood${m === x.id ? " is-on" : ""}`}
              style={{ ["--mood" as string]: x.color }}
              onClick={() => setM(x.id)}
            >
              {x.label}
            </button>
          ))}
        </div>
      </div>

      <div className="jn-energy-row">
        <span>能量 {e}/5</span>
        <input
          type="range"
          min={1}
          max={5}
          value={e}
          onChange={(ev) => setE(Number(ev.target.value))}
        />
      </div>

      <div className="jn-checkins">
        {CHECKIN_TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            className="jn-chip"
            disabled={busy}
            onClick={() => onSave({ text, mood: m, energy: e, appendTemplate: t.body })}
          >
            + {t.label}
          </button>
        ))}
        <button
          type="button"
          className="jn-chip"
          onClick={() => {
            setMode("edit");
            setText((prev) => `${prev.trim()}${prev.trim() ? "\n\n" : ""}## 提問回應\n${prompt}\n\n`);
          }}
        >
          插入今日提問
        </button>
      </div>

      {mode === "preview" ? (
        <button
          type="button"
          className="jn-preview"
          onClick={() => setMode("edit")}
          title="點擊編輯原文"
        >
          {text.trim() ? (
            <AiMarkdown text={text} className="jn-preview-md" />
          ) : (
            <p className="jn-preview-empty">還沒有內容 · 點此開始寫</p>
          )}
        </button>
      ) : (
        <textarea
          className="input jn-textarea"
          rows={10}
          placeholder="寫下今天的節奏、卡住的地方、或一句話就好…（支援 Markdown / LaTeX）"
          value={text}
          autoFocus
          onChange={(ev) => setText(ev.target.value)}
          onKeyDown={(ev) => {
            if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "s") {
              ev.preventDefault();
              onSave({ text, mood: m, energy: e });
            }
          }}
          onBlur={() => {
            if (text.trim()) setMode("preview");
          }}
        />
      )}

      <div className="jn-composer-actions">
        <button
          type="button"
          className="btn"
          disabled={busy || (!text.trim() && !m)}
          title="儲存 ⌘S"
          onClick={() => onSave({ text, mood: m, energy: e })}
        >
          {busy ? "儲存中…" : dirty ? "儲存這天 *" : "儲存這天"}
        </button>
        <button
          type="button"
          className="btn btn-soft"
          disabled={busy}
          onClick={() =>
            onSave({ text: `${text.trim()}\n\n> ${prompt}\n\n`, mood: m, energy: e })
          }
        >
          用提問起筆並儲存
        </button>
      </div>
    </div>
  );
});

export default JournalComposer;
