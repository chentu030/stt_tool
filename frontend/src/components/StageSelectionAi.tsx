"use client";
import { aiFetch } from "@/lib/aiFetch";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePrefsOptional } from "@/components/PrefsProvider";
import { askPrompt } from "@/lib/dialogs";
import { generateAiImageFile } from "@/lib/aiImage";
import AiMarkdown from "@/components/AiMarkdown";
import type { CanvasAiMediaRef } from "@/lib/canvasAiContext";
import { AiAttachmentChips, useAiAttachments } from "@/components/ai/AiAttachComposer";
import { toAttachmentPayloads } from "@/lib/aiAttachments";
import { continueSelectionInAiRail } from "@/lib/aiRailBridge";

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
  /** Optional: fetch CC / Whisper for YouTube (only when user asks) */
  onFetchTranscript?: () => void | Promise<void>;
  transcriptBusy?: boolean;
  hasTranscript?: boolean;
  transcriptProgress?: string;
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
  onFetchTranscript,
  transcriptBusy,
  hasTranscript,
  transcriptProgress,
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
  const attach = useAiAttachments({ onError: (m) => setError(m) });

  useEffect(() => {
    if (!open) return;
    setPrompt("");
    setError("");
    setResult("");
    attach.clearAttachments();
    setTimeout(() => inputRef.current?.focus(), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on open/selection only
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
  }, [open, anchor.left, anchor.top, selectionBox, result, busy, error, attach.attachments.length]);

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

  const youtubeRef = (mediaRefs || []).find(
    (r) => r.kind === "youtube" || /youtube\.com|youtu\.be/i.test(r.url || "")
  );
  const hasYoutube = !!youtubeRef?.url;
  const hasSelection = !!selectionText.trim() || hasYoutube;
  const fallback =
    (context || "").trim().slice(0, 4000) ||
    (hasYoutube ? `YouTube 影片：${youtubeRef!.url}` : "") ||
    title ||
    "（無內容）";
  const mediaUrlSnip = (mediaRefs || [])
    .map((r) => (r.url || "").trim())
    .filter(Boolean)
    .join("\n");
  const snip = (mediaUrlSnip || snippetLabel || selectionText || title || "").trim();
  const snipShown =
    snip.length > 180 && !mediaUrlSnip
      ? `${snip.slice(0, 180)}…`
      : snip.length > 220
        ? `${snip.slice(0, 220)}…`
        : snip;

  const YT_QUICK = [
    { label: "這支在講什麼", ask: "請根據這支 YouTube 影片，用繁體中文說明主題與核心論點（3–5 點）。" },
    { label: "摘要重點", ask: "請根據這支 YouTube 影片產出清楚摘要，條列重點，繁體中文。" },
    { label: "列出大綱", ask: "請根據這支 YouTube 影片整理時間軸大綱（若可知時間碼更好），繁體中文。" },
  ] as const;

  const run = async (action: StageAiAction, ask?: string) => {
    const sel = selectionText.trim() || fallback;
    const hasAtt = attach.attachments.length > 0;
    if ((!sel && !hasYoutube && !hasAtt) || busy) return;
    if (!hasSelection && !hasAtt && action !== "ask_selection" && action !== "continue") {
      setError("請先選取內容，附加檔案，或直接輸入問題");
      return;
    }
    setBusy(true);
    setError("");
    setResult("");
    try {
      const payload: Record<string, unknown> = {
        action,
        title: title || (hasYoutube ? "YouTube 影片" : "選取內容"),
        selection: sel || fallback,
        body: sel || fallback,
        assistant: {
          name: prefsCtx?.prefs.aiAssistantName,
          style: prefsCtx?.prefs.aiStyle,
          model: prefsCtx?.prefs.aiModel,
          grounding: prefsCtx?.prefs.aiGrounding,
        },
      };
      if (context) payload.context = context.slice(0, 16000);
      if (mediaRefs?.length) payload.mediaRefs = mediaRefs;
      if (hasAtt) payload.attachments = toAttachmentPayloads(attach.attachments);
      if (action === "ask_selection") {
        const userAsk = ask?.trim() || prompt.trim();
        payload.prompt =
          userAsk ||
          (hasAtt
            ? "請根據附件與選取內容說明重點"
            : hasYoutube
              ? "請根據附加的 YouTube 影片說明重點"
              : hasSelection
                ? "請說明這段在說什麼"
                : "根據內容幫我整理重點");
        if (
          hasYoutube &&
          !String(payload.prompt).includes("YouTube") &&
          !String(payload.prompt).includes("影片")
        ) {
          payload.prompt = `${payload.prompt}\n\n（請直接理解附加的 YouTube 影片內容後回答，繁體中文。）`;
        }
      }
      if (action === "expand" || action === "explain") {
        payload.body = context?.slice(0, 12000) || sel || fallback;
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

  const continueInRail = () => {
    continueSelectionInAiRail({
      selectionText,
      context,
      title,
      prompt: prompt.trim() || undefined,
      mediaRefs,
      contextLabel: title ? `選取 · ${title}` : undefined,
    });
    onClose();
  };

  return (
    <div
      ref={panelRef}
      className={`sel-ai-panel${attach.dragOver ? " is-drop" : ""}`}
      style={{ top: pos.top, left: pos.left }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onDragEnter={attach.onDragEnter}
      onDragLeave={attach.onDragLeave}
      onDragOver={attach.onDragOver}
      onDrop={attach.onDrop}
    >
      {attach.fileInput}
      <div className="sel-ai-head">
        <strong>詢問 AI</strong>
        <button type="button" className="doc-cmd" onClick={onClose}>
          關閉
        </button>
      </div>
      <p className="sel-ai-snip" title={snip}>
        {snipShown ? `「${snipShown}」` : "（未選取 — 可直接提問、附加或生圖）"}
      </p>
      <p className="sel-ai-ctx-hint">對焦 · {title || "目前選取"}</p>
      {hasYoutube ? (
        <div className="sel-ai-yt-hint">
          <p>
            預設會把 YouTube 網址交給 AI <strong>直接理解影片</strong>，不必先跑轉錄。
            只有你需要完整逐字稿時，再按下方取得字幕。
          </p>
          <div className="sel-ai-quick">
            {YT_QUICK.map((q) => (
              <button
                key={q.label}
                type="button"
                className="doc-cmd is-on"
                disabled={busy || !!transcriptBusy}
                onClick={() => void run("ask_selection", q.ask)}
              >
                {q.label}
              </button>
            ))}
          </div>
          {onFetchTranscript ? (
            <button
              type="button"
              className="doc-cmd"
              disabled={busy || !!transcriptBusy || !!hasTranscript}
              onClick={() => void onFetchTranscript()}
              title={
                hasTranscript
                  ? "已有逐字稿"
                  : "先找 CC／自動字幕；沒有才用語音轉錄（較久）"
              }
            >
              {transcriptBusy
                ? transcriptProgress || "正在取得字幕／轉錄…"
                : hasTranscript
                  ? "已有逐字稿"
                  : "取得字幕／逐字稿"}
            </button>
          ) : null}
          {transcriptBusy && transcriptProgress ? (
            <p className="sel-ai-yt-progress">{transcriptProgress}</p>
          ) : null}
        </div>
      ) : null}
      <div className="sel-ai-quick">
        {!hasYoutube &&
          QUICK.map((q) => (
            <button
              key={q.id}
              type="button"
              className="doc-cmd"
              disabled={
                busy || (!hasSelection && !attach.attachments.length && q.id !== "continue")
              }
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
            disabled={busy || (!hasSelection && !hasYoutube)}
            onClick={() => void onSummarizeSelection()}
          >
            摘要到白板
          </button>
        )}
        {onMindMapSelection && (
          <button
            type="button"
            className="doc-cmd"
            disabled={busy || (!hasSelection && !hasYoutube)}
            onClick={() => void onMindMapSelection()}
          >
            心智圖草稿
          </button>
        )}
        <button type="button" className="doc-cmd" onClick={continueInRail}>
          在右側繼續
        </button>
      </div>
      <AiAttachmentChips
        attachments={attach.attachments}
        onRemove={attach.removeAttachment}
        disabled={busy}
      />
      <form
        className="sel-ai-ask"
        onSubmit={(e) => {
          e.preventDefault();
          void run("ask_selection", prompt.trim() || undefined);
        }}
      >
        <input
          ref={inputRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onPaste={attach.onPaste}
          placeholder={hasYoutube ? "問這支影片任何問題…" : "問任何問題…（可貼上圖片）"}
          disabled={busy}
        />
        <button
          type="button"
          className="doc-cmd"
          title="附加圖片或 PDF"
          disabled={busy}
          onClick={attach.openPicker}
        >
          附加
        </button>
        <button
          type="submit"
          className="doc-cmd is-on"
          disabled={busy || (!prompt.trim() && !hasYoutube && !attach.attachments.length)}
        >
          {busy ? "…" : "問"}
        </button>
      </form>
      {error && <p className="sel-ai-error">{error}</p>}
      {busy && !result && <p className="sel-ai-busy">思考中…</p>}
      {result && (
        <div className="sel-ai-result">
          <AiMarkdown text={result} />
          <div className="sel-ai-actions">
            <button
              type="button"
              className="doc-cmd is-on"
              onClick={() => {
                onApplyReplace(result);
                onClose();
              }}
            >
              {hasSelection ? "取代" : "套用"}
            </button>
            <button
              type="button"
              className="doc-cmd"
              onClick={() => {
                onApplyInsert(result);
                onClose();
              }}
            >
              {insertLabel}
            </button>
            <button
              type="button"
              className="doc-cmd"
              onClick={() => void navigator.clipboard.writeText(result)}
            >
              複製
            </button>
            <button
              type="button"
              className="doc-cmd"
              onClick={() => {
                continueSelectionInAiRail({
                  selectionText: result,
                  context,
                  title: title ? `${title} · AI 回覆` : "AI 回覆",
                  contextLabel: "選取 AI 回覆",
                });
                onClose();
              }}
            >
              帶到右側
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
