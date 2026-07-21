import { NextRequest, NextResponse } from "next/server";
import {
  embedProxySrc,
  isEmbedProxyAllowlisted,
  isEmbedProxyDenied,
} from "@/lib/embedProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STRIP_HEADERS = [
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "cross-origin-opener-policy",
  "cross-origin-embedder-policy",
  "cross-origin-resource-policy",
  "x-content-type-options",
];

function rewriteAttrUrl(value: string, base: URL, proxyPrefix: string): string {
  const v = value.trim();
  if (!v || v.startsWith("#") || v.startsWith("data:") || v.startsWith("blob:") || v.startsWith("javascript:")) {
    return value;
  }
  if (v.startsWith("mailto:") || v.startsWith("tel:")) return value;
  try {
    const abs = new URL(v, base);
    if (abs.protocol !== "http:" && abs.protocol !== "https:") return value;
    if (isEmbedProxyDenied(abs.toString())) return abs.toString(); // leave auth links absolute (user opens top-level)
    if (!isEmbedProxyAllowlisted(abs.toString())) return abs.toString();
    return `${proxyPrefix}${encodeURIComponent(abs.toString())}`;
  } catch {
    return value;
  }
}

function rewriteHtml(html: string, pageUrl: URL, reqOrigin: string): string {
  const proxyPrefix = `${reqOrigin}/api/web/embed-proxy?url=`;
  let out = html;

  // Drop meta CSP that would block framing / scripts after rewrite
  out = out.replace(
    /<meta[^>]+http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi,
    ""
  );

  // Relative assets resolve against the real origin; absolute allowlisted URLs are rewritten above
  if (!/<base\s/i.test(out)) {
    out = out.replace(/<head([^>]*)>/i, `<head$1><base href="${pageUrl.origin}/">`);
  }

  const attrs = ["href", "src", "action", "poster", "data-src"];
  for (const attr of attrs) {
    const re = new RegExp(`\\b${attr}\\s*=\\s*(["'])([^"']*)\\1`, "gi");
    out = out.replace(re, (_m, q: string, val: string) => {
      const next = rewriteAttrUrl(val, pageUrl, proxyPrefix);
      return `${attr}=${q}${next}${q}`;
    });
  }

  // srcset: url size, url size
  out = out.replace(/\bsrcset\s*=\s*(["'])([^"']*)\1/gi, (_m, q: string, val: string) => {
    const parts = val.split(",").map((chunk) => {
      const trimmed = chunk.trim();
      const sp = trimmed.indexOf(" ");
      if (sp === -1) return rewriteAttrUrl(trimmed, pageUrl, proxyPrefix);
      const u = trimmed.slice(0, sp);
      const rest = trimmed.slice(sp);
      return rewriteAttrUrl(u, pageUrl, proxyPrefix) + rest;
    });
    return `srcset=${q}${parts.join(", ")}${q}`;
  });

  // Soft banner so users know this is experimental MITM
  const banner = `<div style="position:sticky;top:0;z-index:2147483646;background:#0f766e;color:#fff;font:12px/1.4 system-ui,sans-serif;padding:6px 10px;">Albireus 實驗性嵌入代理 · 僅允許名單公開站 · 登入／Google 請用獨立視窗</div>`;
  if (/<body[^>]*>/i.test(out)) {
    out = out.replace(/<body([^>]*)>/i, `<body$1>${banner}`);
  } else {
    out = banner + out;
  }

  return out;
}

function rewriteCss(css: string, pageUrl: URL, reqOrigin: string): string {
  const proxyPrefix = `${reqOrigin}/api/web/embed-proxy?url=`;
  return css.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (_m, q: string, val: string) => {
    const next = rewriteAttrUrl(val, pageUrl, proxyPrefix);
    return `url(${q}${next}${q})`;
  });
}

export async function GET(req: NextRequest) {
  const raw = (req.nextUrl.searchParams.get("url") || "").trim();
  if (!raw) {
    return NextResponse.json({ error: "缺少 url" }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return NextResponse.json({ error: "網址無效" }, { status: 400 });
  }

  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return NextResponse.json({ error: "僅支援 http(s)" }, { status: 400 });
  }

  if (isEmbedProxyDenied(raw) || !isEmbedProxyAllowlisted(raw)) {
    return NextResponse.json(
      {
        error: "此網址不在實驗性代理允許名單，或屬於登入／敏感站（請用獨立視窗）",
        proxySrcHint: embedProxySrc(raw),
      },
      { status: 403 }
    );
  }

  const origin = req.nextUrl.origin;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    let upstream: Response;
    try {
      upstream = await fetch(target.toString(), {
        method: "GET",
        redirect: "follow",
        signal: ctrl.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/*,*/*;q=0.8",
          "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
        },
      });
    } finally {
      clearTimeout(timer);
    }

    const finalUrl = new URL(upstream.url || target.toString());
    // After redirects, re-check allowlist (prevent open redirect off allowlist)
    if (isEmbedProxyDenied(finalUrl.toString()) || !isEmbedProxyAllowlisted(finalUrl.toString())) {
      return NextResponse.json(
        { error: "重新導向離開允許名單，已中止代理" },
        { status: 403 }
      );
    }

    const ctype = (upstream.headers.get("content-type") || "").toLowerCase();
    const headers = new Headers();
    upstream.headers.forEach((value, key) => {
      const k = key.toLowerCase();
      if (STRIP_HEADERS.includes(k)) return;
      if (k === "set-cookie") return; // avoid leaking / breaking session cookies across MITM
      if (k === "content-encoding" || k === "content-length" || k === "transfer-encoding") return;
      headers.set(key, value);
    });
    headers.set("X-Albireus-Embed-Proxy", "1");
    headers.set("Cache-Control", "private, max-age=60");

    if (ctype.includes("text/html") || ctype.includes("application/xhtml")) {
      const html = await upstream.text();
      const rewritten = rewriteHtml(html, finalUrl, origin);
      headers.set("Content-Type", "text/html; charset=utf-8");
      return new NextResponse(rewritten, { status: upstream.status, headers });
    }

    if (ctype.includes("text/css")) {
      const css = await upstream.text();
      headers.set("Content-Type", "text/css; charset=utf-8");
      return new NextResponse(rewriteCss(css, finalUrl, origin), {
        status: upstream.status,
        headers,
      });
    }

    // Pass-through binary / other (images, fonts) for allowlisted assets
    const buf = await upstream.arrayBuffer();
    if (!headers.has("Content-Type") && ctype) headers.set("Content-Type", ctype);
    return new NextResponse(buf, { status: upstream.status, headers });
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "proxy failed",
      },
      { status: 502 }
    );
  }
}
