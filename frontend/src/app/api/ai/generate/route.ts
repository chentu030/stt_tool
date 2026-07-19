import { NextRequest, NextResponse } from "next/server";
import { vertexConfigStatus, vertexGenerateContent, VertexChatMessage } from "@/lib/vertex";

export const runtime = "nodejs";

type Body = {
  prompt?: string;
  action?: "summarize" | "rewrite" | "outline" | "custom" | "chat" | "library";
  title?: string;
  body?: string;
  /** Extra context (e.g. packed library notes) */
  context?: string;
  messages?: VertexChatMessage[];
};

function buildPrompt(data: Body): {
  system: string;
  prompt: string;
  history?: VertexChatMessage[];
  temperature?: number;
} {
  const title = data.title?.trim() || "未命名筆記";
  const note = data.body?.trim() || "";
  const action = data.action || "custom";
  const context = data.context?.trim() || "";

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

  if (action === "chat" || action === "library") {
    const history = (data.messages || []).slice(-12);
    const system = [
      "你是 Cadence 知識庫助手。",
      "使用繁體中文回答，具體、可執行，優先引用使用者知識庫內容。",
      "若上下文有筆記，回答時可標出相關筆記標題；不要捏造不存在的筆記。",
      "若資訊不足，清楚說明缺什麼，並建議使用者該補哪些筆記。",
      "可用 Markdown（標題、清單、粗體）。",
    ].join("");

    const ctxBlock = context
      ? `\n\n—— 知識庫上下文 ——\n${context}\n—— 結束 ——\n`
      : "\n\n（目前沒有附上筆記上下文；請依對話與常識協助，並提醒可先選取筆記。）\n";

    return {
      system,
      prompt: `${ctxBlock}\n使用者問題：\n${data.prompt?.trim() || "請幫我了解我的知識庫"}`,
      history,
      temperature: 0.55,
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
    const built = buildPrompt(data);
    if (!built.prompt.trim()) {
      return NextResponse.json({ error: "缺少內容" }, { status: 400 });
    }

    const result = await vertexGenerateContent(built.prompt, {
      system: built.system,
      history: built.history,
      temperature: built.temperature,
      maxOutputTokens: data.action === "chat" || data.action === "library" ? 6144 : 4096,
    });
    return NextResponse.json({
      text: result.text,
      model: result.model,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
