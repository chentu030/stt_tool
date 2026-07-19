"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { listenToUserNotes, type Note } from "@/lib/firebase";
import { packLibraryContext } from "@/lib/libraryIndex";
import { usePrefsOptional } from "@/components/PrefsProvider";

type Msg = { id: string; role: "user" | "assistant"; text: string };

const DOCK_SUGGESTIONS = [
  { label: "本週重點", prompt: "根據我的知識庫，整理本週最值得關注的 5 件事" },
  { label: "找相關筆記", prompt: "幫我找出彼此相關的筆記主題，並說明可如何串起來" },
  { label: "靈感草稿", prompt: "從最近筆記抽出靈感，寫一段可發展的草稿開頭" },
  { label: "待辦催收", prompt: "從筆記裡找出未完成待辦，按緊急程度排序" },
  { label: "會議準備", prompt: "幫我準備一場會議的議程與要帶的問題" },
];

function uid() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export default function GlobalAiDock() {
  const { user } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const prefsCtx = usePrefsOptional();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState<Note[]>([]);
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [atOpen, setAtOpen] = useState(false);
  const [atQ, setAtQ] = useState("");
  const [webSearch, setWebSearch] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hydrated = useRef(false);

  const onNotePage = pathname?.startsWith("/notes/");
  const assistantName = prefsCtx?.prefs.aiAssistantName || "Cadence AI";

  useEffect(() => {
    if (!user) {
      setNotes([]);
      return;
    }
    return listenToUserNotes(user.uid, setNotes);
  }, [user]);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("cadence-ai-dock");
      if (raw) {
        const parsed = JSON.parse(raw) as { msgs?: Msg[]; pinned?: string[] };
        if (Array.isArray(parsed.msgs)) setMsgs(parsed.msgs.slice(-40));
        if (Array.isArray(parsed.pinned)) setPinnedIds(parsed.pinned.slice(0, 8));
      }
    } catch {
      /* ignore */
    }
    hydrated.current = true;
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    try {
      sessionStorage.setItem(
        "cadence-ai-dock",
        JSON.stringify({ msgs: msgs.slice(-40), pinned: pinnedIds })
      );
    } catch {
      /* ignore */
    }
  }, [msgs, pinnedIds]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    setWebSearch(!!prefsCtx?.prefs.aiGrounding);
  }, [prefsCtx?.prefs.aiGrounding]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 40);
  }, [open]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, busy]);

  const pinnedNotes = useMemo(
    () => pinnedIds.map((id) => notes.find((n) => n.id === id)).filter(Boolean) as Note[],
    [pinnedIds, notes]
  );

  const atCandidates = useMemo(() => {
    const q = atQ.trim().toLowerCase();
    const list = notes.filter((n) => !pinnedIds.includes(n.id));
    if (!q) return list.slice(0, 8);
    return list.filter((n) => n.title.toLowerCase().includes(q)).slice(0, 8);
  }, [notes, pinnedIds, atQ]);

  const scopeLabel = useMemo(() => {
    if (pinnedNotes.length) return `已 @ ${pinnedNotes.length} 篇`;
    if (onNotePage) return "跨庫提問 · 本篇請用 Ctrl+J";
    return `知識庫 ${notes.length} 篇`;
  }, [onNotePage, notes.length, pinnedNotes.length]);

  const togglePin = (id: string) => {
    setPinnedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(0, 8)
    );
  };

  const send = async (text: string) => {
    const prompt = text.trim();
    if (!prompt || busy) return;
    setBusy(true);
    setError("");
    setInput("");
    setAtOpen(false);
    const userMsg: Msg = { id: uid(), role: "user", text: prompt };
    setMsgs((p) => [...p, userMsg]);
    try {
      const libNotes = notes.map((n) => ({
        id: n.id,
        title: n.title,
        body_md: n.body_md,
        tags: n.tags,
        folder: n.folder,
        updated_at: n.updated_at,
        created_at: n.created_at,
      }));
      const packed = packLibraryContext(libNotes, prompt, {
        selectedIds: pinnedIds.length ? pinnedIds : undefined,
        maxNotes: pinnedIds.length ? Math.min(pinnedIds.length, 12) : 10,
        maxChars: 14000,
      });
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "library",
          prompt,
          context: packed.context,
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

  if (!user) return null;

  return (
    <>
      <button
        type="button"
        className={`cadence-ai-fab${open ? " is-open" : ""}`}
        title={`${assistantName}（Ctrl+Shift+A）`}
        onClick={() => setOpen((v) => !v)}
      >
        AI
      </button>
      {open && (
        <div className="cadence-ai-dock">
          <div className="cadence-ai-dock-head">
            <strong>{assistantName}</strong>
            <span className="cadence-ai-dock-scope">{scopeLabel}</span>
            <button
              type="button"
              className="doc-cmd"
              title="清空對話"
              onClick={() => setMsgs([])}
            >
              清空
            </button>
            <button
              type="button"
              className="doc-cmd"
              title="深度研究"
              onClick={() => {
                setOpen(false);
                router.push("/research");
              }}
            >
              深度研究
            </button>
            <button type="button" className="doc-cmd" onClick={() => setOpen(false)}>
              關閉
            </button>
          </div>

          <div className="cadence-ai-dock-pins">
            <button
              type="button"
              className="doc-cmd"
              onClick={() => {
                setAtOpen((v) => !v);
                setAtQ("");
              }}
            >
              @ 筆記
            </button>
            {pinnedNotes.map((n) => (
              <button
                key={n.id}
                type="button"
                className="cadence-ai-pin"
                title="再點移除"
                onClick={() => togglePin(n.id)}
              >
                {n.title.slice(0, 16)}
                {n.title.length > 16 ? "…" : ""} ×
              </button>
            ))}
          </div>
          {atOpen && (
            <div className="cadence-ai-at-menu">
              <input
                className="input"
                placeholder="搜尋筆記標題…"
                value={atQ}
                onChange={(e) => setAtQ(e.target.value)}
                autoFocus
              />
              {atCandidates.length === 0 ? (
                <p className="note-aside-empty">沒有可加入的筆記</p>
              ) : (
                atCandidates.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    className="cadence-ai-at-item"
                    onClick={() => {
                      togglePin(n.id);
                      setAtOpen(false);
                    }}
                  >
                    <strong>{n.title}</strong>
                    <span>{n.folder || "未分類"}</span>
                  </button>
                ))
              )}
            </div>
          )}

          {msgs.length === 0 && (
            <div className="cadence-ai-dock-suggest">
              {DOCK_SUGGESTIONS.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  className="note-ai-chip"
                  disabled={busy}
                  onClick={() => void send(s.prompt)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}

          <div className="cadence-ai-dock-msgs" ref={listRef}>
            {msgs.length === 0 && (
              <p className="note-aside-empty">
                用 @ 指定筆記當脈絡，或直接問整個知識庫。
              </p>
            )}
            {msgs.map((m) => (
              <div key={m.id} className={`note-ai-msg note-ai-msg--${m.role}`}>
                <span>{m.role === "user" ? "你" : assistantName}</span>
                <p>{m.text}</p>
              </div>
            ))}
            {busy && <p className="note-aside-hint">思考中…</p>}
          </div>
          {error && <p className="note-aside-error">{error}</p>}
          <form
            className="cadence-ai-dock-compose"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <textarea
              ref={inputRef}
              className="input"
              rows={2}
              placeholder={`問 ${assistantName}…（可用 @ 指定筆記）`}
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
            <div className="cadence-ai-dock-actions">
              <button
                type="button"
                className={`doc-cmd${webSearch ? " is-on" : ""}`}
                title="啟用 Google 搜尋 grounding（上網）"
                aria-pressed={webSearch}
                onClick={() => setWebSearch((v) => !v)}
              >
                {webSearch ? "上網 · 開" : "上網"}
              </button>
              <button type="button" className="doc-cmd" onClick={() => router.push("/library")}>
                知識庫
              </button>
              <button type="button" className="doc-cmd" onClick={() => router.push("/settings#st-ai")}>
                偏好
              </button>
              <button type="submit" className="btn btn-sm" disabled={busy || !input.trim()}>
                送出
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
