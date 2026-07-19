"use client";

import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import Link from "next/link";
import {
  HeadingItem,
  NOTE_AI_ACTIONS,
  NoteAiActionId,
  NoteStats,
  RelatedNote,
} from "@/lib/noteMeta";
import { CADENCE_AI_ACTIONS } from "@/lib/cadenceAiActions";
import { usePrefsOptional } from "@/components/PrefsProvider";

type ChatMsg = { id: string; role: "user" | "assistant"; text: string };

const ASIDE_SUGGESTIONS = [
  "用三點摘要這篇",
  "抽出可執行待辦",
  "改得更適合對外分享",
  "幫我寫會議議程",
  "還有哪些我沒想到的面向？",
];

export type NoteAsideAiHandle = {
  focusChat: (seed?: string) => void;
  seedSelection: (selection: string, question?: string) => void;
};

type Props = {
  noteId?: string;
  title: string;
  body: string;
  aiContext: string;
  aiChip: string;
  stats: NoteStats;
  outline: HeadingItem[];
  related: RelatedNote[];
  aiBusy: boolean;
  onAiAction: (action: NoteAiActionId | string, prompt?: string) => void;
  onInsertAtCursor: (md: string) => void;
  onInsertAppend: (md: string) => void;
  onDeepResearch?: () => void;
  onJumpHeading?: (item: HeadingItem) => void;
  onOpenSlideForHeading?: (item: HeadingItem) => void;
  open: boolean;
  tab: "outline" | "ai" | "info";
  onTab: (t: "outline" | "ai" | "info") => void;
  widthPx?: number;
  onResizeWidth?: (px: number) => void;
};

function uid() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

