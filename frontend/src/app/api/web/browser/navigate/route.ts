import { NextRequest, NextResponse } from "next/server";
import {
  getUserSession,
  isSteelConfigured,
  navigateSteelSession,
  touchUserSession,
  verifyFirebaseIdToken,
} from "@/lib/steelBrowser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function normalizeUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  try {
    const withProto = /^https?:\/\//i.test(t) ? t : `https://${t}`;
    const u = new URL(withProto);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.toString();
  } catch {
    return "";
  }
}

export async function POST(req: NextRequest) {
  if (!isSteelConfigured()) {
    return NextResponse.json({ error: "虛擬瀏覽器未啟用" }, { status: 503 });
  }

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const user = await verifyFirebaseIdToken(token);
  if (!user) {
    return NextResponse.json({ error: "請先登入" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { url?: string; sessionId?: string };
  const url = normalizeUrl(String(body.url || "").trim());
  if (!url) {
    return NextResponse.json({ error: "網址無效" }, { status: 400 });
  }

  const existing = getUserSession(user.uid);
  if (!existing || (body.sessionId && body.sessionId !== existing.sessionId)) {
    return NextResponse.json({ error: "沒有作用中的虛擬瀏覽器工作階段" }, { status: 404 });
  }

  try {
    await navigateSteelSession(existing.sessionId, existing.websocketUrl, url);
    touchUserSession(user.uid);
    return NextResponse.json({ ok: true, url });
  } catch (e) {
    console.error("[browser/navigate]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "導向失敗" },
      { status: 502 }
    );
  }
}
