"use client";

import { useState } from "react";
import {
  CHECKIN_TEMPLATES,
  MOODS,
  MoodId,
  promptForDate,
} from "@/lib/journalMeta";

type Props = {
  dateKey: string;
  initialText?: string;
  mood?: MoodId;
  energy?: number;
  busy?: boolean;
  onSave: (payload: { text: string; mood?: MoodId; energy?: number; appendTemplate?: string }) => void;
  onOpenFull: () => void;
};

export default function JournalComposer({
  dateKey,
  initialText = "",
  mood,
  energy = 3,
  busy,
  onSave,
  onOpenFull,
}: Props) {
  const [text, setText] = useState(initialText);
  const [m, setM] = useState<MoodId | undefined>(mood);
  const [e, setE] = useState(energy);
  const prompt = promptForDate(dateKey);

  return (
    <div className="jn-composer">
      <div className="jn-composer-top">
        <div>
          <h2 className="font-display">{dateKey}</h2>
          <p className="jn-prompt">今日提問：{prompt}</p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenFull}>
          完整編輯
        </button>
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
          onClick={() => setText((prev) => `${prev.trim()}${prev.trim() ? "\n\n" : ""}## 提問回應\n${prompt}\n\n`)}
        >
          插入今日提問
        </button>
      </div>

      <textarea
        className="input jn-textarea"
        rows={10}
        placeholder="寫下今天的節奏、卡住的地方、或一句話就好…"
        value={text}
        onChange={(ev) => setText(ev.target.value)}
      />

      <div className="jn-composer-actions">
        <button
          type="button"
          className="btn"
          disabled={busy || (!text.trim() && !m)}
          onClick={() => onSave({ text, mood: m, energy: e })}
        >
          {busy ? "儲存中…" : "儲存這天"}
        </button>
        <button
          type="button"
          className="btn btn-soft"
          disabled={busy}
          onClick={() => onSave({ text: `${text.trim()}\n\n> ${prompt}\n\n`, mood: m, energy: e })}
        >
          用提問起筆並儲存
        </button>
      </div>
    </div>
  );
}
