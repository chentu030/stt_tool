import Steel from "steel-sdk";
import puppeteer from "puppeteer-core";
import { firebaseConfig } from "@/lib/firebasePublic";

const STEEL_API_KEY = (process.env.STEEL_API_KEY || "").trim();
/** Self-hosted Steel Browser base, e.g. https://xxx.trycloudflare.com (no trailing slash). */
const STEEL_BASE_URL = (process.env.STEEL_BASE_URL || "").trim().replace(/\/$/, "");

/** Default session lifetime 15m; idle release 10m (client-side). */
export const BROWSER_SESSION_TIMEOUT_MS = 15 * 60 * 1000;
export const BROWSER_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
/** Soft cap so one e2-standard-2 VM does not melt under concurrent Chromium. */
export const MAX_CONCURRENT_BROWSER_SESSIONS = Math.max(
  1,
  Number(process.env.STEEL_MAX_SESSIONS || "4") || 4
);

type UserSession = {
  sessionId: string;
  debugUrl: string;
  websocketUrl: string;
  createdAt: number;
  lastUsed: number;
};

const g = globalThis as unknown as {
  __albireusBrowserSessions?: Map<string, UserSession>;
  __albireusBrowserRate?: Map<string, number[]>;
};

function sessionMap() {
  if (!g.__albireusBrowserSessions) g.__albireusBrowserSessions = new Map();
  return g.__albireusBrowserSessions;
}

function rateMap() {
  if (!g.__albireusBrowserRate) g.__albireusBrowserRate = new Map();
  return g.__albireusBrowserRate;
}

export function isSelfHostedSteel(): boolean {
  return Boolean(STEEL_BASE_URL);
}

export function isSteelConfigured(): boolean {
  // Temporarily off unless explicitly enabled (avoids GCE cost / flaky UX).
  if (!isVirtualBrowserFeatureOn()) return false;
  return Boolean(STEEL_BASE_URL || STEEL_API_KEY);
}

function isVirtualBrowserFeatureOn(): boolean {
  const v = (process.env.VIRTUAL_BROWSER_ENABLED || process.env.NEXT_PUBLIC_VIRTUAL_BROWSER_ENABLED || "")
    .trim()
    .toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export function getSteelPublicOrigin(): string | null {
  return STEEL_BASE_URL || null;
}

/**
 * Rewrite localhost / private hosts from Steel session payloads to the public tunnel origin.
 * Self-hosted Steel often returns http://127.0.0.1:3000/... which browsers cannot reach from Vercel.
 */
export function rewriteSteelPublicUrl(raw: string): string {
  if (!raw || !STEEL_BASE_URL) return raw;
  try {
    const pub = new URL(STEEL_BASE_URL);
    const u = new URL(raw);
    const host = u.hostname;
    const isLocal =
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host.endsWith(".local") ||
      host.startsWith("10.") ||
      host.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);

    // Same public host but http from Steel DOMAIN — force https for Vercel iframe.
    if (host === pub.hostname || host === pub.host) {
      u.protocol = pub.protocol;
      u.port = pub.port;
      return u.toString();
    }

    if (isLocal || u.port === "3000" || u.port === "9223") {
      u.protocol = pub.protocol;
      u.hostname = pub.hostname;
      u.port = pub.port;
      return u.toString();
    }
    return raw;
  } catch {
    return raw;
  }
}

function rewriteWsEndpoint(raw: string): string {
  if (!raw) return raw;
  const rewritten = rewriteSteelPublicUrl(
    raw.replace(/^ws:/i, "http:").replace(/^wss:/i, "https:")
  );
  if (rewritten.startsWith("https://")) return `wss://${rewritten.slice("https://".length)}`;
  if (rewritten.startsWith("http://")) return `ws://${rewritten.slice("http://".length)}`;
  return raw;
}

export function getSteelClient(): Steel | null {
  if (!isSteelConfigured()) return null;
  if (STEEL_BASE_URL) {
    return new Steel({
      baseURL: STEEL_BASE_URL,
      steelAPIKey: STEEL_API_KEY || null,
    });
  }
  return new Steel({ steelAPIKey: STEEL_API_KEY });
}

/** Verify Firebase ID token via Identity Toolkit (no firebase-admin). */
export async function verifyFirebaseIdToken(
  idToken: string
): Promise<{ uid: string; email?: string } | null> {
  const token = idToken.trim();
  if (!token) return null;
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseConfig.apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken: token }),
      }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      users?: Array<{ localId?: string; email?: string }>;
    };
    const u = data.users?.[0];
    if (!u?.localId) return null;
    return { uid: u.localId, email: u.email };
  } catch {
    return null;
  }
}

export function checkCreateRateLimit(uid: string, maxPerMin = 6): boolean {
  const now = Date.now();
  const m = rateMap();
  const arr = (m.get(uid) || []).filter((t) => now - t < 60_000);
  if (arr.length >= maxPerMin) {
    m.set(uid, arr);
    return false;
  }
  arr.push(now);
  m.set(uid, arr);
  return true;
}

export function getUserSession(uid: string): UserSession | undefined {
  return sessionMap().get(uid);
}

export function touchUserSession(uid: string) {
  const s = sessionMap().get(uid);
  if (s) s.lastUsed = Date.now();
}

export function setUserSession(uid: string, session: UserSession) {
  sessionMap().set(uid, session);
}

export function clearUserSession(uid: string) {
  sessionMap().delete(uid);
}

export function countActiveBrowserSessions(): number {
  return sessionMap().size;
}

