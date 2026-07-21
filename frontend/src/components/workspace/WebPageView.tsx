"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { updateNote, type Note } from "@/lib/firebase";
import { normalizeWebUrl, webUrlFromNote } from "@/lib/workspacePages";
import { resolveEmbedUrl } from "@/lib/embedUrls";

type Props = {
  note: Pick<Note, "id" | "title" | "props" | "app_link">;
  compact?: boolean;
  /** When true, URL changes stay local (TipTap embed) */
  ephemeral?: boolean;
  onTitleHint?: (title: string) => void;
  onUrlChange?: (url: string) => void;
};

export default function WebPageView({
  note,
  compact,
  ephemeral,
  onTitleHint,
  onUrlChange,
}: Props) {
  const saved = webUrlFromNote(note);
  const [draft, setDraft] = useState(saved || "https://");
  const [active, setActive] = useState(saved || "");
  const [frameKey, setFrameKey] = useState(0);
  const [busy, setBusy] = useState(false);
  /**
   * In-app history stack. Cross-origin iframes cannot expose contentWindow.history,
   * so we track URLs navigated via the address bar / 前往 / back-forward.
   */
  const [stack, setStack] = useState<string[]>(() => (saved ? [saved] : []));
  const [stackIdx, setStackIdx] = useState(() => (saved ? 0 : -1));
  const stackIdxRef = useRef(stackIdx);
  stackIdxRef.current = stackIdx;

  useEffect(() => {
    setDraft(saved || "https://");
    setActive(saved || "");
    if (saved) {
      setStack([saved]);
      setStackIdx(0);
    } else {
      setStack([]);
      setStackIdx(-1);
    }
  }, [saved, note.id]);

  const canBack = stackIdx > 0;
  const canForward = stackIdx >= 0 && stackIdx < stack.length - 1;

  const resolved = useMemo(() => {
    if (!active) return null;
    const r = resolveEmbedUrl(active);
    if (!r) {
      return {
        kind: "web" as const,
        src: active,
        title: active,
        original: active,
        frameable: true,
      };
    }
    if (r.kind === "link" || r.kind === "web") {
      return { ...r, kind: "web" as const, frameable: true, src: r.original || r.src };
    }
    return r;
  }, [active]);

  const showUrl = useCallback(
    async (url: string, opts?: { record?: "push" | "none"; persistCloud?: boolean }) => {
      const next = normalizeWebUrl(url);
      if (!next) return;
      setBusy(true);
      setActive(next);
      setDraft(next);
      setFrameKey((k) => k + 1);

      if (opts?.record !== "none") {
        setStack((prev) => {
          const i = stackIdxRef.current;
          const base = prev.slice(0, Math.max(0, i + 1));
          if (base[base.length - 1] === next) {
            setStackIdx(base.length - 1);
            return base;
          }
          const out = [...base, next];
          setStackIdx(out.length - 1);
          return out;
        });
      }

      onUrlChange?.(next);
      try {
        let title = note.title;
        try {
          const host = new URL(next).hostname.replace(/^www\./, "");
          if (host && (!title || title === "未命名網頁" || title.includes("."))) {
            title = host;
            onTitleHint?.(host);
          }
        } catch {
          /* ignore */
        }
        if (ephemeral || opts?.persistCloud === false) return;
        await updateNote(note.id, {
          props: { ...(note.props || {}), web_url: next },
          ...(title && title !== note.title ? { title } : {}),
        });
      } finally {
        setBusy(false);
      }
    },
    [note.id, note.props, note.title, onTitleHint, onUrlChange, ephemeral]
  );

  const go = () => {
    void showUrl(draft, { record: "push" });
  };

  const goBack = () => {
    if (!canBack) return;
    const i = stackIdx - 1;
    const url = stack[i];
    if (!url) return;
    setStackIdx(i);
    void showUrl(url, { record: "none" });
  };

  const goForward = () => {
    if (!canForward) return;
    const i = stackIdx + 1;
    const url = stack[i];
    if (!url) return;
    setStackIdx(i);
    void showUrl(url, { record: "none" });
  };

  return (
    <div className={`web-page-view${compact ? " is-compact" : ""}`}>
      <div className="web-page-chrome">
        <div className="web-page-nav">
          <button
            type="button"
            className="web-page-btn"
            title="上一頁"
            aria-label="上一頁"
            disabled={!canBack || busy}
            onClick={goBack}
          >
            ←
          </button>
          <button
            type="button"
            className="web-page-btn"
            title="下一頁"
            aria-label="下一頁"
            disabled={!canForward || busy}
            onClick={goForward}
          >
            →
          </button>
          <button
            type="button"
            className="web-page-btn"
            title="重新整理"
            aria-label="重新整理"
            disabled={!active || busy}
            onClick={() => setFrameKey((k) => k + 1)}
          >
            ↻
          </button>
        </div>
        <form
          className="web-page-url-form"
          onSubmit={(e) => {
            e.preventDefault();
            go();
          }}
        >
          <input
            className="web-page-url"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="https://"
            spellCheck={false}
            aria-label="網址"
          />
        </form>
        <button type="button" className="web-page-btn" disabled={busy} onClick={go}>
          前往
        </button>
        {active ? (
          <a
            className="web-page-btn web-page-external"
            href={active}
            target="_blank"
            rel="noopener noreferrer"
            title="用系統瀏覽器開啟"
          >
            ↗
          </a>
        ) : null}
      </div>
      <div className="web-page-stage">
        {!active ? (
          <div className="web-page-empty">
            <p>輸入網址，把這個分頁當成瀏覽器使用。</p>
          </div>
        ) : resolved && !resolved.frameable ? (
          <div className="web-page-blocked">
            <p>此網站不允許嵌入預覽（常見於 Google、社群網站等）。</p>
            <a className="btn" href={resolved.original} target="_blank" rel="noopener noreferrer">
              用外部瀏覽器開啟
            </a>
          </div>
        ) : (
          <iframe
            key={`${active}-${frameKey}`}
            className="web-page-frame"
            src={resolved?.src || active}
            title={resolved?.title || "網頁"}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
            referrerPolicy="no-referrer-when-downgrade"
          />
        )}
      </div>
    </div>
  );
}
