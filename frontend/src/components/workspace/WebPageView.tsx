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

/**
 * In-app browser chrome. Cross-origin iframes hide location/history from the parent,
 * so we track address-bar navigations in `stack`, and treat iframe-internal clicks as
 * `inPageDepth` — Back then reloads the last known URL (usually the site you entered).
 */
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
  const [stack, setStack] = useState<string[]>(() => (saved ? [saved] : []));
  const [stackIdx, setStackIdx] = useState(() => (saved ? 0 : -1));
  /** Navigations inside the iframe we cannot read (e.g. Home → Login click). */
  const [inPageDepth, setInPageDepth] = useState(0);
  const stackIdxRef = useRef(stackIdx);
  stackIdxRef.current = stackIdx;
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  /** URL we just assigned via `src` — its load must not count as in-page navigation. */
  const expectLoadRef = useRef<string | null>(saved || null);
  /** Ignore iframe loads briefly after we set `src` (redirects often fire a 2nd load). */
  const settleUntilRef = useRef(0);
  const activeRef = useRef(active);
  activeRef.current = active;

  const markExpectLoad = (url: string | null) => {
    expectLoadRef.current = url;
    settleUntilRef.current = Date.now() + 1200;
  };

  useEffect(() => {
    setDraft(saved || "https://");
    setActive(saved || "");
    setInPageDepth(0);
    markExpectLoad(saved || null);
    if (saved) {
      setStack([saved]);
      setStackIdx(0);
    } else {
      setStack([]);
      setStackIdx(-1);
    }
  }, [saved, note.id]);

  const canBack = inPageDepth > 0 || stackIdx > 0;
  const canForward = inPageDepth === 0 && stackIdx >= 0 && stackIdx < stack.length - 1;

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
    async (
      url: string,
      opts?: { record?: "push" | "none"; persistCloud?: boolean; fromBackForward?: boolean }
    ) => {
      const next = normalizeWebUrl(url);
      if (!next) return;
      setBusy(true);
      setInPageDepth(0);
      markExpectLoad(next);
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
      } else if (opts?.fromBackForward) {
        // Resetting iframe src wipes the iframe's own history — drop forward entries.
        setStack((prev) => prev.slice(0, stackIdxRef.current + 1));
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

  const syncReadableLocation = useCallback(
    (href: string) => {
      const next = normalizeWebUrl(href);
      if (!next || next === "about:blank") return;
      setInPageDepth(0);
      markExpectLoad(next);
      setActive(next);
      setDraft(next);
      setStack((prev) => {
        const i = stackIdxRef.current;
        if (prev[i] === next) return prev;
        const base = prev.slice(0, Math.max(0, i + 1));
        if (base[base.length - 1] === next) {
          setStackIdx(base.length - 1);
          return base;
        }
        const out = [...base, next];
        setStackIdx(out.length - 1);
        return out;
      });
      onUrlChange?.(next);
    },
    [onUrlChange]
  );

  const onFrameLoad = () => {
    const frame = frameRef.current;
    if (!frame) return;

    // Same-origin (rare): read real URL and push onto stack.
    try {
      const href = frame.contentWindow?.location?.href;
      if (href) {
        const expected = expectLoadRef.current;
        expectLoadRef.current = null;
        if (expected && normalizeWebUrl(href) === normalizeWebUrl(expected)) return;
        if (normalizeWebUrl(href) === normalizeWebUrl(activeRef.current) && !expected) return;
        syncReadableLocation(href);
        return;
      }
    } catch {
      /* cross-origin — fall through */
    }

    const expected = expectLoadRef.current;
    if (expected || Date.now() < settleUntilRef.current) {
      // Load from our address bar / back / forward / refresh, or a same-nav redirect.
      expectLoadRef.current = null;
      return;
    }
    // Link click (or form) inside the iframe — parent cannot see the new URL.
    setInPageDepth((d) => d + 1);
    setDraft((prev) => {
      const base = activeRef.current || prev;
      if (prev.includes("（站內）")) return prev;
      return `${base} （站內）`;
    });
  };

  const go = () => {
    void showUrl(draft.replace(/\s*（站內）\s*$/, ""), { record: "push" });
  };

  const goBack = () => {
    if (!canBack) return;
    if (inPageDepth > 0) {
      const url = stack[stackIdx] || active;
      if (!url) return;
      void showUrl(url, { record: "none", fromBackForward: true, persistCloud: false });
      return;
    }
    const i = stackIdx - 1;
    const url = stack[i];
    if (!url) return;
    stackIdxRef.current = i;
    setStackIdx(i);
    void showUrl(url, { record: "none", fromBackForward: true, persistCloud: false });
  };

  const goForward = () => {
    if (!canForward) return;
    const i = stackIdx + 1;
    const url = stack[i];
    if (!url) return;
    stackIdxRef.current = i;
    setStackIdx(i);
    void showUrl(url, { record: "none", fromBackForward: true, persistCloud: false });
  };

  const reload = () => {
    if (!active) return;
    if (inPageDepth > 0) {
      // Remounting would reload the last known URL, not the in-page view — jump back instead.
      void showUrl(active, { record: "none", persistCloud: false });
      return;
    }
    markExpectLoad(active);
    setFrameKey((k) => k + 1);
  };

  return (
    <div className={`web-page-view${compact ? " is-compact" : ""}`}>
      <div className="web-page-chrome">
        <div className="web-page-nav">
          <button
            type="button"
            className="web-page-btn"
            title={inPageDepth > 0 ? "回到上一已知網址" : "上一頁"}
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
            onClick={reload}
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
            ref={frameRef}
            key={`${active}-${frameKey}`}
            className="web-page-frame"
            src={resolved?.src || active}
            title={resolved?.title || "網頁"}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
            referrerPolicy="no-referrer-when-downgrade"
            onLoad={onFrameLoad}
          />
        )}
      </div>
    </div>
  );
}
