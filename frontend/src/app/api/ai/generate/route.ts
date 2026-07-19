import { NextRequest, NextResponse } from "next/server";
import { vertexConfigStatus, vertexGenerateContent } from "@/lib/vertex";

export const runtime = "nodejs";

type Body = {
  prompt?: string;
  action?: "summarize" | "rewrite" | "outline" | "custom";
  title?: string;
  body?: string;
};

function buildPrompt(data: Body): { system: string; prompt: string } {
  const title = data.title?.trim() || "未命名筆記";
  const note = data.body?.trim() || "";
  const action = data.action || "custom";

  if (action === "summarize") {
    return {
      system: "你是 Cadence 筆記助手。用繁體中文輸出，精簡條列重點，不要廢話。",
      prompt: `請摘要以下筆記：\n\n標題：${title}\n\n${note}`,
    };
  }
  if (action === "rewrite") {
    return {
      system: "你是 Cadence 筆記助手。用繁體中文改寫，保留原意，讓文字更清晰、可讀。只輸出改寫後正文。",
      prompt: `請改寫：\n\n標題：${title}\n\n${note}`,
    };
  }
  if (action === "outline") {
    return {
      system: "你是 Cadence 筆記助手。用繁體中文產出 Markdown 大綱（# / ## / -），適合之後做成簡報。",
      prompt: `請依內容產出簡報大綱：\n\n標題：${title}\n\n${note}`,
    };
  }

  return {
    system: "你是 Cadence 筆記助手，使用繁體中文。",
    prompt: data.prompt?.trim() || note || "你好",
  };
}

export async function GET() {
  return NextResponse.json(vertexConfigStatus());
}

export async function POST(req: NextRequest) {
  try {
    const data = (await req.json()) as Body;
    const { system, prompt } = buildPrompt(data);
    if (!prompt.trim()) {
      return NextResponse.json({ error: "缺少內容" }, { status: 400 });
    }

    const result = await vertexGenerateContent(prompt, { system });
    return NextResponse.json({
      text: result.text,
      model: result.model,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
