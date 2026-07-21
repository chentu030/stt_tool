import { NextRequest, NextResponse } from "next/server";
import {
  clipSteelSession,
  getUserSession,
  isSteelConfigured,
  touchUserSession,
  verifyFirebaseIdToken,
} from "@/lib/steelBrowser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

  const body = (await req.json().catch(() => ({}))) as { sessionId?: string };
  const existing = getUserSession(user.uid);
  if (!existing || (body.sessionId && body.sessionId !== existing.sessionId)) {
    return NextResponse.json({ error: "沒有作用中的虛擬瀏覽器工作階段" }, { status: 404 });
  }

  try {
    const clip = await clipSteelSession(existing.sessionId, existing.websocketUrl);
    touchUserSession(user.uid);
    return NextResponse.json(clip);
  } catch (e) {
    console.error("[browser/clip]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "擷取失敗" },
      { status: 502 }
    );
  }
}
