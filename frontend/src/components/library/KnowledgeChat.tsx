"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  AI_SUGGESTIONS,
  LibraryNote,
  packLibraryContext,
} from "@/lib/libraryIndex";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  usedNoteIds?: string[];
  at: number;
};

type Props = {
  notes: LibraryNote[];
  selectedIds: string[];
  onClearSelection?: () => void;
  storageKey?: string;
};

function uid() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function KnowledgeChat({
  notes,
  selectedIds,
  onClearSelection,
  storageKey = "cadence-kb-chat",
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [model, setModel] = useState("");
  const [lastUsed, setLastUsed] = useState<string[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const hydrated = useRef(false);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as ChatMessage[];
        if (Array.isArray(parsed)) setMessages(parsed.slice(-40));
      }
    } catch {
      /* ignore */
    }
    hydrated.current = true;
  }, [storageKey]);

  useEffect(() => {
    if (!hydrated.current) return;
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(messages.slice(-40)));
    } catch {
      /* ignore */
    }
  }, [messages, storageKey]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  const selectedNotes = useMemo(
    () => notes.filter((n) => selectedIds.includes(n.id)),
    [notes, selectedIds]
  );

  const scopeLabel = selectedIds.length
    ? `已選 ${selectedIds.length}`
    : notes.length === 0
      ? "無筆記"
      : `${notes.length} 篇`;

  const send = async (text: string) => {
    const prompt = text.trim();
    if (!prompt || busy) return;
    setError("");
    setBusy(true);
    setInput("");

    const userMsg: ChatMessage = { id: uid(), role: "user", text: prompt, at: Date.now() };
    setMessages((prev) => [...prev, userMsg]);

    const packed = packLibraryContext(notes, prompt, {
      selectedIds: selectedIds.length ? selectedIds : undefined,
      maxNotes: selectedIds.length ? Math.min(selectedIds.length, 16) : 10,
      maxChars: 14000,
    });
    setLastUsed(packed.usedIds);

    const history = [...messages, userMsg]
      .slice(-10)
      .map((m) => ({
        role: (m.role === "assistant" ? "model" : "user") as "user" | "model",
        text: m.text,
      }));

    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "library",
          prompt,
          context: packed.context,
          messages: history.slice(0, -1),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setModel(data.model || "");
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "assistant",
          text: data.text || "（沒有回覆）",
          usedNoteIds: packed.usedIds,
          at: Date.now(),
        },
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "assistant",
          text: `抱歉，這次沒能完成回答：${msg}`,
          at: Date.now(),
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const clearChat = () => {
    setMessages([]);
    setError("");
    setLastUsed([]);
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  };

  const empty = messages.length === 0 && !busy;

  return (
    <aside className="kb-chat">
      <header className="kb-chat-head">
        <div className="kb-chat-title">
          <h2 className="font-display">知識助手</h2>
          <span className="kb-chat-badge">{scopeLabel}</span>
        </div>
        <button
          type="button"
          className="kb-chat-icon-btn"
          onClick={clearChat}
          disabled={!messages.length && !error}
          title="清空對話"
        >
          清空
        </button>
      </header>

      {selectedNotes.length > 0 && (
        <div className="kb-chat-scope">
          {selectedNotes.slice(0, 5).map((n) => (
            <span key={n.id} className="kb-chip">{n.title || "未命名"}</span>
          ))}
          {selectedNotes.length > 5 && <span className="kb-chip">+{selectedNotes.length - 5}</span>}
          {onClearSelection && (
            <button type="button" className="kb-chip-btn" onClick={onClearSelection}>
              清除選取
            </button>
          )}
        </div>
      )}

      <div className="kb-chat-messages" ref={listRef}>
        {empty ? (
          <div className="kb-chat-empty">
            <div className="kb-chat-suggestions">
              {AI_SUGGESTIONS.map((s) => (
                <button
                  key={s.prompt}
                  type="button"
                  className="kb-suggest"
                  disabled={busy || notes.length === 0}
                  title={s.prompt}
                  onClick={() => {
                    void send(s.prompt);
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((m) => (
              <div key={m.id} className={`kb-msg kb-msg--${m.role}`}>
                <div className="kb-msg-role">{m.role === "user" ? "你" : "助手"}</div>
                <div className="kb-msg-body">{formatMessage(m.text)}</div>
                {m.usedNoteIds && m.usedNoteIds.length > 0 && (
                  <div className="kb-msg-refs">
                    參考
                    {m.usedNoteIds.slice(0, 5).map((id) => {
                      const n = notes.find((x) => x.id === id);
                      return (
                        <Link key={id} href={`/notes/${id}`} className="kb-ref">
                          {n?.title || id.slice(-6)}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
            {busy && (
              <div className="kb-msg kb-msg--assistant">
                <div className="kb-msg-role">助手</div>
                <div className="kb-msg-body kb-msg-typing">回答中…</div>
              </div>
            )}
          </>
        )}
      </div>

      {!empty && (
        <div className="kb-chat-suggestions kb-chat-suggestions--bar">
          {AI_SUGGESTIONS.map((s) => (
            <button
              key={s.prompt}
              type="button"
              className="kb-suggest"
              disabled={busy || notes.length === 0}
              title={s.prompt}
              onClick={() => {
                void send(s.prompt);
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {error && <p className="kb-chat-error">{error}</p>}
      {model && !error && (
        <p className="kb-chat-meta">
          {model}
          {lastUsed.length > 0 ? ` · 參考 ${lastUsed.length} 篇` : ""}
        </p>
      )}

      <form
        className="kb-chat-compose"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <textarea
          className="kb-chat-input"
          rows={2}
          placeholder="提問…"
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
        <button
          type="submit"
          className="kb-chat-send"
          disabled={busy || !input.trim()}
        >
          {busy ? "…" : "送出"}
        </button>
      </form>
    </aside>
  );
}

function formatMessage(text: string) {
  const blocks = text.split(/\n{2,}/);
  return blocks.map((block, i) => {
    const lines = block.split("\n");
    if (lines.every((l) => /^\s*[-*•]\s+/.test(l) || !l.trim())) {
      return (
        <ul key={i}>
          {lines.filter(Boolean).map((l, j) => (
            <li key={j}>{inlineFormat(l.replace(/^\s*[-*•]\s+/, ""))}</li>
          ))}
        </ul>
      );
    }
    if (/^#{1,3}\s/.test(block)) {
      const level = (block.match(/^#+/) || ["#"])[0].length;
      const content = block.replace(/^#{1,3}\s+/, "");
      if (level <= 2) return <h4 key={i}>{inlineFormat(content)}</h4>;
      return <h5 key={i}>{inlineFormat(content)}</h5>;
    }
    return (
      <p key={i}>
        {lines.map((l, j) => (
          <span key={j}>
            {j > 0 && <br />}
            {inlineFormat(l)}
          </span>
        ))}
      </p>
    );
  });
}

function inlineFormat(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith("**")) {
      parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else {
      parts.push(<code key={key++}>{token.slice(1, -1)}</code>);
    }
    last = m.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
