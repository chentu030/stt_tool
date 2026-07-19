"use client";

import { useMemo, useState } from "react";
import {
  Segment, parseTranscript, segmentsToTimestampedText, segmentsToPlainText,
  toSrt, toVtt, downloadText, applyReplace, formatClock,
} from "@/lib/transcript";

export default function TranscriptEditor({
  initialText,
  filename = "transcript",
  onSave,
}: {
  initialText: string;
  filename?: string;
  onSave?: (text: string) => Promise<void> | void;
}) {
  const [segs, setSegs] = useState<Segment[]>(() => parseTranscript(initialText || ""));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const plainPreview = useMemo(() => segmentsToPlainText(segs), [segs]);

  const updateSeg = (id: string, text: string) => {
    setSegs((prev) => prev.map((s) => (s.id === id ? { ...s, text } : s)));
    setDirty(true);
  };

  const doReplace = (all: boolean) => {
    setSegs((prev) => applyReplace(prev, find, replace, all));
    setDirty(true);
  };

  const save = async () => {
    if (!onSave) return;
    setSaving(true);
    setMsg("");
    try {
      await onSave(segmentsToTimestampedText(segs));
      setDirty(false);
      setMsg("已儲存");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "儲存失敗");
    } finally {
      setSaving(false);
    }
  };

  const base = filename.replace(/\.[^/.]+$/, "") || "transcript";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
        <input className="input" style={{ maxWidth: 160 }} placeholder="尋找…" value={find} onChange={(e) => setFind(e.target.value)} />
        <input className="input" style={{ maxWidth: 160 }} placeholder="取代為…" value={replace} onChange={(e) => setReplace(e.target.value)} />
        <button className="btn btn-ghost btn-sm" onClick={() => doReplace(false)} disabled={!find}>取代</button>
        <button className="btn btn-ghost btn-sm" onClick={() => doReplace(true)} disabled={!find}>全部取代</button>
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-sm" onClick={() => downloadText(`${base}.txt`, segmentsToPlainText(segs))}>TXT</button>
        <button className="btn btn-ghost btn-sm" onClick={() => downloadText(`${base}.srt`, toSrt(segs))}>SRT</button>
        <button className="btn btn-ghost btn-sm" onClick={() => downloadText(`${base}.vtt`, toVtt(segs), "text/vtt")}>VTT</button>
        {onSave && (
          <button className="btn btn-sm" onClick={save} disabled={!dirty || saving}>
            {saving ? "儲存中…" : dirty ? "儲存" : "已儲存"}
          </button>
        )}
      </div>
      {msg && <p style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>{msg}</p>}

      <div className="surface" style={{ maxHeight: "58vh", overflow: "auto", padding: "0.4rem" }}>
        {segs.length === 0 ? (
          <p style={{ color: "var(--text-muted)", padding: "1.5rem", textAlign: "center" }}>尚無逐字稿內容</p>
        ) : (
          segs.map((s) => (
            <div
              key={s.id}
              className={`segment-row ${activeId === s.id ? "active" : ""}`}
              onClick={() => setActiveId(s.id)}
            >
              <button
                type="button"
                className="segment-time"
                style={{ background: "none", border: "none", cursor: "pointer", textAlign: "left" }}
                onClick={() => setActiveId(s.id)}
                title="跳到此段"
              >
                {formatClock(s.startSec)}
              </button>
              <textarea
                className="segment-text"
                value={s.text}
                onChange={(e) => updateSeg(s.id, e.target.value)}
                rows={Math.min(6, Math.max(1, Math.ceil(s.text.length / 42)))}
              />
            </div>
          ))
        )}
      </div>

      <details>
        <summary style={{ cursor: "pointer", color: "var(--text-muted)", fontSize: "0.85rem" }}>純文字預覽</summary>
        <pre style={{ marginTop: "0.6rem", whiteSpace: "pre-wrap", fontSize: "0.85rem", color: "var(--text-muted)" }}>{plainPreview}</pre>
      </details>
    </div>
  );
}
