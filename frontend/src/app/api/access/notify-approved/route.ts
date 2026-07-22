import { NextRequest, NextResponse } from "next/server";
import { firebaseConfig } from "@/lib/firebasePublic";
import { ACCESS_ALLOWLIST, normalizeEmail } from "@/lib/accessGate";
import {
  ACCESS_APPROVED_FROM,
  ACCESS_APPROVED_REPLY_TO,
  accessApprovedHtml,
  accessApprovedSubject,
  accessApprovedText,
} from "@/lib/accessApprovedEmail";

export const runtime = "nodejs";

type LookupResponse = {
  users?: Array<{ localId?: string; email?: string; emailVerified?: boolean }>;
  error?: { message?: string };
};

async function verifyFirebaseIdToken(idToken: string): Promise<{
  uid: string;
  email: string;
} | null> {
  const key = firebaseConfig.apiKey;
  if (!key || !idToken) return null;
  try {
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      }
    );
    const data = (await res.json()) as LookupResponse;
    const u = data.users?.[0];
    if (!u?.localId || !u.email) return null;
    return { uid: u.localId, email: normalizeEmail(u.email) };
  } catch {
    return null;
  }
}

function isAllowlisted(email: string): boolean {
  return (ACCESS_ALLOWLIST as readonly string[]).includes(normalizeEmail(email));
}

export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get("authorization") || "";
    const idToken = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!idToken) {
      return NextResponse.json({ error: "缺少登入憑證" }, { status: 401 });
    }

    const actor = await verifyFirebaseIdToken(idToken);
    if (!actor || !isAllowlisted(actor.email)) {
      return NextResponse.json({ error: "沒有核准權限" }, { status: 403 });
    }

    const body = (await req.json()) as {
      toEmail?: string;
      displayName?: string;
    };
    const toEmail = normalizeEmail(body.toEmail);
    if (!toEmail || !toEmail.includes("@")) {
      return NextResponse.json({ error: "收件信箱無效" }, { status: 400 });
    }

    const apiKey = process.env.RESEND_API_KEY || "";
    if (!apiKey) {
      return NextResponse.json(
        {
          error: "尚未設定 RESEND_API_KEY",
          hint: "在 Cloudflare / Vercel 環境變數加入 RESEND_API_KEY，並於 Resend 驗證 support@albireus.com",
          preview: {
            from: ACCESS_APPROVED_FROM,
            subject: accessApprovedSubject(),
            text: accessApprovedText(body.displayName),
          },
        },
        { status: 503 }
      );
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: ACCESS_APPROVED_FROM,
        reply_to: ACCESS_APPROVED_REPLY_TO,
        to: [toEmail],
        subject: accessApprovedSubject(),
        text: accessApprovedText(body.displayName),
        html: accessApprovedHtml(body.displayName),
      }),
    });

    const data = (await res.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
      error?: { message?: string };
    };

    if (!res.ok) {
      return NextResponse.json(
        {
          error: data.error?.message || data.message || `寄信失敗（${res.status}）`,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true, id: data.id || null });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "寄信失敗" },
      { status: 500 }
    );
  }
}
