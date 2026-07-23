import { NextRequest, NextResponse } from "next/server";
import { requireAiUser, type AiUser } from "@/lib/aiApiGuard";
import {
  VOCAB_QUOTA_LIMITS,
  canConsumeQuota,
  emptyVocabQuota,
  isVocabUnlimitedEmail,
  remainingQuota,
  type VocabQuotaKind,
} from "@/lib/vocabQuota";
import { readVocabQuota, writeVocabQuota } from "@/lib/vocabQuotaStore";

export const runtime = "nodejs";

function bearer(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

export async function GET(req: NextRequest) {
  const gate = await requireAiUser(req);
  if (gate instanceof NextResponse) return gate;
  const user = gate as AiUser;
  const idToken = bearer(req);

  try {
    const usage = await readVocabQuota(user.uid, idToken);
    const unlimited = isVocabUnlimitedEmail(user.email);
    return NextResponse.json({
      usage,
      limits: VOCAB_QUOTA_LIMITS,
      remaining: {
        words: unlimited ? null : remainingQuota(usage, "words"),
        videos: unlimited ? null : remainingQuota(usage, "videos"),
        voice: unlimited ? null : remainingQuota(usage, "voice"),
      },
      unlimited,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "配額讀取失敗" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireAiUser(req);
  if (gate instanceof NextResponse) return gate;
  const user = gate as AiUser;
  const idToken = bearer(req);

  let body: { kind?: string; amount?: number; skip?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "無效 JSON" }, { status: 400 });
  }

  if (body.skip) {
    return NextResponse.json({ ok: true, skipped: true, unlimited: true });
  }

  const kind = body.kind as VocabQuotaKind;
  if (!kind || !(kind in VOCAB_QUOTA_LIMITS)) {
    return NextResponse.json({ error: "無效的配額類型" }, { status: 400 });
  }
  const amount = Math.max(1, Math.min(100, Math.floor(Number(body.amount) || 1)));

  if (isVocabUnlimitedEmail(user.email)) {
    return NextResponse.json({
      ok: true,
      unlimited: true,
      usage: emptyVocabQuota(),
      remaining: null,
    });
  }

  try {
    const usage = await readVocabQuota(user.uid, idToken);
    if (!canConsumeQuota(usage, kind, amount, user.email)) {
      return NextResponse.json(
        {
          error: "免費額度已用完",
          code: "QUOTA_EXCEEDED",
          kind,
          usage,
          limits: VOCAB_QUOTA_LIMITS,
          hint: "請在設定填入自己的 Gemini API 金鑰後繼續使用（將改走 Google AI 通道）。",
        },
        { status: 402 }
      );
    }
    const next = { ...usage, [kind]: (usage[kind] || 0) + amount };
    await writeVocabQuota(user.uid, idToken, next);
    return NextResponse.json({
      ok: true,
      usage: next,
      remaining: {
        words: remainingQuota(next, "words"),
        videos: remainingQuota(next, "videos"),
        voice: remainingQuota(next, "voice"),
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "配額更新失敗" },
      { status: 500 }
    );
  }
}