export function assertBrowserCapacity(uid: string) {
  const existing = getUserSession(uid);
  const others = countActiveBrowserSessions() - (existing ? 1 : 0);
  if (others >= MAX_CONCURRENT_BROWSER_SESSIONS) {
    throw new Error(
      `目前虛擬瀏覽器人數已滿（最多 ${MAX_CONCURRENT_BROWSER_SESSIONS} 人同時使用），請稍候再試。`
    );
  }
}

export function viewerUrlFromDebug(debugUrl: string): string {
  let publicUrl = rewriteSteelPublicUrl(debugUrl);
  // Steel DOMAIN often emits http:// even behind Caddy — never embed http in HTTPS Albireus.
  if (STEEL_BASE_URL.startsWith("https:") && publicUrl.startsWith("http:")) {
    publicUrl = `https:${publicUrl.slice("http:".length)}`;
  }
  try {
    const u = new URL(publicUrl);
    u.searchParams.set("interactive", "true");
    u.searchParams.set("showControls", "true");
    return u.toString();
  } catch {
    const sep = publicUrl.includes("?") ? "&" : "?";
    return `${publicUrl}${sep}interactive=true&showControls=true`;
  }
}

export function connectEndpoint(sessionId: string, websocketUrl?: string): string {
  if (websocketUrl) {
    let endpoint = rewriteWsEndpoint(websocketUrl);
    if (endpoint.includes("apiKey=")) return endpoint;
    if ((endpoint.startsWith("wss://") || endpoint.startsWith("ws://")) && STEEL_API_KEY) {
      const join = endpoint.includes("?") ? "&" : "?";
      return `${endpoint}${join}apiKey=${encodeURIComponent(STEEL_API_KEY)}`;
    }
    return endpoint;
  }
  if (STEEL_BASE_URL) {
    // Self-host fallback: CDP often exposed via Steel connect path on the API host.
    const base = STEEL_BASE_URL.replace(/^http/i, "ws");
    return `${base}?sessionId=${encodeURIComponent(sessionId)}`;
  }
  return `wss://connect.steel.dev?apiKey=${encodeURIComponent(STEEL_API_KEY)}&sessionId=${encodeURIComponent(sessionId)}`;
}

export async function releaseSteelSession(sessionId: string) {
  const client = getSteelClient();
  if (!client) return;
  try {
    await client.sessions.release(sessionId);
  } catch {
    /* already gone */
  }
}

export async function createSteelSession(uid: string, startUrl?: string) {
  const client = getSteelClient();
  if (!client) {
    throw new Error(
      STEEL_BASE_URL || STEEL_API_KEY
        ? "無法建立 Steel 用戶端"
        : "尚未設定 STEEL_BASE_URL（自架）或 STEEL_API_KEY（Steel Cloud）"
    );
  }

  const existing = getUserSession(uid);
  if (existing) {
    await releaseSteelSession(existing.sessionId);
    clearUserSession(uid);
  }

  assertBrowserCapacity(uid);

  const session = await client.sessions.create({
    timeout: BROWSER_SESSION_TIMEOUT_MS,
  });

  const debugUrl = rewriteSteelPublicUrl(session.debugUrl);
  const websocketUrl = rewriteWsEndpoint(session.websocketUrl);

  const record: UserSession = {
    sessionId: session.id,
    debugUrl,
    websocketUrl,
    createdAt: Date.now(),
    lastUsed: Date.now(),
  };
  setUserSession(uid, record);

  if (startUrl) {
    try {
      await navigateSteelSession(session.id, websocketUrl, startUrl);
    } catch (e) {
      console.warn("[steel] initial navigate failed", e);
    }
  }

  return {
    sessionId: session.id,
    viewerUrl: viewerUrlFromDebug(debugUrl),
    debugUrl,
  };
}

export async function navigateSteelSession(
  sessionId: string,
  websocketUrl: string,
  url: string
) {
  const endpoint = connectEndpoint(sessionId, websocketUrl);
  const browser = await puppeteer.connect({
    browserWSEndpoint: endpoint,
    acceptInsecureCerts: true,
  });
  try {
    const pages = await browser.pages();
    const page = pages[0] || (await browser.newPage());
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  } finally {
    browser.disconnect();
  }
}

export async function clipSteelSession(sessionId: string, websocketUrl: string) {
  const endpoint = connectEndpoint(sessionId, websocketUrl);
  const browser = await puppeteer.connect({
    browserWSEndpoint: endpoint,
    acceptInsecureCerts: true,
  });
  try {
    const pages = await browser.pages();
    const page = pages[0] || (await browser.newPage());
    const title = (await page.title()) || "網頁";
    const url = page.url();
    const selection = await page.evaluate(() => {
      try {
        return window.getSelection()?.toString()?.trim() || "";
      } catch {
        return "";
      }
    });
    const screenshot = (await page.screenshot({
      encoding: "base64",
      type: "jpeg",
      quality: 72,
    })) as string;
    const lines: string[] = [];
    lines.push(`[bookmark|${title.replace(/[\[\]]/g, "")}](${url})`);
    if (selection) {
      lines.push("");
      lines.push(selection);
    }
    lines.push("");
    lines.push(
      `![clip|${title.replace(/[\[\]!]/g, "").slice(0, 80)}](data:image/jpeg;base64,${screenshot})`
    );
    return {
      title,
      url,
      selection,
      screenshotDataUrl: `data:image/jpeg;base64,${screenshot}`,
      markdown: lines.join("\n"),
    };
  } finally {
    browser.disconnect();
  }
}
