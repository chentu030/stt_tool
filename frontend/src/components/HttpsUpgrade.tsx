"use client";

import { useEffect } from "react";

/** Force https for absolute http URLs (except local dev). */
export function forceHttpsUrl(raw: string): string {
  const s = (raw || "").trim();
  if (!s) return s;
  if (/^http:\/\//i.test(s) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(s)) {
    return `https://${s.slice("http://".length)}`;
  }
  return s;
}

/**
 * Upgrades http:// subresources so note covers / embeds cannot mark the tab 「不安全」.
 * Also upgrades fetch and WebSocket (ws → wss) on HTTPS pages.
 */
export default function HttpsUpgrade() {
  useEffect(() => {
    if (window.location.protocol !== "https:") return;

    const shouldUpgradeHttp = (url: string) =>
      /^http:\/\//i.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(url);

    const upgradeEl = (el: Element) => {
      for (const attr of ["src", "href", "poster"] as const) {
        const v = el.getAttribute(attr);
        if (v && shouldUpgradeHttp(v)) {
          el.setAttribute(attr, `https://${v.slice(7)}`);
        }
      }
      const style = el.getAttribute("style");
      if (style && /url\(\s*['"]?http:/i.test(style)) {
        el.setAttribute("style", style.replace(/url\(\s*(['"]?)http:\/\//gi, "url($1https://"));
      }
    };

    const scan = (root: ParentNode) => {
      root.querySelectorAll("img,video,audio,source,iframe,use,image").forEach(upgradeEl);
      root.querySelectorAll("[style*='http://']").forEach(upgradeEl);
    };

    scan(document);

    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === "attributes" && m.target instanceof Element) upgradeEl(m.target);
        m.addedNodes.forEach((n) => {
          if (n instanceof Element) {
            upgradeEl(n);
            scan(n);
          }
        });
      }
    });
    mo.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["src", "href", "poster", "style"],
    });

    const origFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      if (typeof input === "string" && shouldUpgradeHttp(input)) {
        input = `https://${input.slice(7)}`;
      } else if (input instanceof URL && input.protocol === "http:" && input.hostname !== "localhost") {
        input = new URL(input.href.replace(/^http:/i, "https:"));
      }
      return origFetch(input, init);
    };

    const OrigWS = window.WebSocket;
    function PatchedWebSocket(url: string | URL, protocols?: string | string[]) {
      let u = typeof url === "string" ? url : url.toString();
      if (/^ws:\/\//i.test(u) && !/localhost|127\.0\.0\.1/i.test(u)) {
        u = `wss://${u.slice(5)}`;
      }
      if (protocols === undefined) return new OrigWS(u);
      return new OrigWS(u, protocols);
    }
    PatchedWebSocket.prototype = OrigWS.prototype;
    Object.assign(PatchedWebSocket, {
      CONNECTING: OrigWS.CONNECTING,
      OPEN: OrigWS.OPEN,
      CLOSING: OrigWS.CLOSING,
      CLOSED: OrigWS.CLOSED,
    });
    window.WebSocket = PatchedWebSocket as unknown as typeof WebSocket;

    return () => {
      mo.disconnect();
      window.fetch = origFetch;
      window.WebSocket = OrigWS;
    };
  }, []);

  return null;
}
