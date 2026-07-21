"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { auth, updateNote, type Note } from "@/lib/firebase";
import { normalizeWebUrl, webUrlFromNote } from "@/lib/workspacePages";
import { resolveEmbedUrl, urlLikelyBlocksFraming } from "@/lib/embedUrls";
import {
  canEmbedProxy,
  embedProxySrc,
  isVirtualBrowserEnabled,
  shouldAutoDetach,
  shouldUseVirtualBrowser,
} from "@/lib/embedProxy";
import { toast } from "@/lib/toast";

const BROWSER_IDLE_MS = 10 * 60 * 1000;

type Props = {
  note: Pick<Note, "id" | "title" | "props" | "app_link">;
  compact?: boolean;
  ephemeral?: boolean;
  onTitleHint?: (title: string) => void;
  onUrlChange?: (url: string) => void;
};

type BrowseMode = "direct" | "proxy" | "virtual" | "blocked";

type VirtualState = {
  sessionId: string;
  viewerUrl: string;
  privacy?: string;
};

async function authHeader(): Promise<HeadersInit> {
  const user = auth.currentUser;
  if (!user) throw new Error("請先登入");
  const token = await user.getIdToken();
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

/**
 * In-app browser: direct iframe → HTML proxy → Steel virtual Chromium.
 * Google / Gemini prefer virtual browser so login works inside Albireus.
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
  const [inPageDepth, setInPageDepth] = useState(0);
  const [probeFrameable, setProbeFrameable] = useState<boolean | null>(null);
  const [probeReason, setProbeReason] = useState("");
  const [proxyMode, setProxyMode] = useState(false);
  const [forceVirtual, setForceVirtual] = useState(false);
  const [steelConfigured, setSteelConfigured] = useState<boolean | null>(null);
  const [virtual, setVirtual] = useState<VirtualState | null>(null);
  const [virtualError, setVirtualError] = useState("");
  const [virtualBusy, setVirtualBusy] = useState(false);
  const [detachStatus, setDetachStatus] = useState<"idle" | "opened" | "blocked">("idle");

  const stackIdxRef = useRef(stackIdx);
  stackIdxRef.current = stackIdx;
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const expectLoadRef = useRef<string | null>(saved || null);
  const settleUntilRef = useRef(0);
  const activeRef = useRef(active);
  activeRef.current = active;
  const virtualSessionRef = useRef<string | null>(null);
  /** Prevent start/fail/busy loop that made the loading pane flash. */
  const virtualStartingRef = useRef(false);
  const virtualTriedUrlRef = useRef<string | null>(null);

  const markExpectLoad = (url: string | null) => {
    expectLoadRef.current = url;
    settleUntilRef.current = Date.now() + 1200;
  };

  useEffect(() => {
    void fetch("/api/web/browser/session")
      .then((r) => r.json())
      .then((d: { configured?: boolean }) => setSteelConfigured(Boolean(d.configured)))
      .catch(() => setSteelConfigured(false));
  }, []);

  useEffect(() => {
    setDraft(saved || "https://");
    setActive(saved || "");
    setInPageDepth(0);
    setProxyMode(false);
    setForceVirtual(false);
    setDetachStatus("idle");
    setVirtualError("");
    setVirtual(null);
    virtualSessionRef.current = null;
    virtualTriedUrlRef.current = null;
    virtualStartingRef.current = false;
    setVirtualBusy(false);
    markExpectLoad(saved || null);
    if (saved) {
      setStack([saved]);
      setStackIdx(0);
    } else {
      setStack([]);
      setStackIdx(-1);
    }
  }, [saved, note.id]);

  const releaseVirtual = useCallback(async () => {
    const sid = virtualSessionRef.current;
    virtualSessionRef.current = null;
    setVirtual(null);
    virtualTriedUrlRef.current = null;
    if (!sid || !auth.currentUser) return;
    try {
      const headers = await authHeader();
      await fetch("/api/web/browser/session", { method: "DELETE", headers });
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    return () => {
      void releaseVirtual();
    };
  }, [releaseVirtual]);

  const openDetached = useCallback(
    (urlOverride?: string): boolean => {
      const url = (urlOverride || active || draft.replace(/\s*（站內）\s*$/, "")).trim();
      if (!url || url === "https://") return false;
      const href = normalizeWebUrl(url) || url;
      const tab = window.open(href, "_blank", "noopener,noreferrer");
      if (tab) {
        try {
          tab.focus();
        } catch {
          /* ignore */
        }
        setDetachStatus("opened");
        return true;
      }
      setDetachStatus("blocked");
      return false;
    },
    [active, draft]
  );

  /** Dedicated popup window — cleaner than a full browser tab (no tab strip clutter). */
  const openCleanWindow = useCallback(
    (urlOverride?: string): boolean => {
      const url = (urlOverride || active || draft.replace(/\s*（站內）\s*$/, "")).trim();
      if (!url || url === "https://") return false;
      const href = normalizeWebUrl(url) || url;
      const w = Math.min(1280, Math.max(720, Math.floor(window.screen.availWidth * 0.82)));
      const h = Math.min(900, Math.max(560, Math.floor(window.screen.availHeight * 0.86)));
      const left = Math.max(0, Math.floor((window.screen.availWidth - w) / 2 + (window.screenLeft || 0)));
      const top = Math.max(0, Math.floor((window.screen.availHeight - h) / 2 + (window.screenTop || 0)));
      const features = [
        "popup=yes",
        `width=${w}`,
        `height=${h}`,
        `left=${left}`,
        `top=${top}`,
      ].join(",");
      // Named window reuses the same clean pane on repeat clicks.
      const win = window.open(href, "albireus_clean_browse", features);
      if (win) {
        try {
          win.focus();
        } catch {
          /* ignore */
        }
        setDetachStatus("opened");
        return true;
      }
      setDetachStatus("blocked");
      return false;
    },
    [active, draft]
  );

  const startVirtual = useCallback(async (url: string, opts?: { force?: boolean }) => {
    if (virtualStartingRef.current && !opts?.force) return;
    virtualStartingRef.current = true;
    setVirtualBusy(true);
    setVirtualError("");
    try {
      if (!auth.currentUser) {
        setVirtualError("請先登入 Albireus 才能使用虛擬瀏覽器");
        return;
      }
      const headers = await authHeader();
      const res = await fetch("/api/web/browser/session", {
        method: "POST",
        headers,
        body: JSON.stringify({ url }),
      });
      const data = (await res.json()) as {
        error?: string;
        sessionId?: string;
        viewerUrl?: string;
        privacy?: string;
        configured?: boolean;
      };
      if (!res.ok || !data.sessionId || !data.viewerUrl) {
        setVirtualError(data.error || "無法啟動虛擬瀏覽器");
        if (res.status === 503) setSteelConfigured(false);
        return;
      }
      virtualSessionRef.current = data.sessionId;
      setVirtual({
        sessionId: data.sessionId,
        viewerUrl: data.viewerUrl,
        privacy: data.privacy,
      });
      setSteelConfigured(true);
    } catch (e) {
      setVirtualError(e instanceof Error ? e.message : "無法啟動虛擬瀏覽器");
    } finally {
      setVirtualBusy(false);
      virtualStartingRef.current = false;
    }
  }, []);

  const navigateVirtual = useCallback(
    async (url: string) => {
      if (!virtual?.sessionId) {
        await startVirtual(url);
        return;
      }
      setVirtualBusy(true);
      try {
        const headers = await authHeader();
        const res = await fetch("/api/web/browser/navigate", {
          method: "POST",
          headers,
          body: JSON.stringify({ url, sessionId: virtual.sessionId }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) {
          toast(data.error || "導向失敗");
          if (res.status === 404) {
            await startVirtual(url);
          }
        }
      } catch (e) {
        toast(e instanceof Error ? e.message : "導向失敗");
      } finally {
        setVirtualBusy(false);
      }
    },
    [virtual?.sessionId, startVirtual]
  );

  const clipVirtual = useCallback(async () => {
    if (!virtual?.sessionId) {
      toast("尚未啟動虛擬瀏覽器");
      return;
    }
    setVirtualBusy(true);
    try {
      const headers = await authHeader();
      const res = await fetch("/api/web/browser/clip", {
        method: "POST",
        headers,
        body: JSON.stringify({ sessionId: virtual.sessionId }),
      });
      const data = (await res.json()) as {
        error?: string;
        markdown?: string;
        title?: string;
        url?: string;
      };
      if (!res.ok || !data.markdown) {
        toast(data.error || "擷取失敗");
        return;
      }
      try {
        await navigator.clipboard.writeText(data.markdown);
      } catch {
        /* ignore */
      }
      window.dispatchEvent(
        new CustomEvent("cadence-insert-md", { detail: { markdown: data.markdown } })
      );
      toast("已擷取到筆記／剪貼簿");
      if (data.url) {
        setActive(data.url);
        setDraft(data.url);
        onUrlChange?.(data.url);
      }
      if (data.title) onTitleHint?.(data.title);
    } catch (e) {
      toast(e instanceof Error ? e.message : "擷取失敗");
    } finally {
      setVirtualBusy(false);
    }
  }, [virtual?.sessionId, onUrlChange, onTitleHint]);

  // Probe / mode selection for non-virtual paths
  useEffect(() => {
    if (!active) {
      setProbeFrameable(null);
      setProbeReason("");
      setProxyMode(false);
      return;
    }
    if (forceVirtual || shouldUseVirtualBrowser(active)) {
      setProbeFrameable(false);
      setProbeReason("使用雲端虛擬瀏覽器（可登入 Google／Gemini）");
      setProxyMode(false);
      return;
    }

    if (!isVirtualBrowserEnabled() && shouldAutoDetach(active)) {
      setProbeFrameable(false);
      setProbeReason("此網站請用系統瀏覽器開啟（虛擬瀏覽器已暫時關閉）");
      setProxyMode(false);
      return;
    }

    if (urlLikelyBlocksFraming(active)) {
      setProbeFrameable(false);
      if (canEmbedProxy(active)) {
        setProbeReason("此網站禁止直接嵌入，改以頁內代理顯示");
        setProxyMode(true);
      } else {
        setProbeReason("此網站無法代理；請用虛擬瀏覽器或系統分頁");
        setProxyMode(false);
      }
      return;
    }

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
            setProxyMode(canEmbedProxy(active));
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
  }, [active, forceVirtual]);

  // Auto-start virtual once per URL (do not depend on virtualBusy — that caused a flash loop)
  useEffect(() => {
    if (!isVirtualBrowserEnabled()) return;
    if (!active) return;
    const want =
      forceVirtual ||
      shouldUseVirtualBrowser(active) ||
      (probeFrameable === false && !canEmbedProxy(active));
    if (!want) return;
    if (steelConfigured === false) return;
    if (virtual?.sessionId) return;
    if (virtualStartingRef.current) return;
    if (virtualTriedUrlRef.current === active) return;
    virtualTriedUrlRef.current = active;
    void startVirtual(active);
  }, [
    active,
    forceVirtual,
    probeFrameable,
    steelConfigured,
    virtual?.sessionId,
    startVirtual,
  ]);

  // Proxy 403 / hard failure → upgrade to virtual
  useEffect(() => {
    if (!isVirtualBrowserEnabled()) return;
    if (!active || forceVirtual || shouldUseVirtualBrowser(active)) return;
    if (probeFrameable !== false || !proxyMode || !canEmbedProxy(active)) return;
    if (steelConfigured === false) return;
    let cancelled = false;
    const ctrl = new AbortController();
    void fetch(embedProxySrc(active), { method: "GET", signal: ctrl.signal })
      .then(async (r) => {
        try {
          void r.body?.cancel();
        } catch {
          /* ignore */
        }
        if (cancelled) return;
        if (r.status === 403 || r.status === 502 || r.status === 400) {
          setForceVirtual(true);
          setProxyMode(false);
          setProbeReason("代理失敗，已改用虛擬瀏覽器");
        }
      })
      .catch(() => {
        /* keep proxy; iframe may still work */
      });
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [active, forceVirtual, probeFrameable, proxyMode, steelConfigured]);

  // Idle release after ~10 minutes with no chrome interaction
  useEffect(() => {
    if (!virtual?.sessionId) return;
    let last = Date.now();
    const bump = () => {
      last = Date.now();
    };
    const onVis = () => {
      if (document.visibilityState === "visible") bump();
    };
    window.addEventListener("pointerdown", bump);
    window.addEventListener("keydown", bump);
    document.addEventListener("visibilitychange", onVis);
    const timer = window.setInterval(() => {
      if (Date.now() - last >= BROWSER_IDLE_MS) {
        void releaseVirtual();
        toast("虛擬瀏覽器已因閒置釋放");
      }
    }, 30_000);
    return () => {
      window.removeEventListener("pointerdown", bump);
      window.removeEventListener("keydown", bump);
      document.removeEventListener("visibilitychange", onVis);
      window.clearInterval(timer);
    };
  }, [virtual?.sessionId, releaseVirtual]);

  const browseMode: BrowseMode = useMemo(() => {
    if (!active) return "direct";
    if (isVirtualBrowserEnabled() && (forceVirtual || shouldUseVirtualBrowser(active))) {
      return "virtual";
    }
    if (probeFrameable === false && !canEmbedProxy(active)) {
      // Without virtual browser: open in system tab instead of Steel.
      return isVirtualBrowserEnabled() ? "virtual" : "blocked";
    }
    if (probeFrameable === false && proxyMode && canEmbedProxy(active)) return "proxy";
    if (probeFrameable === false && !proxyMode) return "blocked";
    return "direct";
  }, [active, forceVirtual, probeFrameable, proxyMode]);

  const canBack = inPageDepth > 0 || stackIdx > 0;
  const canForward = inPageDepth === 0 && stackIdx >= 0 && stackIdx < stack.length - 1;

  const resolved = useMemo(() => {
    if (!active) return null;
    const r = resolveEmbedUrl(active);
    if (r && r.frameable && r.kind !== "link" && r.kind !== "web") {
      return r;
    }
    const blocks = probeFrameable === false || urlLikelyBlocksFraming(active);
    const usePx = browseMode === "proxy";
    return {
      kind: "web" as const,
      src: usePx ? embedProxySrc(active) : active,
      title: active,
      original: active,
      frameable: browseMode === "direct" || usePx,
      viaProxy: usePx,
    };
  }, [active, probeFrameable, browseMode]);

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
      markExpectLoad(next);
      setActive(next);
      setDraft(next);
      setFrameKey((k) => k + 1);

      const useVirt =
        isVirtualBrowserEnabled() &&
        (forceVirtual || shouldUseVirtualBrowser(next) || !canEmbedProxy(next));
      if (useVirt && steelConfigured !== false) {
        void navigateVirtual(next);
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
          props: {
            ...(note.props || {}),
            web_url: next,
            browser_mode: useVirt ? "virtual" : "auto",
          },
          ...(title && title !== note.title ? { title } : {}),
        });
      } finally {
        setBusy(false);
      }
    },
    [
      note.id,
      note.props,
      note.title,
      onTitleHint,
      onUrlChange,
      ephemeral,
      forceVirtual,
      steelConfigured,
      navigateVirtual,
    ]
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
    if (browseMode === "virtual") {
      void navigateVirtual(active);
      return;
    }
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

  const showVirtualPane = browseMode === "virtual";
  const showBlocked =
    Boolean(active) &&
    !showVirtualPane &&
    browseMode === "blocked" &&
    steelConfigured === false;

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
            disabled={!active || busy || virtualBusy}
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
            aria-label="網址"
            spellCheck={false}
          />
        </form>
        {isVirtualBrowserEnabled() ? (
          <button
            type="button"
            className={`web-page-btn${forceVirtual || showVirtualPane ? " is-on" : ""}`}
            title="虛擬瀏覽器（可登入任意網站）"
            aria-pressed={forceVirtual || showVirtualPane}
            onClick={() => {
              setForceVirtual(true);
              virtualTriedUrlRef.current = null;
              if (active) void startVirtual(active, { force: true });
            }}
          >
            虛擬
          </button>
        ) : null}
        {showVirtualPane ? (
          <button
            type="button"
            className="web-page-btn"
            title="擷取目前頁面到筆記"
            disabled={virtualBusy || !virtual}
            onClick={() => void clipVirtual()}
          >
            擷取
          </button>
        ) : null}
        {active ? (
          <a
            className="web-page-btn"
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
            <p>輸入網址，在筆記旁瀏覽任意網頁。</p>
            <p className="web-page-hint">
              Google／Gemini 請用系統瀏覽器開啟；一般公開站可頁內嵌入。
            </p>
          </div>
        ) : showVirtualPane ? (
          virtual?.viewerUrl ? (
            <iframe
              key={virtual.sessionId}
              className="web-page-frame web-page-frame--virtual"
              src={virtual.viewerUrl}
              title="虛擬瀏覽器"
              allow="clipboard-read; clipboard-write; fullscreen"
              referrerPolicy="no-referrer-when-downgrade"
            />
          ) : (
            <div className="web-page-blocked">
              <p className="web-page-blocked-title">
                {virtualBusy ? "正在啟動虛擬瀏覽器（首次可能需 1–2 分鐘）…" : "虛擬瀏覽器"}
              </p>
              {virtualError ? <p className="web-page-warn">{virtualError}</p> : null}
              {steelConfigured === false ? (
                <>
                  <p>
                    伺服器尚未設定 <code>STEEL_BASE_URL</code>（自架）或{" "}
                    <code>STEEL_API_KEY</code>
                    。可先用系統瀏覽器開啟，或依文件部署 GCE Steel。
                  </p>
                  <div className="web-page-blocked-actions">
                    <button type="button" className="btn" onClick={() => openDetached()}>
                      用系統瀏覽器開啟
                    </button>
                  </div>
                </>
              ) : (
                <div className="web-page-blocked-actions">
                  <button
                    type="button"
                    className="btn"
                    disabled={virtualBusy}
                    onClick={() => {
                      virtualTriedUrlRef.current = null;
                      void startVirtual(active, { force: true });
                    }}
                  >
                    重試啟動
                  </button>
                  <button type="button" className="btn btn-soft" onClick={() => openDetached()}>
                    系統瀏覽器備援
                  </button>
                </div>
              )}
              {probeReason && !virtualBusy ? <p className="web-page-hint">{probeReason}</p> : null}
            </div>
          )
        ) : showBlocked ? (
          <div className="web-page-blocked">
            <p className="web-page-blocked-title">{hostLabel || "此網站"}請用系統瀏覽器開啟</p>
            <p>
              {isVirtualBrowserEnabled()
                ? "請啟用虛擬瀏覽器，或用系統瀏覽器開啟。"
                : "虛擬瀏覽器已暫時關閉。Google／Gemini 等網站請用系統分頁開啟。"}
            </p>
            {detachStatus === "blocked" ? (
              <p className="web-page-warn">彈窗被擋，請直接點系統瀏覽器連結。</p>
            ) : null}
            <div className="web-page-blocked-actions">
              {isVirtualBrowserEnabled() ? (
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setForceVirtual(true);
                    virtualTriedUrlRef.current = null;
                    void startVirtual(active, { force: true });
                  }}
                >
                  改用虛擬瀏覽器
                </button>
              ) : (
                <button type="button" className="btn" onClick={() => openDetached()}>
                  用系統瀏覽器開啟
                </button>
              )}
              <a className="btn btn-soft" href={active} target="_blank" rel="noopener noreferrer">
                系統瀏覽器
              </a>
            </div>
          </div>
        ) : (
          <iframe
            ref={frameRef}
            key={`${active}-${frameKey}-${browseMode}`}
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
