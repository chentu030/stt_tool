import { NextRequest, NextResponse } from "next/server";
import { vertexConfigStatus } from "@/lib/vertex";
import { resolveAiTextModel } from "@/lib/aiPrefs";
import { runDeepResearch } from "@/lib/deepResearch";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  return NextResponse.json({
    ...vertexConfigStatus(),
    feature: "deep_research",
    pipeline: ["plan", "gather", "synthesize"],
  });
}

/**
 * Deep research: Plan → grounded multi-query gather → cited report.
 * Body: { topic, context?, model?, maxQuestions? }
 */
export async function POST(req: NextRequest) {
  try {
    const data = (await req.json()) as {
      topic?: string;
      context?: string;
      model?: string;
      maxQuestions?: number;
      assistant?: { model?: string };
    };
    const topic = (data.topic || "").trim();
    if (!topic) {
      return NextResponse.json({ error: "請輸入研究主題" }, { status: 400 });
    }
    if (topic.length > 2000) {
      return NextResponse.json({ error: "主題過長（最多 2000 字）" }, { status: 400 });
    }

    const model = resolveAiTextModel(data.model || data.assistant?.model);
    // Prefer Pro for research depth when user didn't pin a lite model
    const researchModel =
      model.includes("lite") || model.includes("flash")
        ? "gemini-3.1-pro-preview"
        : model;

    const steps: { phase: string; detail: string }[] = [];
    const report = await runDeepResearch(topic, {
      model: researchModel,
      context: data.context?.trim() || undefined,
      maxQuestions: Math.min(6, Math.max(3, data.maxQuestions || 5)),
      onProgress: (e) => {
        if (e.type === "phase") steps.push({ phase: e.phase, detail: e.detail });
        if (e.type === "question") {
          steps.push({
            phase: "gather",
            detail: `子問題 ${e.index}/${e.total}：${e.question}`,
          });
        }
      },
    });

    return NextResponse.json({
      ...report,
      model: researchModel,
      steps,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
