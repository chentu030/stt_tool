import { NextRequest, NextResponse } from "next/server";
import { vertexConfigStatus } from "@/lib/vertex";
import { resolveAiTextModel } from "@/lib/aiPrefs";
import {
  ClarifyNeededError,
  PlanApprovalNeededError,
  depthConfig,
  runDeepResearch,
  type NoteSnippet,
  type ResearchDepth,
  type ResearchPlan,
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
    pipeline: ["clarify", "plan_approval", "hunt", "analyze", "report"],
    depths: ["standard", "max"],
    defaultModel: "gemini-3.1-pro-preview",
  });
}

function sseEncode(
  event: ResearchProgressEvent | { type: "meta"; model: string; depth: string }
): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function normalizePlan(raw?: ResearchPlan | null): ResearchPlan | undefined {
  if (!raw?.questions?.length) return undefined;
  return {
    title: String(raw.title || "").slice(0, 120),
    angle: String(raw.angle || "").slice(0, 300),
    questions: raw.questions.map(String).filter(Boolean).slice(0, 8),
    keywords: (raw.keywords || []).map(String).filter(Boolean).slice(0, 12),
  };
}

/**
 * Deep Research agent (SSE stream).
 * Body supports plan approval gate + depth modes (Gemini-style standard/max).
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
      depth?: ResearchDepth;
      approvedPlan?: ResearchPlan;
      requirePlanApproval?: boolean;
      assistant?: { model?: string };
    };

    const topic = (data.topic || "").trim();
    if (!topic) {
      return NextResponse.json({ error: "請輸入研究主題" }, { status: 400 });
    }
    if (topic.length > 2000) {
      return NextResponse.json({ error: "主題過長（最多 2000 字）" }, { status: 400 });
    }

    const depth: ResearchDepth = data.depth === "max" ? "max" : "standard";
    const cfg = depthConfig(depth);
    const researchModel = resolveResearchModel(data.model || data.assistant?.model);
    const approvedPlan = normalizePlan(data.approvedPlan);
    const libraryNotes = (data.libraryNotes || [])
      .filter((n) => n?.id && n?.title)
      .slice(0, 40)
      .map((n) => ({
        id: String(n.id),
        title: String(n.title).slice(0, 200),
        excerpt: String(n.excerpt || "").slice(0, 1200),
        updatedAt: n.updatedAt ? String(n.updatedAt) : undefined,
      }));

    const runOpts = {
      model: researchModel,
      context: data.context?.trim() || undefined,
      libraryNotes,
      skipClarify: !!data.skipClarify || !!approvedPlan,
      clarifyAnswers: data.clarifyAnswers?.trim() || undefined,
      approvedPlan,
      requirePlanApproval: approvedPlan ? false : data.requirePlanApproval !== false,
      depth,
      maxQuestions: Math.min(
        8,
        Math.max(3, data.maxQuestions || cfg.maxQuestions)
      ),
      maxRetries: cfg.maxRetries,
    };

    const stream = data.stream !== false;

    if (!stream) {
      try {
        const report = await runDeepResearch(topic, runOpts);
        return NextResponse.json({ ...report, model: researchModel, depth });
      } catch (e) {
        if (e instanceof ClarifyNeededError) {
          return NextResponse.json({
            needClarify: true,
            questions: e.questions,
            assumedIntent: e.assumedIntent,
            model: researchModel,
            depth,
          });
        }
        if (e instanceof PlanApprovalNeededError) {
          return NextResponse.json({
            needPlanApproval: true,
            plan: e.plan,
            intent: e.intent,
            model: researchModel,
            depth,
          });
        }
        throw e;
      }
    }

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        const send = (
          event: ResearchProgressEvent | { type: "meta"; model: string; depth: string }
        ) => {
          controller.enqueue(encoder.encode(sseEncode(event)));
        };

        try {
          send({ type: "meta", model: researchModel, depth });
          await runDeepResearch(topic, {
            ...runOpts,
            onProgress: (e) => send(e),
          });
        } catch (e) {
          if (
            e instanceof ClarifyNeededError ||
            e instanceof PlanApprovalNeededError
          ) {
            // already streamed via onProgress
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
