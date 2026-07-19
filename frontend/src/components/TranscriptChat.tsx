"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { segmentsToPlainText, parseTranscript } from "@/lib/transcript";
import { usePrefsOptional } from "@/components/PrefsProvider";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: number;
};

type Props = {
  jobId: string;
  title: string;
  /** Raw transcript (SRT-ish or plain) */
  transcriptText: string;
  filename?: string;
};

const SUGGESTIONS: { label: string; prompt: string }[] = [
  { label: "三點摘要", prompt: "用三點摘要這段逐字稿的核心內容" },
  { label: "筆記大綱", prompt: "把逐字稿整理成適合寫筆記的 Markdown 大綱" },
  { label: "金句重點", prompt: "抽出金句與關鍵論點，條列說明" },
  { label: "行動項目", prompt: "從內容抽出可執行的待辦清單（- [ ]）" },
  { label: "名詞解釋", prompt: "列出出現的專有名詞並用白話解釋" },
];

function uid() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function packTranscript(raw: string, maxChars = 12000): string {
  const plain = segmentsToPlainText(parseTranscript(raw || "")).trim() || (raw || "").trim();
  if (plain.length <= maxChars) return plain;
  return `${plain.slice(0, maxChars)}\n\n…（後續省略）`;
}

export default function TranscriptChat({
  jobId,
  title,
  transcriptText,
  filename,
}: Props) {
  const prefsCtx = usePrefsOptional();
  const storageKey = `cadence-tx-chat-${jobId}`;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [model, setModel] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const hydrated = useRef(false);

  const context = useMemo(
    () => packTranscript(transcriptText),
    [transcriptText]
  );
  const charHint = context.length;

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

  const send = async (text: string) => {
    const prompt = text.trim();
    if (!prompt || busy) return;
    if (!context.trim()) {
      setError("尚無逐字稿內容可詢問");
      return;
    }
    setError("");
    setBusy(true);
    setInput("");

    const userMsg: ChatMessage = { id: uid(), role: "user", text: prompt, at: Date.now() };
    setMessages((prev) => [...prev, userMsg]);

    const history = [...messages, userMsg].slice(-10).map((m) => ({
      role: (m.role === "assistant" ? "model" : "user") as "user" | "model",
      text: m.text,
    }));

    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "note",
          title: filename || title || "逐字稿",
          prompt,
          context: `來源：逐字稿\n檔名：${filename || "—"}\n\n${context}`,
          messages: history.slice(0, -1),
          assistant: {
            name: prefsCtx?.prefs.aiAssistantName,
            style: prefsCtx?.prefs.aiStyle,
            model: prefsCtx?.prefs.aiModel,
          },
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
    setModel("");
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  };

  const empty = messages.length === 0 && !busy;

  return (
    <aside className="kb-chat tx-chat">
      <header className="kb-chat-head">
        <div className="kb-chat-title">
          <h2 className="font-display">逐字稿助手</h2>
          <span className="kb-chat-badge">
            {charHint > 0 ? `${charHint.toLocaleString()} 字` : "無內容"}
          </span>
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

      <div className="kb-chat-messages" ref={listRef}>
        {empty ? (
          <div className="kb-chat-empty">
            <div className="kb-chat-suggestions">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.prompt}
                  type="button"
                  className="kb-suggest"
                  disabled={busy || !context.trim()}
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
          {SUGGESTIONS.map((s) => (
            <button
              key={s.prompt}
              type="button"
              className="kb-suggest"
              disabled={busy || !context.trim()}
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
      {model && !error && <p className="kb-chat-meta">{model}</p>}

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
        <button type="submit" className="kb-chat-send" disabled={busy || !input.trim()}>
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