const NoteAside = forwardRef<NoteAsideAiHandle, Props>(function NoteAside(
  {
    noteId,
    title,
    body,
    aiContext,
    aiChip,
    stats,
    outline,
    related,
    aiBusy,
    onAiAction,
    onInsertAtCursor,
    onInsertAppend,
    onDeepResearch,
    onJumpHeading,
    onOpenSlideForHeading,
    open,
    tab,
    onTab,
    widthPx = 300,
    onResizeWidth,
  },
  ref
) {
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [webSearch, setWebSearch] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hydrated = useRef(false);
  const prefsCtx = usePrefsOptional();
  const storageKey = noteId ? `cadence-note-ai-${noteId}` : "";
  const assistantName = prefsCtx?.prefs.aiAssistantName || "Cadence AI";

  useEffect(() => {
    setWebSearch(!!prefsCtx?.prefs.aiGrounding);
  }, [prefsCtx?.prefs.aiGrounding]);

  useEffect(() => {
    hydrated.current = false;
    if (!storageKey) {
      setMsgs([]);
      return;
    }
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as ChatMsg[];
        if (Array.isArray(parsed)) setMsgs(parsed.slice(-40));
        else setMsgs([]);
      } else setMsgs([]);
    } catch {
      setMsgs([]);
    }
    hydrated.current = true;
  }, [storageKey]);

  useEffect(() => {
    if (!hydrated.current || !storageKey) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(msgs.slice(-40)));
    } catch {
      /* ignore */
    }
  }, [msgs, storageKey]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, busy]);

  useImperativeHandle(ref, () => ({
    focusChat: (seed?: string) => {
      onTab("ai");
      if (seed) setInput(seed);
      setTimeout(() => inputRef.current?.focus(), 60);
    },
    seedSelection: (selection: string, question?: string) => {
      onTab("ai");
      const q = question?.trim() || "請針對以下選取文字說明並給出可插入的 Markdown 建議";
      const seed = `${q}\n\n---\n選取：\n${selection.slice(0, 2000)}`;
      setInput(seed);
      setTimeout(() => inputRef.current?.focus(), 60);
    },
  }));

  if (!open) return null;

  const send = async (text: string) => {
    const prompt = text.trim();
    if (!prompt || busy) return;
    setBusy(true);
    setError("");
    setInput("");
    const userMsg: ChatMsg = { id: uid(), role: "user", text: prompt };
    setMsgs((p) => [...p, userMsg]);
    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "note",
          title,
          body: body.slice(0, 8000),
          context: aiContext,
          prompt,
          assistant: {
            name: prefsCtx?.prefs.aiAssistantName,
            style: prefsCtx?.prefs.aiStyle,
            model: prefsCtx?.prefs.aiModel,
            grounding: webSearch,
          },
          messages: [...msgs, userMsg]
            .slice(-8)
            .map((m) => ({
              role: m.role === "assistant" ? "model" : "user",
              text: m.text,
            }))
            .slice(0, -1),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "失敗");
      setMsgs((p) => [...p, { id: uid(), role: "assistant", text: data.text || "（無回覆）" }]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setMsgs((p) => [...p, { id: uid(), role: "assistant", text: `無法回答：${msg}` }]);
    } finally {
      setBusy(false);
    }
  };

  const lastAssistant = [...msgs].reverse().find((m) => m.role === "assistant");
  const draftChips = CADENCE_AI_ACTIONS.filter((a) => a.group === "draft" || a.group === "visual");

  return (
    <aside className="note-aside">
      {onResizeWidth != null && (
        <div
          className="note-aside-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="調整側欄寬度"
          title="拖曳調整寬度"
          onPointerDown={(e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startW = widthPx;
            const target = e.currentTarget;
            target.setPointerCapture(e.pointerId);
            const onMove = (ev: globalThis.PointerEvent) => {
              const dx = startX - ev.clientX;
              const next = Math.round(Math.min(560, Math.max(220, startW + dx)));
              onResizeWidth(next);
            };
            const onUp = (ev: globalThis.PointerEvent) => {
              target.releasePointerCapture(ev.pointerId);
              window.removeEventListener("pointermove", onMove);
              window.removeEventListener("pointerup", onUp);
            };
            window.addEventListener("pointermove", onMove);
            window.addEventListener("pointerup", onUp);
          }}
        />
      )}
      <div className="note-aside-tabs">
        {(
          [
            ["outline", "大綱"],
            ["ai", "AI"],
            ["info", "資訊"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={tab === id ? "is-active" : ""}
            onClick={() => onTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "outline" && (
        <div className="note-aside-body">
          <p className="note-aside-hint">
            點標題跳到段落
            {onOpenSlideForHeading ? "；右側可開對應投影片" : "（依 Markdown 標題）"}。
          </p>
          {outline.length === 0 ? (
            <p className="note-aside-empty">尚無標題。用 H1／H2 或輸入 # 建立結構。</p>
          ) : (
            <nav className="note-toc">
              {outline.map((h) => (
                <div key={h.id} className={`note-toc-row level-${h.level}`}>
                  <button
                    type="button"
                    className={`note-toc-item level-${h.level}`}
                    onClick={() => onJumpHeading?.(h)}
                  >
                    {h.text}
                  </button>
                  {onOpenSlideForHeading && (
                    <button
                      type="button"
                      className="note-toc-slide"
                      title="在簡報中開啟"
                      onClick={() => onOpenSlideForHeading(h)}
                    >
                      ▷
                    </button>
                  )}
                </div>
              ))}
            </nav>
          )}
          {related.length > 0 && (
            <div className="note-aside-block">
              <h4>相關筆記</h4>
              <ul className="note-related">
                {related.map((r) => (
                  <li key={r.id}>
                    <Link href={`/notes/${r.id}`}>
                      <strong>{r.title}</strong>
                      <span>{r.reason}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {tab === "ai" && (
        <div className="note-aside-body note-aside-ai">
          <p className="note-ai-chip-line" title={aiChip}>
            {aiChip}
          </p>
          <div className="note-ai-actions">
            {NOTE_AI_ACTIONS.map((a) => (
              <button
                key={a.id}
                type="button"
                className="note-ai-chip"
                disabled={aiBusy || !body.trim()}
                onClick={() => onAiAction(a.id)}
                title={a.hint}
              >
                {a.label}
              </button>
            ))}
            {onDeepResearch && (
              <button
                type="button"
                className="note-ai-chip"
                disabled={!body.trim() && !title.trim()}
                onClick={onDeepResearch}
                title="以本篇為脈絡啟動深度研究（網路 + 筆記庫）"
              >
                深度研究
              </button>
            )}
            {draftChips.map((a) => (
              <button
                key={a.id}
                type="button"
                className="note-ai-chip"
                disabled={aiBusy}
                onClick={() => onAiAction(a.apiAction, a.prompt)}
                title={a.hint}
              >
                {a.label}
              </button>
            ))}
          </div>

          <div className="note-ai-msgs" ref={listRef}>
            {msgs.length === 0 && (
              <>
                <p className="note-aside-empty">
                  針對這篇筆記提問，或點快捷建議。Ctrl+J 可快速開啟。
                </p>
                <div className="note-ai-actions" style={{ marginBottom: "0.5rem" }}>
                  {ASIDE_SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className="note-ai-chip"
                      disabled={busy}
                      onClick={() => void send(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </>
            )}
            {msgs.map((m) => (
              <div key={m.id} className={`note-ai-msg note-ai-msg--${m.role}`}>
                <span>{m.role === "user" ? "你" : assistantName}</span>
                <p>{m.text}</p>
              </div>
            ))}
            {busy && <p className="note-aside-hint">思考中…</p>}
          </div>

          {lastAssistant && (
            <div className="note-ai-insert-row">
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => onInsertAtCursor(lastAssistant.text)}
              >
                插入游標處
              </button>
              <button
                type="button"
                className="btn btn-soft btn-sm"
                onClick={() =>
                  onInsertAppend(`\n\n---\n\n## AI 回覆\n\n${lastAssistant.text}\n`)
                }
              >
                附加文末
              </button>
            </div>
          )}

          {error && <p className="note-aside-error">{error}</p>}

          <form
            className="note-ai-compose"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <textarea
              ref={inputRef}
              className="input"
              rows={3}
              placeholder="問這篇筆記…（Enter 送出，Shift+Enter 換行）"
              value={input}
              disabled={busy}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
            />
            <div className="note-ai-compose-actions">
              <button
                type="button"
                className={`doc-cmd${webSearch ? " is-on" : ""}`}
                title="啟用 Google 搜尋 grounding（上網）"
                aria-pressed={webSearch}
                onClick={() => setWebSearch((v) => !v)}
              >
                {webSearch ? "上網 · 開" : "上網"}
              </button>
              <button type="submit" className="btn btn-sm" disabled={busy || !input.trim()}>
                送出
              </button>
            </div>
          </form>
        </div>
      )}

      {tab === "info" && (
        <div className="note-aside-body">
          <div className="note-stat-grid">
            <div><strong>{stats.words}</strong><span>字詞</span></div>
            <div><strong>{stats.chars}</strong><span>字元</span></div>
            <div><strong>{stats.readingMins} 分</strong><span>閱讀</span></div>
            <div><strong>{stats.headings}</strong><span>標題</span></div>
            <div><strong>{stats.links}</strong><span>連結</span></div>
            <div><strong>{stats.todosDone}/{stats.todos}</strong><span>待辦</span></div>
          </div>
          <div className="note-aside-block">
            <h4>快捷鍵</h4>
            <ul className="note-shortcuts">
              <li><kbd>/</kbd> 或空白段 <kbd>Space</kbd> 插入／AI</li>
              <li><kbd>/ai</kbd> Cadence AI 動作</li>
              <li><kbd>Ctrl</kbd>+<kbd>J</kbd> 開啟 AI 側欄</li>
              <li><kbd>@</kbd> 提及頁面／日期／人名</li>
              <li><kbd>[[</kbd> 連結筆記</li>
              <li><kbd>Ctrl</kbd>+<kbd>Z</kbd> 復原　<kbd>Ctrl</kbd>+<kbd>Y</kbd> 重做</li>
              <li><kbd>Ctrl</kbd>+<kbd>D</kbd> 複製區塊</li>
              <li><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>↑↓</kbd> 移動區塊</li>
              <li><kbd>Ctrl</kbd>+<kbd>P</kbd>／<kbd>K</kbd> 快速搜尋</li>
              <li><kbd>Ctrl</kbd>+<kbd>S</kbd> 手動儲存</li>
              <li><kbd>Ctrl</kbd>+<kbd>F</kbd> 尋找</li>
              <li><kbd>Ctrl</kbd>+<kbd>\\</kbd> 側欄</li>
            </ul>
          </div>
          <p className="note-aside-hint">自動儲存約每 1.2 秒；版本歷史可從上方選單還原。</p>
        </div>
      )}
    </aside>
  );
});

export default NoteAside;
