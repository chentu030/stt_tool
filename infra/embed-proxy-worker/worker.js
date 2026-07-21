/**
 * Optional Cloudflare Worker for edge embed proxy (same allowlist idea as Next route).
 * Deploy with Wrangler; set frontend env NEXT_PUBLIC_EMBED_PROXY_BASE=https://your-worker.workers.dev
 *
 * wrangler.toml example:
 *   name = "albireus-embed-proxy"
 *   main = "worker.js"
 *   compatibility_date = "2024-11-01"
 */

const ALLOW = [
  "tpex.org.tw",
  "www.tpex.org.tw",
  "mis.tpex.org.tw",
  "twse.com.tw",
  "www.twse.com.tw",
  "mis.twse.com.tw",
  "mops.twse.com.tw",
  "isin.twse.com.tw",
  "example.com",
  "www.example.com",
  "info.cern.ch",
];

const DENY = [
  "accounts.google.com",
  "myaccount.google.com",
  "oauth2.googleapis.com",
  "appleid.apple.com",
  "login.microsoftonline.com",
  "paypal.com",
  "www.paypal.com",
];

function hostOk(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const h = u.hostname.toLowerCase();
    if (DENY.some((d) => h === d || h.endsWith("." + d))) return false;
    if (h.includes("google") && (h.startsWith("accounts.") || h === "www.google.com")) return false;
    return ALLOW.some((a) => h === a || h.endsWith("." + a));
  } catch {
    return false;
  }
}

function stripHeaders(headers) {
  const h = new Headers(headers);
  [
    "x-frame-options",
    "content-security-policy",
    "content-security-policy-report-only",
    "cross-origin-opener-policy",
    "cross-origin-embedder-policy",
    "cross-origin-resource-policy",
  ].forEach((k) => h.delete(k));
  h.delete("set-cookie");
  h.set("access-control-allow-origin", "*");
  return h;
}

export default {
  async fetch(request) {
    const u = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,OPTIONS",
          "access-control-allow-headers": "*",
        },
      });
    }
    const target = u.searchParams.get("url");
    if (!target || !hostOk(target)) {
      return new Response(JSON.stringify({ error: "not allowlisted" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      });
    }
    const upstream = await fetch(target, {
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; AlbireusEmbedProxy/1.0)",
        accept: "text/html,application/xhtml+xml,*/*;q=0.8",
      },
    });
    if (!hostOk(upstream.url)) {
      return new Response(JSON.stringify({ error: "redirect left allowlist" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      });
    }
    const headers = stripHeaders(upstream.headers);
    const ctype = (upstream.headers.get("content-type") || "").toLowerCase();
    if (ctype.includes("text/html")) {
      let html = await upstream.text();
      html = html.replace(
        /<meta[^>]+http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi,
        ""
      );
      const banner =
        '<div style="position:sticky;top:0;z-index:99999;background:#0f766e;color:#fff;padding:6px 10px;font:12px sans-serif">Albireus CF embed proxy (experimental)</div>';
      html = html.replace(/<body([^>]*)>/i, `<body$1>${banner}`);
      headers.set("content-type", "text/html; charset=utf-8");
      return new Response(html, { status: upstream.status, headers });
    }
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
