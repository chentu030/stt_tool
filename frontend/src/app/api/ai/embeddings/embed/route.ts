/**
 * POST /api/ai/embeddings/embed
 * Vertex text embeddings (server-only). Used to index notes and embed queries.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAiUser } from "@/lib/aiApiGuard";
import { vertexEmbedTexts, EMBEDDING_DIM, embeddingModelId } from "@/lib/vertexEmbed";

export const runtime = "nodejs";

type Body = {
  texts?: string[];
  text?: string;
  /** RETRIEVAL_DOCUMENT | RETRIEVAL_QUERY */
  taskType?: string;
};

export async function POST(req: NextRequest) {
  const user = await requireAiUser(req);
  if (user instanceof NextResponse) return user;

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "無效的 JSON" }, { status: 400 });
  }

  const texts = (body.texts?.length ? body.texts : body.text ? [body.text] : [])
    .map((t) => String(t || "").trim())
    .filter(Boolean)
    .slice(0, 5);

  if (!texts.length) {
    return NextResponse.json({ error: "缺少 text / texts" }, { status: 400 });
  }

  try {
    const vectors = await vertexEmbedTexts(texts, {
      taskType: body.taskType || "RETRIEVAL_DOCUMENT",
    });
    return NextResponse.json({
      model: embeddingModelId(),
      dim: EMBEDDING_DIM,
      embeddings: vectors,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "embedding 失敗" },
      { status: 500 }
    );
  }
}
