import { NextRequest, NextResponse } from "next/server";
import {
  checkCreateRateLimit,
  createSteelSession,
  isSteelConfigured,
  verifyFirebaseIdToken,
} from "@/lib/steelBrowser";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function requireUid(req: NextRequest): Promise<string | NextResponse> {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) {
    return NextResponse.json({ error: "請先登入" }, { status: 401 });
  }
  const user = await verifyFirebaseIdToken(token);
  if (!user) {
    return NextResponse.json({ error: "登入已失效，請重新登入" }, { status: 401 });
  }
  return user.uid;
}

/** GET — whether virtual browser is configured */
export async function GET() {
  return NextResponse.json({
    configured: isSteelConfigured(),
    hint: isSteelConfigured()
      ? "虛擬瀏覽器已啟用"
      : "尚未設定 STEEL_BASE_URL（自架）或 STEEL_API_KEY（Steel Cloud）",
  });
}

/** POST — create (or replace) a Steel session for this user */
export async function POST(req: NextRequest) {
  if (!isSteelConfigured()) {
    return NextResponse.json(
      {
        error:
          "虛擬瀏覽器未啟用：請設定 STEEL_BASE_URL（GCE 自架）或 STEEL_API_KEY（steel.dev）",
        configured: false,
      },
      { status: 503 }
    );
  }

  const uidOrErr = await requireUid(req);
  if (uidOrErr instanceof NextResponse) return uidOrErr;
  const uid = uidOrErr;

  if (!checkCreateRateLimit(uid)) {
    return NextResponse.json({ error: "建立太頻繁，請稍候再試" }, { status: 429 });
  }

  let body: { url?: string } = {};
  try {
    body = (await req.json()) as { url?: string };
  } catch {
    body = {};
  }

  const startUrl = typeof body.url === "string" ? body.url.trim() : "";
  try {
    const session = await createSteelSession(uid, startUrl || undefined);
    return NextResponse.json({
      configured: true,
      ...session,
      privacy:
        "虛擬瀏覽器在遠端 Chromium 執行（自架 GCE 或 Steel Cloud）；登入 Cookie 存在該工作階段，閒置約 10 分鐘會釋放。",
    });
  } catch (e) {
    console.error("[browser/session]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "無法建立虛擬瀏覽器" },
      { status: 502 }
    );
  }
}

/** DELETE — release this user's session */
export async function DELETE(req: NextRequest) {
  const uidOrErr = await requireUid(req);
  if (uidOrErr instanceof NextResponse) return uidOrErr;
  const uid = uidOrErr;

  const { clearUserSession, getUserSession, releaseSteelSession } = await import(
    "@/lib/steelBrowser"
  );
  const existing = getUserSession(uid);
  if (existing) {
    await releaseSteelSession(existing.sessionId);
    clearUserSession(uid);
  }
  return NextResponse.json({ ok: true });
}
