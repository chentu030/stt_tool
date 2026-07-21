"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { updateNote, type Note } from "@/lib/firebase";
import { normalizeWebUrl, webUrlFromNote } from "@/lib/workspacePages";
import { resolveEmbedUrl, urlLikelyBlocksFraming } from "@/lib/embedUrls";

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
 *
 * Sites that set X-Frame-Options / CSP frame-ancestors cannot be shown in the iframe
 * (Google login, TPEx, banks, etc.). The best workaround is a top-level popup window.
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
  /** Server/header probe: false = site blocks framing */
  const [probeFrameable, setProbeFrameable] = useState<boolean | null>(null);
  const [probeReason, setProbeReason] = useState("");
  const stackIdxRef = useRef(stackIdx);
  stackIdxRef.current = stackIdx;
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const popupRef = useRef<Window | null>(null);
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

  // Known denylist or live header probe — cannot bypass; only detect.
  useEffect(() => {
    if (!active) {
      setProbeFrameable(null);
      setProbeReason("");
      return;
    }
    if (urlLikelyBlocksFraming(active)) {
      setProbeFrameable(false);
      setProbeReason("此網站禁止被嵌入預覽（X-Frame-Options / CSP）");
      return;
    }
    // Dedicated embeds (YouTube etc.) — skip probe
    const emb = resolveEmbedUrl(active);
    if (emb && emb.frameable && emb.kind !== "link" && emb.kind !== "web") {
      setProbeFrameable(true);
      setProbeReason("");
      return;
    }

    setProbeFrameable(null);
    setProbeReason("檢查中…");
    let cancelled = false;
    const t = window.setTimeout(() => {
      void fetch(`/api/web/frame-check?url=${encodeURIComponent(active)}`)
        .then((r) => r.json())
        .then((data: { frameable?: boolean | null; reason?: string }) => {
          if (cancelled) return;
          if (data.frameable === false) {
            setProbeFrameable(false);
            setProbeReason(data.reason || "伺服器禁止嵌入");
          } else if (data.frameable === true) {
            setProbeFrameable(true);
            setProbeReason("");
          } else {
            // Probe failed — still try iframe; user can open popup if it fails
            setProbeFrameable(true);
            setProbeReason("");
          }
        })
        .catch(() => {
          if (!cancelled) {
            setProbeFrameable(true);
            setProbeReason("");
          }
        });
    }, 80);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [active]);

  const canBack = inPageDepth > 0 || stackIdx > 0;
  const canForward = inPageDepth === 0 && stackIdx >= 0 && stackIdx < stack.length - 1;

  const resolved = useMemo(() => {
    if (!active) return null;
    const r = resolveEmbedUrl(active);
    if (r && r.frameable && r.kind !== "link") {
      return r;
    }
    const blocks =
      probeFrameable === false || urlLikelyBlocksFraming(active);
    return {
      kind: "web" as const,
      src: active,
      title: active,
      original: active,
      frameable: !blocks,
    };
  }, [active, probeFrameable]);

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
      /* cross-origin */
    }

    const expected = expectLoadRef.current;
    if (expected || Date.now() < settleUntilRef.current) {
      expectLoadRef.current = null;
      return;
    }
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
      void showUrl(active, { record: "none", persistCloud: false });
      return;
    }
    markExpectLoad(active);
    setFrameKey((k) => k + 1);
  };

  /** Top-level window — X-Frame-Options does not apply. Best path for Google / TPEx. */
  const openDetached = useCallback(() => {
    const url = (active || draft.replace(/\s*（站內）\s*$/, "")).trim();
    if (!url || url === "https://") return;
    const href = normalizeWebUrl(url) || url;
    try {
      if (popupRef.current && !popupRef.current.closed) {
        popupRef.current.location.href = href;
        popupRef.current.focus();
        return;
      }
    } catch {
      /* cross-origin popup — open a new one */
    }
    const w = window.open(
      href,
      `albireus_web_${note.id}`,
      "popup=yes,width=1280,height=840,scrollbars=yes,resizable=yes"
    );
    if (w) {
      popupRef.current = w;
      w.focus();
    } else {
      window.open(href, "_blank", "noopener,noreferrer");
    }
  }, [active, draft, note.id]);

  const hostLabel = useMemo(() => {
    try {
      return active ? new URL(active).hostname.replace(/^www\./, "") : "";
    } catch {
      return "";
    }
  }, [active]);

  const showBlocked = Boolean(active && resolved && !resolved.frameable);

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
        <button
          type="button"
          className="web-page-btn"
          disabled={busy || !(active || draft)}
          title="以獨立視窗開啟（可開 Google 登入、櫃買等擋嵌網站）"
          aria-label="獨立視窗"
          onClick={openDetached}
        >
          ▢
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
            <p className="web-page-hint">
              Google 登入、櫃買中心等網站禁止嵌入時，請按工具列「▢ 獨立視窗」。
            </p>
          </div>
        ) : showBlocked ? (
          <div className="web-page-blocked">
            <p className="web-page-blocked-title">
              {hostLabel || "此網站"}無法嵌入預覽
            </p>
            <p>
              對方用安全政策禁止被 iframe 顯示（例如 Google 登入、櫃買中心）。
              瀏覽器不允許網頁應用程式繞過這層限制。
            </p>
            {probeReason && probeReason !== "檢查中…" ? (
              <p className="web-page-hint">{probeReason}</p>
            ) : null}
            <div className="web-page-blocked-actions">
              <button type="button" className="btn" onClick={openDetached}>
                以獨立視窗開啟
              </button>
              <a className="btn btn-soft" href={active} target="_blank" rel="noopener noreferrer">
                用系統瀏覽器開啟
              </a>
            </div>
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
