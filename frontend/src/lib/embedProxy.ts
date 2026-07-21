import { urlLikelyBlocksFraming } from "@/lib/embedUrls";

/**
 * Embed proxy helpers: public http(s) pages can be framed via /api/web/embed-proxy.
 * Denylist only blocks private networks (SSRF) and sensitive login hosts.
 * Google consumer apps (Gemini etc.) must open top-level — proxy/iframe cannot login.
 */

/** Hosts we refuse to proxy (auth / finance / Google apps that need real cookies). */
export const EMBED_PROXY_DENY_HOSTS = [
  "accounts.google.com",
  "myaccount.google.com",
  "oauth2.googleapis.com",
  "apis.google.com",
  "gemini.google.com",
  "aistudio.google.com",
  "notebooklm.google.com",
  "labs.google.com",
  "one.google.com",
  "chat.google.com",
  "mail.google.com",
  "calendar.google.com",
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

/** Google / Workspace login & OAuth — never iframe or MITM-proxy. */
export function isGoogleAuthOrLoginUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    const h = u.hostname.toLowerCase();
    if (h === "accounts.google.com" || h === "myaccount.google.com") return true;
    if (
      h.endsWith(".google.com") &&
      /\/(o\/oauth2|signin|ServiceLogin|AccountChooser|gsi\/)/i.test(u.pathname + u.search)
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Google apps that require first-party cookies / FedCM / no framing
 * (Gemini, Gmail, …). Must open in a top-level window.
 */
export function isGoogleAppNeedsTopLevel(raw: string): boolean {
  const host = hostnameOf(raw);
  if (!host) return false;
  if (isGoogleAuthOrLoginUrl(raw)) return true;
  if (host === "google.com" || host === "www.google.com") return true;
  if (
    hostMatchesList(host, [
      "gemini.google.com",
      "aistudio.google.com",
      "notebooklm.google.com",
      "labs.google.com",
      "one.google.com",
      "chat.google.com",
      "mail.google.com",
      "calendar.google.com",
    ])
  ) {
    return true;
  }
  // Catch-all: most *.google.com except Drive/Docs/Maps preview embeds
  if (host.endsWith(".google.com") || host.endsWith(".google.com.tw")) {
    if (host.includes("drive.") || host.includes("docs.") || host.includes("maps.")) {
      return false;
    }
    return true;
  }
  return false;
}

/** Exact host or subdomain of entry — never treat entry "a.b" as matching sibling "c.b". */
function hostMatchesList(host: string, list: readonly string[]): boolean {
  return list.some((entry) => {
    const e = entry.toLowerCase();
    return host === e || host.endsWith(`.${e}`);
  });
}

export function isEmbedProxyDenied(raw: string): boolean {
  const host = hostnameOf(raw);
  if (!host) return true;
  if (PRIVATE_HOST.test(host)) return true;
  if (isGoogleAppNeedsTopLevel(raw)) return true;
  if (hostMatchesList(host, EMBED_PROXY_DENY_HOSTS)) return true;
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

/** Prefer cloud virtual browser over iframe/proxy for these hosts. */
export function shouldUseVirtualBrowser(raw: string): boolean {
  if (!raw || raw === "https://") return false;
  return isGoogleAppNeedsTopLevel(raw);
}

/** System-tab fallback when virtual browser is unavailable. */
export function shouldAutoDetach(raw: string): boolean {
  if (!raw || raw === "https://") return false;
  if (isGoogleAppNeedsTopLevel(raw)) return true;
  if (isEmbedProxyDenied(raw) && urlLikelyBlocksFraming(raw)) return true;
  return false;
}
