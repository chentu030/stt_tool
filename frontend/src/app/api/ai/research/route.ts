import { NextRequest, NextResponse } from "next/server";
import { vertexConfigStatus } from "@/lib/vertex";
import { resolveAiTextModel } from "@/lib/aiPrefs";
import {
  ClarifyNeededError,
  runDeepResearch,
  type NoteSnippet,
  type ResearchProgressEvent,
} from "@/lib/deepResearch";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Prefer Gemini 3.1 Pro as the research "brain"; never fall back to 1.x. */
function resolveResearchModel(preferred?: string | null): string {
  const model = resolveAiTextModel(preferred);
  if (model.includes("lite") || model.includes("flash")) {
    return "gemini-3.1-pro-preview";
  }
  if (!model.startsWith("gemini-3")) {
    return "gemini-3.1-pro-preview";
  }
  return model;
}

export async function GET() {
  return NextResponse.json({
    ...vertexConfigStatus(),
    feature: "deep_research_agent",
    pipeline: ["clarify", "plan", "hunt", "analyze", "report"],
    defaultModel: "gemini-3.1-pro-preview",
  });
}

function sseEncode(event: ResearchProgressEvent | { type: "meta"; model: string }): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Deep Research agent (SSE stream).
 * Body: {
 *   topic, context?, model?, maxQuestions?,
 *   skipClarify?, clarifyAnswers?,
 *   libraryNotes?: NoteSnippet[],
 *   stream?: boolean  // default true
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const data = (await req.json()) as {
      topic?: string;
      context?: string;
      model?: string;
      maxQuestions?: number;
      skipClarify?: boolean;
      clarifyAnswers?: string;
      libraryNotes?: NoteSnippet[];
      stream?: boolean;
      assistant?: { model?: string };
    };

    const topic = (data.topic || "").trim();
    if (!topic) {
      return NextResponse.json({ error: "請輸入研究主題" }, { status: 400 });
    }
    if (topic.length > 2000) {
      return NextResponse.json({ error: "主題過長（最多 2000 字）" }, { status: 400 });
    }

    const researchModel = resolveResearchModel(data.model || data.assistant?.model);
    const libraryNotes = (data.libraryNotes || [])
      .filter((n) => n?.id && n?.title)
      .slice(0, 40)
      .map((n) => ({
        id: String(n.id),
        title: String(n.title).slice(0, 200),
        excerpt: String(n.excerpt || "").slice(0, 1200),
        updatedAt: n.updatedAt ? String(n.updatedAt) : undefined,
      }));

    const stream = data.stream !== false;

    if (!stream) {
      try {
        const report = await runDeepResearch(topic, {
          model: researchModel,
          context: data.context?.trim() || undefined,
          libraryNotes,
          skipClarify: !!data.skipClarify,
          clarifyAnswers: data.clarifyAnswers?.trim() || undefined,
          maxQuestions: Math.min(7, Math.max(3, data.maxQuestions || 6)),
        });
        return NextResponse.json({ ...report, model: researchModel });
      } catch (e) {
        if (e instanceof ClarifyNeededError) {
          return NextResponse.json({
            needClarify: true,
            questions: e.questions,
            assumedIntent: e.assumedIntent,
            model: researchModel,
          });
        }
        throw e;
      }
    }

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        const send = (event: ResearchProgressEvent | { type: "meta"; model: string }) => {
          controller.enqueue(encoder.encode(sseEncode(event)));
        };

        try {
          send({ type: "meta", model: researchModel });
          await runDeepResearch(topic, {
            model: researchModel,
            context: data.context?.trim() || undefined,
            libraryNotes,
            skipClarify: !!data.skipClarify,
            clarifyAnswers: data.clarifyAnswers?.trim() || undefined,
            maxQuestions: Math.min(7, Math.max(3, data.maxQuestions || 6)),
            onProgress: (e) => send(e),
          });
        } catch (e) {
          if (e instanceof ClarifyNeededError) {
            // clarify event already streamed via onProgress
          } else {
            const message = e instanceof Error ? e.message : String(e);
            send({ type: "error", message });
          }
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
