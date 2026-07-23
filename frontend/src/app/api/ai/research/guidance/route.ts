import { NextRequest, NextResponse } from "next/server";
import {
  createResearchRunId,
  ensureResearchRun,
  endResearchRun,
  pushResearchGuidance,
} from "@/lib/researchRunStore";
import { requireAiUser } from "@/lib/aiApiGuard";

export const runtime = "nodejs";

/** Inject mid-run guidance into an active deep research SSE run */
export async function POST(req: NextRequest) {
  try {
    const gate = await requireAiUser(req);
    if (gate instanceof NextResponse) return gate;

    const data = (await req.json()) as { runId?: string; text?: string };
    const runId = (data.runId || "").trim();
    const text = (data.text || "").trim();
    if (!runId || !text) {
      return NextResponse.json({ error: "需要 runId 與 text" }, { status: 400 });
    }
    ensureResearchRun(runId);
    const ok = pushResearchGuidance(runId, text);
    return NextResponse.json({ ok, runId });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    feature: "research_guidance",
    hint: "POST { runId, text } while a research SSE is running",
  });
}

export { createResearchRunId, endResearchRun };
