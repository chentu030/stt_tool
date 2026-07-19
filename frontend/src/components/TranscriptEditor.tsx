"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Segment,
  parseTranscript,
  segmentsToTimestampedText,
  segmentsToPlainText,
  toSrt,
  toVtt,
  downloadText,
  applyReplace,
  formatClock,
} from "@/lib/transcript";
import { toast } from "@/lib/toast";

export default function TranscriptEditor({
  initialText,
  filename = "transcript",
  onSave,
  onChange,
}: {
  initialText: string;
  filename?: string;
  onSave?: (text: string) => Promise<void> | void;
  onChange?: (text: string) => void;
}) {
  const [segs, setSegs] = useState<Segment[]>(() => parseTranscript(initialText || ""));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const plainPreview = useMemo(() => segmentsToPlainText(segs), [segs]);

  useEffect(() => {
    onChange?.(segmentsToTimestampedText(segs));
  }, [segs]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "s") return;
      if (!onSave || !dirty || saving) return;
      e.preventDefault();
      void save();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, saving, onSave, segs]);

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
      toast("已儲存逐字稿");
    } catch (e) {
      const err = e instanceof Error ? e.message : "儲存失敗";
      setMsg(err);
      toast(err);
    } finally {
      setSaving(false);
    }
  };

  const base = filename.replace(/\.[^/.]+$/, "") || "transcript";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
        <input
          className="input"
          style={{ maxWidth: 160 }}
          placeholder="尋找…"
          value={find}
          onChange={(e) => setFind(e.target.value)}
        />
        <input
          className="input"
          style={{ maxWidth: 160 }}
          placeholder="取代為…"
          value={replace}
          onChange={(e) => setReplace(e.target.value)}
        />
        <button className="btn btn-ghost btn-sm" onClick={() => doReplace(false)} disabled={!find}>
          取代
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => doReplace(true)} disabled={!find}>
          全部取代
        </button>
        <div style={{ flex: 1 }} />
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => downloadText(`${base}.txt`, segmentsToPlainText(segs))}
        >
          TXT
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => downloadText(`${base}.srt`, toSrt(segs))}>
          SRT
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => downloadText(`${base}.vtt`, toVtt(segs), "text/vtt")}
        >
          VTT
        </button>
        {onSave && (
          <button className="btn btn-sm" onClick={() => void save()} disabled={!dirty || saving} title="儲存 ⌘S">
            {saving ? "儲存中…" : dirty ? "儲存 *" : "已儲存"}
          </button>
        )}
      </div>
      {msg && <p style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>{msg}</p>}

      <div className="surface" style={{ maxHeight: "58vh", overflow: "auto", padding: "0.4rem" }}>
        {segs.length === 0 ? (
          <p style={{ color: "var(--text-muted)", padding: "1.5rem", textAlign: "center" }}>
            尚無逐字稿內容
          </p>
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
                rows={Math.max(1, Math.ceil(s.text.length / 48))}
                onChange={(e) => updateSeg(s.id, e.target.value)}
              />
            </div>
          ))
        )}
      </div>
      <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: 0 }}>
        預覽 {plainPreview.length} 字
      </p>
    </div>
  );
}
