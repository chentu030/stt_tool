"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { updateNote, type Note } from "@/lib/firebase";
import { normalizeWebUrl, webUrlFromNote } from "@/lib/workspacePages";
import { resolveEmbedUrl, urlLikelyBlocksFraming } from "@/lib/embedUrls";
import {
  embedProxySrc,
  isEmbedProxyAllowlisted,
  isGoogleAuthOrLoginUrl,
  shouldAutoDetach,
} from "@/lib/embedProxy";

type Props = {
  note: Pick<Note, "id" | "title" | "props" | "app_link">;
  compact?: boolean;
  /** When true, URL changes stay local (TipTap embed) */
  ephemeral?: boolean;
  onTitleHint?: (title: string) => void;
  onUrlChange?: (url: string) => void;
};

const LS_AUTO_DETACH = "albireus.web.autoDetach";
const LS_USE_PROXY = "albireus.web.useEmbedProxy";

function readPref(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    return v === "1" || v === "true";
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/**
 * In-app browser chrome. Cross-origin iframes hide location/history from the parent,
 * so we track address-bar navigations in `stack`, and treat iframe-internal clicks as
 * `inPageDepth` — Back then reloads the last known URL (usually the site you entered).
 *
 * Sites that set X-Frame-Options / CSP frame-ancestors cannot be shown in the iframe
 * (Google login, TPEx, banks, etc.). Default path: auto-open a top-level popup.
 * Experimental: allowlisted public sites can use /api/web/embed-proxy (never Google/banks).
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
  const [autoDetach, setAutoDetach] = useState(true);
  const [useProxy, setUseProxy] = useState(true);
  const [proxyMode, setProxyMode] = useState(false);
  const [detachStatus, setDetachStatus] = useState<"idle" | "opened" | "blocked">("idle");
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
  const autoDetachRef = useRef(autoDetach);
  autoDetachRef.current = autoDetach;
  const lastAutoDetachUrl = useRef("");

  useEffect(() => {
    setAutoDetach(readPref(LS_AUTO_DETACH, true));
    setUseProxy(readPref(LS_USE_PROXY, true));
  }, []);

  const markExpectLoad = (url: string | null) => {
    expectLoadRef.current = url;
    settleUntilRef.current = Date.now() + 1200;
  };

  useEffect(() => {
    setDraft(saved || "https://");
    setActive(saved || "");
    setInPageDepth(0);
    setProxyMode(false);
    setDetachStatus("idle");
    lastAutoDetachUrl.current = "";
    markExpectLoad(saved || null);
    if (saved) {
      setStack([saved]);
      setStackIdx(0);
    } else {
      setStack([]);
      setStackIdx(-1);
    }
  }, [saved, note.id]);

  /** Top-level window — X-Frame-Options does not apply. Best path for Google / TPEx. */
  const openDetached = useCallback(
    (urlOverride?: string): boolean => {
      const url = (urlOverride || active || draft.replace(/\s*（站內）\s*$/, "")).trim();
      if (!url || url === "https://") return false;
      const href = normalizeWebUrl(url) || url;
      try {
        if (popupRef.current && !popupRef.current.closed) {
          popupRef.current.location.href = href;
          popupRef.current.focus();
          setDetachStatus("opened");
          return true;
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
        setDetachStatus("opened");
        return true;
      }
      // Popup blocker — last resort tab (may still be blocked without gesture)
      const tab = window.open(href, "_blank", "noopener,noreferrer");
      if (tab) {
        setDetachStatus("opened");
        return true;
      }
      setDetachStatus("blocked");
      return false;
    },
    [active, draft, note.id]
  );

  const tryAutoDetach = useCallback(
    (url: string, reason: "denylist" | "probe" | "google") => {
      if (!autoDetachRef.current) return;
      if (lastAutoDetachUrl.current === url) return;
      lastAutoDetachUrl.current = url;
      openDetached(url);
      void reason;
    },
    [openDetached]
  );

  // Known denylist or live header probe — cannot bypass; only detect.
  useEffect(() => {
    if (!active) {
      setProbeFrameable(null);
      setProbeReason("");
      setProxyMode(false);
      return;
    }

    const proxyOk = useProxy && isEmbedProxyAllowlisted(active) && !isGoogleAuthOrLoginUrl(active);

    if (urlLikelyBlocksFraming(active) || isGoogleAuthOrLoginUrl(active)) {
      setProbeFrameable(false);
      setProbeReason(
        isGoogleAuthOrLoginUrl(active)
          ? "Google 登入禁止嵌入（請用獨立視窗／系統瀏覽器）"
          : "此網站禁止被嵌入預覽（X-Frame-Options / CSP）"
      );
      if (proxyOk) {
        setProxyMode(true);
      } else {
        setProxyMode(false);
        tryAutoDetach(
          active,
          isGoogleAuthOrLoginUrl(active) ? "google" : "denylist"
        );
      }
      return;
    }

    // Dedicated embeds (YouTube etc.) — skip probe
    const emb = resolveEmbedUrl(active);
    if (emb && emb.frameable && emb.kind !== "link" && emb.kind !== "web") {
      setProbeFrameable(true);
      setProbeReason("");
      setProxyMode(false);
      return;
    }

    setProbeFrameable(null);
    setProbeReason("檢查中…");
    setProxyMode(false);
    let cancelled = false;
    const t = window.setTimeout(() => {
      void fetch(`/api/web/frame-check?url=${encodeURIComponent(active)}`)
        .then((r) => r.json())
        .then((data: { frameable?: boolean | null; reason?: string }) => {
          if (cancelled) return;
          if (data.frameable === false) {
            setProbeFrameable(false);
            setProbeReason(data.reason || "伺服器禁止嵌入");
            const canProxy =
              useProxy && isEmbedProxyAllowlisted(active) && !isGoogleAuthOrLoginUrl(active);
            if (canProxy) {
              setProxyMode(true);
            } else {
              tryAutoDetach(active, "probe");
            }
          } else if (data.frameable === true) {
            setProbeFrameable(true);
            setProbeReason("");
          } else {
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
  }, [active, useProxy, tryAutoDetach]);

  const canBack = inPageDepth > 0 || stackIdx > 0;
  const canForward = inPageDepth === 0 && stackIdx >= 0 && stackIdx < stack.length - 1;

  const resolved = useMemo(() => {
    if (!active) return null;
    const r = resolveEmbedUrl(active);
    if (r && r.frameable && r.kind !== "link") {
      return r;
    }
    const blocks = probeFrameable === false || urlLikelyBlocksFraming(active);
    const usePx = blocks && proxyMode && isEmbedProxyAllowlisted(active);
    return {
      kind: "web" as const,
      src: usePx ? embedProxySrc(active) : active,
      title: active,
      original: active,
      frameable: !blocks || usePx,
      viaProxy: usePx,
    };
  }, [active, probeFrameable, proxyMode]);

  const showUrl = useCallback(
    async (
      url: string,
      opts?: { record?: "push" | "none"; persistCloud?: boolean; fromBackForward?: boolean }
    ) => {
      const next = normalizeWebUrl(url);
      if (!next) return;
      setBusy(true);
      setInPageDepth(0);
      setDetachStatus("idle");
      lastAutoDetachUrl.current = "";
      markExpectLoad(next);
      setActive(next);
      setDraft(next);
      setFrameKey((k) => k + 1);

      // Same user-gesture tick: open popup for known blockers / Google (avoids popup blocker)
      const preferProxy =
        readPref(LS_USE_PROXY, true) &&
        isEmbedProxyAllowlisted(next) &&
        !isGoogleAuthOrLoginUrl(next);
      if (readPref(LS_AUTO_DETACH, true) && shouldAutoDetach(next) && !preferProxy) {
        openDetached(next);
        lastAutoDetachUrl.current = next;
      }

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
    [note.id, note.props, note.title, onTitleHint, onUrlChange, ephemeral, openDetached]
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
        // Proxied same-origin iframe — location may be our API URL
        if (href.includes("/api/web/embed-proxy")) return;
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
    markExpectLoad(proxyMode ? embedProxySrc(active) : active);
    setFrameKey((k) => k + 1);
  };

  const hostLabel = useMemo(() => {
    try {
      return active ? new URL(active).hostname.replace(/^www\./, "") : "";
    } catch {
      return "";
    }
  }, [active]);

  const showBlocked = Boolean(active && resolved && !resolved.frameable);
  const showProxiedFrame = Boolean(
    active && resolved?.frameable && "viaProxy" in resolved && resolved.viaProxy
  );

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
          onClick={() => openDetached()}
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
      <div className="web-page-prefs" aria-label="嵌入偏好">
        <label className="web-page-pref">
          <input
            type="checkbox"
            checked={autoDetach}
            onChange={(e) => {
              const v = e.target.checked;
              setAutoDetach(v);
              writePref(LS_AUTO_DETACH, v);
            }}
          />
          無法嵌入時自動開獨立視窗
        </label>
        <label className="web-page-pref">
          <input
            type="checkbox"
            checked={useProxy}
            onChange={(e) => {
              const v = e.target.checked;
              setUseProxy(v);
              writePref(LS_USE_PROXY, v);
              if (active && isEmbedProxyAllowlisted(active)) {
                lastAutoDetachUrl.current = "";
                setFrameKey((k) => k + 1);
              }
            }}
          />
          允許名單站用實驗性代理嵌入
        </label>
      </div>
      <div className="web-page-stage">
        {!active ? (
          <div className="web-page-empty">
            <p>輸入網址，把這個分頁當成瀏覽器使用。</p>
            <p className="web-page-hint">
              Google 登入會自動開獨立視窗；櫃買／證交所可走實驗性代理（公開頁，不含登入）。
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
            {detachStatus === "opened" ? (
              <p className="web-page-hint web-page-ok">已自動開啟獨立視窗。</p>
            ) : null}
            {detachStatus === "blocked" ? (
              <p className="web-page-hint web-page-warn">
                瀏覽器攔截了彈窗，請再按一次「以獨立視窗開啟」。
              </p>
            ) : null}
            <div className="web-page-blocked-actions">
              <button type="button" className="btn" onClick={() => openDetached()}>
                以獨立視窗開啟
              </button>
              <a className="btn btn-soft" href={active} target="_blank" rel="noopener noreferrer">
                用系統瀏覽器開啟
              </a>
              {isEmbedProxyAllowlisted(active) ? (
                <button
                  type="button"
                  className="btn btn-soft"
                  onClick={() => {
                    setUseProxy(true);
                    writePref(LS_USE_PROXY, true);
                    setProxyMode(true);
                    setFrameKey((k) => k + 1);
                  }}
                >
                  改用實驗性代理嵌入
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <>
            {showProxiedFrame ? (
              <div className="web-page-proxy-banner">
                實驗性代理中（{hostLabel}）· 登入／Google 請改獨立視窗
                <button type="button" className="web-page-btn" onClick={() => openDetached()}>
                  ▢ 獨立視窗
                </button>
              </div>
            ) : null}
            <iframe
              ref={frameRef}
              key={`${active}-${frameKey}-${proxyMode ? "p" : "d"}`}
              className="web-page-frame"
              src={resolved?.src || active}
              title={resolved?.title || "網頁"}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
              referrerPolicy="no-referrer-when-downgrade"
              onLoad={onFrameLoad}
            />
          </>
        )}
      </div>
    </div>
  );
}
