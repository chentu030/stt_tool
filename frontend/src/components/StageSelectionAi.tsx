"use client";
import { aiFetch } from "@/lib/aiFetch";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePrefsOptional } from "@/components/PrefsProvider";
import { askPrompt } from "@/lib/dialogs";
import { generateAiImageFile } from "@/lib/aiImage";
import AiMarkdown from "@/components/AiMarkdown";
import type { CanvasAiMediaRef } from "@/lib/canvasAiContext";

export type StageAiAction =
  | "improve"
  | "shorten"
  | "expand"
  | "explain"
  | "continue"
  | "translate"
  | "ask_selection";

const QUICK: { id: StageAiAction; label: string }[] = [
  { id: "improve", label: "改善寫作" },
  { id: "shorten", label: "精簡" },
  { id: "expand", label: "擴寫" },
  { id: "explain", label: "解釋" },
  { id: "continue", label: "繼續寫" },
  { id: "translate", label: "翻譯" },
];

type Props = {
  open: boolean;
  onClose: () => void;
  selectionText: string;
  context?: string;
  title?: string;
  /** Preferred placement: right of selection (fallback left if no room). */
  anchor: { top: number; left: number; prefer?: "right" | "below" };
  selectionBox?: { top: number; left: number; width: number; height: number };
  mediaRefs?: CanvasAiMediaRef[];
  snippetLabel?: string;
  onApplyReplace: (text: string) => void;
  onApplyInsert: (text: string) => void;
  onGenerateImage?: (file: File) => void | Promise<void>;
  onSummarizeSelection?: () => void | Promise<void>;
  onMindMapSelection?: () => void | Promise<void>;
  insertLabel?: string;
};

const PANEL_W = 360;

