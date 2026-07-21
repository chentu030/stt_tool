import { urlLikelyBlocksFraming } from "@/lib/embedUrls";

/**
 * Embed proxy helpers: public http(s) pages can be framed via /api/web/embed-proxy.
 * Denylist only blocks private networks (SSRF) and sensitive login hosts.
 */

/** Hosts we refuse to proxy (auth / finance). */
export const EMBED_PROXY_DENY_HOSTS = [
  "accounts.google.com",
  "myaccount.google.com",
  "oauth2.googleapis.com",
  "apis.google.com",
  "appleid.apple.com",
  "login.microsoftonline.com",
  "login.live.com",
  "auth0.com",
  // TW / banks / payments — never MITM login
  "ebank.bot.com.tw",
  "netbank.hncb.com.tw",
  "ibank.megabank.com.tw",
  "ebank.taipeifubon.com.tw",
  "netbank.cathaybk.com.tw",
  "ebank.ctbcbank.com",
  "online.ctbcbank.com",
  "ebank.esunbank.com.tw",
  "netbank.scsb.com.tw",
  "atmbank.sinopac.com",
  "secure.sinopac.com",
  "paypal.com",
  "www.paypal.com",
] as const;

const PRIVATE_HOST =
  /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0|::1|\[::1\])/i;

export function hostnameOf(raw: string): string | null {
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function isGoogleAuthOrLoginUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    const h = u.hostname.toLowerCase();
    if (h === "accounts.google.com" || h === "myaccount.google.com") return true;
    if (
      h.endsWith(".google.com") &&
      /\/(o\/oauth2|signin|ServiceLogin|AccountChooser)/i.test(u.pathname + u.search)
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function hostMatchesList(host: string, list: readonly string[]): boolean {
  return list.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

export function isEmbedProxyDenied(raw: string): boolean {
  const host = hostnameOf(raw);
  if (!host) return true;
  if (PRIVATE_HOST.test(host)) return true;
  if (isGoogleAuthOrLoginUrl(raw)) return true;
  if (hostMatchesList(host, EMBED_PROXY_DENY_HOSTS)) return true;
  if (
    host.endsWith(".google.com") &&
    !host.includes("docs.") &&
    !host.includes("drive.") &&
    !host.includes("maps.")
  ) {
    if (
      host.startsWith("accounts.") ||
      host.includes("oauth") ||
      host === "google.com" ||
      host === "www.google.com"
    ) {
      return true;
    }
  }
  return false;
}

/** True when this public URL may be loaded through the embed proxy. */
export function canEmbedProxy(raw: string): boolean {
  return !isEmbedProxyDenied(raw);
}

/** @deprecated Use canEmbedProxy — allowlist removed. */
export function isEmbedProxyAllowlisted(raw: string): boolean {
  return canEmbedProxy(raw);
}

/** Same-origin Next proxy path (or optional CF worker base) used as iframe src. */
export function embedProxySrc(targetUrl: string): string {
  const base = (process.env.NEXT_PUBLIC_EMBED_PROXY_BASE || "").replace(/\/$/, "");
  if (base) {
    return `${base}?url=${encodeURIComponent(targetUrl)}`;
  }
  return `/api/web/embed-proxy?url=${encodeURIComponent(targetUrl)}`;
}

/** Prefer auto popup for Google login + known non-frameable hosts that also cannot proxy. */
export function shouldAutoDetach(raw: string): boolean {
  if (!raw || raw === "https://") return false;
  if (isGoogleAuthOrLoginUrl(raw)) return true;
  if (isEmbedProxyDenied(raw) && urlLikelyBlocksFraming(raw)) return true;
  return false;
}
