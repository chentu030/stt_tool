/** Server-side guard for /api/ai/* — Firebase ID token + access + rate limit. */

import { NextRequest, NextResponse } from "next/server";
import { firebaseConfig } from "@/lib/firebasePublic";
import { isAllowlistedEmail, normalizeEmail } from "@/lib/accessGate";

export type AiUser = { uid: string; email: string };

type LookupResponse = {
  users?: Array<{ localId?: string; email?: string }>;
};

const g = globalThis as unknown as {
  __albireusAiRate?: Map<string, number[]>;
};

function rateMap(): Map<string, number[]> {
  if (!g.__albireusAiRate) g.__albireusAiRate = new Map();
  return g.__albireusAiRate;
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
    const data = (await res.json()) as LookupResponse;
    const u = data.users?.[0];
    if (!u?.localId) return null;
    return { uid: u.localId, email: u.email };
  } catch {
    return null;
  }
}

/** Soft per-uid limit so quota burn is harder; normal usage stays smooth. */
export function checkAiRateLimit(uid: string, maxPerMin = 45): boolean {
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

async function isAccessApproved(uid: string, idToken: string): Promise<boolean> {
  try {
    const url = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
      firebaseConfig.projectId
    )}/databases/(default)/documents/access_requests/${encodeURIComponent(uid)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${idToken}` },
      cache: "no-store",
    });
    if (!res.ok) return false;
    const data = (await res.json()) as {
      fields?: { status?: { stringValue?: string } };
    };
    return data.fields?.status?.stringValue === "approved";
  } catch {
    return false;
  }
}

/**
 * Require a signed-in, approved (or allowlisted) user for AI routes.
 * Returns AiUser on success, or a ready-to-return NextResponse on failure.
 */
export async function requireAiUser(req: NextRequest): Promise<AiUser | NextResponse> {
  const auth = req.headers.get("authorization") || "";
  const idToken = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!idToken) {
    return NextResponse.json({ error: "請先登入後再使用 AI" }, { status: 401 });
  }

  const user = await verifyFirebaseIdToken(idToken);
  if (!user?.uid) {
    return NextResponse.json({ error: "登入已過期，請重新登入" }, { status: 401 });
  }

  const email = normalizeEmail(user.email);
  if (!email) {
    return NextResponse.json({ error: "帳號缺少信箱，無法使用 AI" }, { status: 403 });
  }

  if (!checkAiRateLimit(user.uid)) {
    return NextResponse.json({ error: "AI 請求過於頻繁，請稍候再試" }, { status: 429 });
  }

  const allowed = isAllowlistedEmail(email) || (await isAccessApproved(user.uid, idToken));
  if (!allowed) {
    return NextResponse.json({ error: "尚未通過使用申請，暫無法使用 AI" }, { status: 403 });
  }

  return { uid: user.uid, email };
}
