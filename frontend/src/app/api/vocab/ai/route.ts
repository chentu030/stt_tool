import { NextRequest, NextResponse } from "next/server";
import { requireAiUser, type AiUser } from "@/lib/aiApiGuard";
import { getVertexApiKeys } from "@/lib/vertex";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Proxy Gemini generateContent for vocab iframe.
 * - No user key → Vertex (aiplatform) with VERTEX_API_KEYS
 * - X-User-Gemini-Key → Google AI (generativelanguage)
 */

function userGeminiKey(req: NextRequest): string {
  return (req.headers.get("x-user-gemini-key") || "").trim();
}

function vertexUrl(model: string): string {
  const location = process.env.VERTEX_LOCATION || "global";
  const project = process.env.VERTEX_PROJECT_ID?.trim();
  if (project) {
    return `https://aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;
  }
  return `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:generateContent`;
}

function geminiDevUrl(model: string, key: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
}

export async function POST(req: NextRequest) {
  const gate = await requireAiUser(req);
  if (gate instanceof NextResponse) return gate;
  void (gate as AiUser);

  let payload: {
    model?: string;
    body?: Record<string, unknown>;
  };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "無效 JSON" }, { status: 400 });
  }

  const model = (payload.model || process.env.VERTEX_MODEL || "gemini-3-flash-preview").trim();
  const body = payload.body;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "缺少 body" }, { status: 400 });
  }

  const ownKey = userGeminiKey(req);
  if (ownKey) {
    // User-provided Gemini Developer API key
    try {
      const res = await fetch(geminiDevUrl(model, ownKey), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return NextResponse.json(
          { error: data?.error?.message || `Gemini 錯誤 (${res.status})`, channel: "gemini" },
          { status: res.status }
        );
      }
      return NextResponse.json({ ...data, channel: "gemini" });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Gemini 請求失敗", channel: "gemini" },
        { status: 502 }
      );
    }
  }

  const keys = getVertexApiKeys();
  if (!keys.length) {
    return NextResponse.json(
      { error: "伺服端尚未設定 VERTEX_API_KEYS", channel: "vertex" },
      { status: 503 }
    );
  }

  const url = vertexUrl(model);
  let lastError = "unknown";
  for (let i = 0; i < keys.length; i++) {
    const apiKey = keys[i];
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        lastError = data?.error?.message || `${res.status}`;
        if ([401, 403, 429, 500, 503].includes(res.status)) continue;
        return NextResponse.json(
          { error: lastError, channel: "vertex" },
          { status: res.status }
        );
      }
      return NextResponse.json({ ...data, channel: "vertex" });
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }

  return NextResponse.json(
    { error: lastError || "Vertex 全部金鑰失敗", channel: "vertex" },
    { status: 502 }
  );
}