export default function StageSelectionAi({
  open,
  onClose,
  selectionText,
  context,
  title,
  anchor,
  selectionBox,
  mediaRefs,
  snippetLabel,
  onApplyReplace,
  onApplyInsert,
  onGenerateImage,
  onSummarizeSelection,
  onMindMapSelection,
  insertLabel = "插入下方",
}: Props) {
  const prefsCtx = usePrefsOptional();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [imgBusy, setImgBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [pos, setPos] = useState({ top: anchor.top, left: anchor.left });
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setPrompt("");
    setError("");
    setResult("");
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open, selectionText]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const el = panelRef.current;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const pw = el?.offsetWidth || PANEL_W;
      const ph = el?.offsetHeight || 360;
      const gap = 12;
      const box = selectionBox;
      let left = anchor.left;
      let top = anchor.top;

      if (box) {
        // Prefer right of selection
        left = box.left + box.width + gap;
        top = box.top;
        if (left + pw > vw - 12) {
          left = Math.max(12, box.left - pw - gap);
        }
        if (top + ph > vh - 12) {
          top = Math.max(12, vh - ph - 12);
        }
        if (top < 12) top = 12;
      } else {
        left = Math.max(12, Math.min(anchor.left, vw - pw - 12));
        top = Math.max(12, Math.min(anchor.top, vh - ph - 12));
      }
      setPos({ top, left });
    };
    place();
    const t = window.setTimeout(place, 50);
    window.addEventListener("resize", place);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("resize", place);
    };
  }, [open, anchor.left, anchor.top, selectionBox, result, busy, error]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const el = panelRef.current;
      if (!el) return;
      if (el.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const hasSelection = !!selectionText.trim();
  const fallback = (context || "").trim().slice(0, 4000) || title || "（無內容）";
  const mediaUrlSnip = (mediaRefs || [])
    .map((r) => (r.url || "").trim())
    .filter(Boolean)
    .join("\n");
  // Prefer full media URLs in the chip — truncated labels used to drop ".pdf"
  const snip = (mediaUrlSnip || snippetLabel || selectionText || title || "").trim();
  const snipShown =
    snip.length > 180 && !mediaUrlSnip
      ? `${snip.slice(0, 180)}…`
      : snip.length > 220
        ? `${snip.slice(0, 220)}…`
        : snip;

  const run = async (action: StageAiAction, ask?: string) => {
    const sel = selectionText.trim() || fallback;
    if (!sel || busy) return;
    if (!hasSelection && action !== "ask_selection" && action !== "continue") {
      setError("請先選取內容，或直接輸入問題");
      return;
    }
    setBusy(true);
    setError("");
    setResult("");
    try {
      const payload: Record<string, unknown> = {
        action,
        title: title || "選取內容",
        selection: sel,
        body: sel,
        assistant: {
          name: prefsCtx?.prefs.aiAssistantName,
          style: prefsCtx?.prefs.aiStyle,
          model: prefsCtx?.prefs.aiModel,
          grounding: prefsCtx?.prefs.aiGrounding,
        },
      };
      if (context) payload.context = context.slice(0, 16000);
      if (mediaRefs?.length) payload.mediaRefs = mediaRefs;
      if (action === "ask_selection") {
        payload.prompt =
          ask?.trim() ||
          prompt.trim() ||
          (hasSelection ? "請說明這段在說什麼" : "根據內容幫我整理重點");
      }
      if (action === "expand" || action === "explain") {
        payload.body = context?.slice(0, 12000) || sel;
      }
      const res = await aiFetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "AI 失敗");
      setResult(String(data.text || "").trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI 失敗");
    } finally {
      setBusy(false);
    }
  };

  const genImage = async () => {
    if (!onGenerateImage || imgBusy) return;
    const desc = await askPrompt({
      title: "AI 生成圖片",
      message: "描述要生成的畫面",
      defaultValue: selectionText.trim().slice(0, 200) || "溫暖的書房裡，桌上有筆記本與咖啡",
      multiline: true,
    });
    if (desc == null || !desc.trim()) return;
    const ratio = await askPrompt({
      title: "長寬比",
      message: "例如 1:1、16:9、4:3",
      defaultValue: "1:1",
    });
    setImgBusy(true);
    setError("");
    try {
      const { file } = await generateAiImageFile({
        prompt: desc.trim(),
        aspectRatio: (ratio || "1:1").trim(),
      });
      await onGenerateImage(file);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "生圖失敗");
    } finally {
      setImgBusy(false);
    }
  };

  return (
    <div
      ref={panelRef}
      className="sel-ai-panel"
      style={{ top: pos.top, left: pos.left }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="sel-ai-head">
        <strong>詢問 AI</strong>
        <button type="button" className="doc-cmd" onClick={onClose}>
          關閉
        </button>
      </div>
      <p className="sel-ai-snip" title={snip}>
        {snipShown
          ? `「${snipShown}」`
          : "（未選取 — 可直接提問或生圖）"}
      </p>
      <div className="sel-ai-quick">
        {QUICK.map((q) => (
          <button
            key={q.id}
            type="button"
            className="doc-cmd"
            disabled={busy || (!hasSelection && q.id !== "continue")}
            onClick={() => void run(q.id)}
          >
            {q.label}
          </button>
        ))}
        {onGenerateImage && (
          <button
            type="button"
            className="doc-cmd"
            disabled={imgBusy}
            onClick={() => void genImage()}
          >
            {imgBusy ? "生圖中…" : "AI 生圖"}
          </button>
        )}
        {onSummarizeSelection && (
          <button
            type="button"
            className="doc-cmd"
            disabled={busy}
            onClick={() => void onSummarizeSelection()}
          >
            摘要到白板
          </button>
        )}
        {onMindMapSelection && (
          <button
            type="button"
            className="doc-cmd"
            disabled={busy}
            onClick={() => void onMindMapSelection()}
          >
            心智圖草稿
          </button>
        )}
      </div>
      <form
        className="sel-ai-ask"
        onSubmit={(e) => {
          e.preventDefault();
          void run("ask_selection", prompt);
        }}
      >
        <input
          ref={inputRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="問任何問題…"
          disabled={busy}
        />
        <button type="submit" className="doc-cmd is-on" disabled={busy || !prompt.trim()}>
          {busy ? "…" : "問"}
        </button>
      </form>
      {error && <p className="sel-ai-error">{error}</p>}
      {busy && !result && <p className="sel-ai-busy">思考中…</p>}
      {result && (
        <div className="sel-ai-result">
          <AiMarkdown text={result} />
          <div className="sel-ai-actions">
            <button type="button" className="doc-cmd is-on" onClick={() => { onApplyReplace(result); onClose(); }}>
              {hasSelection ? "取代" : "套用"}
            </button>
            <button type="button" className="doc-cmd" onClick={() => { onApplyInsert(result); onClose(); }}>
              {insertLabel}
            </button>
            <button
              type="button"
              className="doc-cmd"
              onClick={() => void navigator.clipboard.writeText(result)}
            >
              複製
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
