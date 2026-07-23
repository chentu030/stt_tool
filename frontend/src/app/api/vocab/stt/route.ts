import { NextRequest, NextResponse } from "next/server";
import { requireAiUser, type AiUser } from "@/lib/aiApiGuard";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Proxy Cloud Run Google STT for vocab BYOK listen uploads. */
function apiBase(): string {
  const raw = (process.env.NEXT_PUBLIC_API_BASE || "").trim();
  if (raw) return raw.replace(/^http:\/\//i, "https://").replace(/\/$/, "");
  return "";
}

export async function POST(req: NextRequest) {
  const gate = await requireAiUser(req);
  if (gate instanceof NextResponse) return gate;
  void (gate as AiUser);

  const base = apiBase();
  if (!base) {
    return NextResponse.json({ error: "尚未設定 NEXT_PUBLIC_API_BASE" }, { status: 503 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "無效的表單資料" }, { status: 400 });
  }

  try {
    const res = await fetch(`${base}/stt/google`, { method: "POST", body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail =
        typeof (data as { detail?: unknown }).detail === "string"
          ? (data as { detail: string }).detail
          : `Google STT 失敗 (${res.status})`;
      return NextResponse.json({ error: detail }, { status: res.status });
    }
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "STT 代理失敗" },
      { status: 502 }
    );
  }
}
