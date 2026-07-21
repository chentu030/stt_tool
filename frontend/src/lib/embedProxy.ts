import { urlLikelyBlocksFraming } from "@/lib/embedUrls";

/**
 * Experimental embed proxy: allowlist / denylist + URL helpers.
 * Never proxy Google OAuth, banks, or arbitrary hosts (SSRF).
 */

/** Hosts we refuse to proxy even if somehow listed (auth / finance). */
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

/**
 * Experimental allowlist — public content sites that often set XFO/CSP.
 * Expand carefully; each host is a SSRF surface.
 */
export const EMBED_PROXY_ALLOW_HOSTS = [
  "tpex.org.tw",
  "www.tpex.org.tw",
  "mis.tpex.org.tw",
  "www.mis.tpex.org.tw",
  "twse.com.tw",
  "www.twse.com.tw",
  "mis.twse.com.tw",
  "mops.twse.com.tw",
  "isin.twse.com.tw",
  // Safe demo / docs
  "example.com",
  "www.example.com",
  "info.cern.ch",
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

export function isEmbedProxyAllowlisted(raw: string): boolean {
  if (isEmbedProxyDenied(raw)) return false;
  const host = hostnameOf(raw);
  if (!host) return false;
  return hostMatchesList(host, EMBED_PROXY_ALLOW_HOSTS);
}

/** Same-origin Next proxy path (or optional CF worker base) used as iframe src. */
export function embedProxySrc(targetUrl: string): string {
  const base = (process.env.NEXT_PUBLIC_EMBED_PROXY_BASE || "").replace(/\/$/, "");
  if (base) {
    return `${base}?url=${encodeURIComponent(targetUrl)}`;
  }
  return `/api/web/embed-proxy?url=${encodeURIComponent(targetUrl)}`;
}

/** Prefer auto popup for Google login + known non-frameable hosts. */
export function shouldAutoDetach(raw: string): boolean {
  if (!raw || raw === "https://") return false;
  if (isGoogleAuthOrLoginUrl(raw)) return true;
  return urlLikelyBlocksFraming(raw);
}
