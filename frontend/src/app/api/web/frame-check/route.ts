import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Probe whether a URL allows being embedded in a cross-origin iframe.
 * Uses response headers only — cannot bypass X-Frame-Options / CSP; just detects them.
 */
export async function GET(req: NextRequest) {
  const raw = (req.nextUrl.searchParams.get("url") || "").trim();
  if (!raw) {
    return NextResponse.json({ error: "缺少 url" }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(raw);
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      return NextResponse.json({ error: "僅支援 http(s)" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "網址無效" }, { status: 400 });
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    let res: Response;
    try {
      res = await fetch(target.toString(), {
        method: "GET",
        redirect: "follow",
        signal: ctrl.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; AlbireusFrameCheck/1.0; +https://albireus.app)",
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        },
      });
    } finally {
      clearTimeout(timer);
    }

    const xfo = (res.headers.get("x-frame-options") || "").toLowerCase();
    const csp = (res.headers.get("content-security-policy") || "").toLowerCase();
    const frameAncestors = csp.match(/frame-ancestors\s+([^;]+)/)?.[1]?.trim() || "";

    let frameable = true;
    let reason = "";

    if (xfo.includes("deny") || xfo === "sameorigin" || xfo.includes("sameorigin")) {
      frameable = false;
      reason = `X-Frame-Options: ${res.headers.get("x-frame-options")}`;
    } else if (frameAncestors) {
      const tokens = frameAncestors.split(/\s+/).filter(Boolean);
      const allowsAll = tokens.includes("*");
      const allowsNone = tokens.includes("'none'");
      if (allowsNone || (!allowsAll && tokens.length > 0)) {
        // 'self' or explicit host list → our origin is not included
        frameable = false;
        reason = `CSP frame-ancestors: ${frameAncestors}`;
      }
    }

    return NextResponse.json({
      url: res.url || target.toString(),
      status: res.status,
      frameable,
      reason: reason || (frameable ? "no restricting frame headers detected" : "blocked"),
      xFrameOptions: res.headers.get("x-frame-options"),
      frameAncestors: frameAncestors || null,
    });
  } catch (e) {
    return NextResponse.json({
      url: target.toString(),
      frameable: null,
      reason: e instanceof Error ? e.message : "probe failed",
      error: "probe_failed",
    });
  }
}
