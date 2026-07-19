"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { markdownToHtml } from "@/lib/mdHtml";
import { usePrefsOptional } from "@/components/PrefsProvider";

export type SelectionAiAction =
  | "improve"
  | "shorten"
  | "expand"
  | "explain"
  | "continue"
  | "translate"
  | "ask_selection";

const QUICK: { id: SelectionAiAction; label: string }[] = [
  { id: "improve", label: "改善寫作" },
  { id: "shorten", label: "精簡" },
  { id: "expand", label: "擴寫" },
  { id: "explain", label: "解釋" },
  { id: "continue", label: "繼續寫" },
  { id: "translate", label: "翻譯" },
];

type Props = {
  editor: Editor;
  noteTitle?: string;
  noteBody?: string;
  /** Rich packed context from buildNoteAiContext */
  aiContext?: string;
  open: boolean;
  onClose: () => void;
  selectionText: string;
  from: number;
  to: number;
  onSendToAside?: (selection: string, question?: string) => void;
};

export default function SelectionAiPanel({
  editor,
  noteTitle,
  noteBody,
  aiContext,
  open,
  onClose,
  selectionText,
  from,
  to,
  onSendToAside,
}: Props) {
  const prefsCtx = usePrefsOptional();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [pos, setPos] = useState({ top: 120, left: 80 });
  const inputRef = useRef<HTMLInputElement>(null);
  const rangeRef = useRef({ from, to, text: selectionText });

  useEffect(() => {
    rangeRef.current = { from, to, text: selectionText };
  }, [from, to, selectionText]);

  useEffect(() => {
    if (!open) return;
    setPrompt("");
    setError("");
    setResult("");
    try {
      const end = editor.view.coordsAtPos(to);
      const left = Math.max(12, Math.min(end.left, window.innerWidth - 380));
      const top = Math.min(end.bottom + 10, window.innerHeight - 320);
      setPos({ top, left });
    } catch {
      /* ignore */
    }
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open, editor, to]);

  if (!open) return null;

  const hasSelection = !!rangeRef.current.text.trim();
  const contextFallback = (noteBody || "").trim().slice(0, 4000) || noteTitle || "空白筆記";

  const run = async (action: SelectionAiAction, ask?: string) => {
    const sel = rangeRef.current.text.trim() || contextFallback;
    if (!sel || busy) return;
    if (!hasSelection && action !== "ask_selection" && action !== "continue") {
      setError("請先選取文字，或直接輸入問題");
      return;
    }
    setBusy(true);
    setError("");
    setResult("");
    try {
      const payload: Record<string, unknown> = {
        action: action === "expand" ? "expand" : action === "explain" ? "explain" : action,
        title: noteTitle || "未命名筆記",
        selection: sel,
        body: sel,
        assistant: {
          name: prefsCtx?.prefs.aiAssistantName,
          style: prefsCtx?.prefs.aiStyle,
          model: prefsCtx?.prefs.aiModel,
          grounding: prefsCtx?.prefs.aiGrounding,
        },
      };
      if (noteBody) payload.context = aiContext || noteBody.slice(0, 6000);
      if (action === "ask_selection") {
        payload.prompt = ask?.trim() || prompt.trim() || (hasSelection ? "請說明這段在說什麼" : "根據這篇筆記幫我整理重點");
      }
      if (action === "expand" || action === "explain") {
        payload.body = noteBody?.slice(0, 8000) || sel;
      }
      const res = await fetch("/api/ai/generate", {
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

  const replaceSelection = () => {
    if (!result) return;
    const { from: a, to: b, text } = rangeRef.current;
    const html = markdownToHtml(result);
    if (!text.trim() || a === b) {
      editor.chain().focus().insertContentAt(b, html).run();
    } else {
      editor.chain().focus().deleteRange({ from: a, to: b }).insertContentAt(a, html).run();
    }
    onClose();
  };

  const insertBelow = () => {
    if (!result) return;
    const { to: b } = rangeRef.current;
    const html = markdownToHtml(result);
    editor.chain().focus().insertContentAt(b, `<p></p>${html}`).run();
    onClose();
  };

  return (
    <div
      className="sel-ai-panel"
      style={{ top: pos.top, left: pos.left }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="sel-ai-head">
        <strong>詢問 AI</strong>
        <button type="button" className="doc-cmd" onClick={onClose}>
          關閉
        </button>
      </div>
      <p className="sel-ai-snip" title={selectionText || "整篇筆記"}>
        {selectionText.trim()
          ? `「${selectionText.slice(0, 120)}${selectionText.length > 120 ? "…" : ""}」`
          : "（未選取文字 — 可直接提問或繼續寫）"}
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
          placeholder="問任何問題，例如：改成條列、更正式…"
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
          <pre>{result}</pre>
          <div className="sel-ai-actions">
            <button type="button" className="doc-cmd is-on" onClick={replaceSelection}>
              {hasSelection ? "取代選取" : "插入此處"}
            </button>
            <button type="button" className="doc-cmd" onClick={insertBelow}>
              插入下方
            </button>
            <button
              type="button"
              className="doc-cmd"
              onClick={() => {
                void navigator.clipboard.writeText(result);
              }}
            >
              複製
            </button>
            {onSendToAside && (
              <button
                type="button"
                className="doc-cmd"
                onClick={() => {
                  onSendToAside(
                    selectionText.trim() || result,
                    prompt.trim() || "延續討論這段內容"
                  );
                  onClose();
                }}
              >
                側欄繼續
              </button>
            )}
          </div>
        </div>
      )}
      {!result && onSendToAside && selectionText.trim() && (
        <button
          type="button"
          className="doc-cmd"
          style={{ width: "100%", marginTop: 6 }}
          onClick={() => {
            onSendToAside(selectionText, prompt.trim() || undefined);
            onClose();
          }}
        >
          送到側欄繼續聊
        </button>
      )}
    </div>
  );
}
