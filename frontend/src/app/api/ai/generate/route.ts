import { NextRequest, NextResponse } from "next/server";
import { vertexConfigStatus, vertexGenerateContent, VertexChatMessage } from "@/lib/vertex";

export const runtime = "nodejs";

type Body = {
  prompt?: string;
  action?:
    | "summarize"
    | "rewrite"
    | "outline"
    | "expand"
    | "actions"
    | "quiz"
    | "explain"
    | "custom"
    | "chat"
    | "library"
    | "note"
    | "improve"
    | "shorten"
    | "continue"
    | "translate"
    | "ask_selection";
  title?: string;
  body?: string;
  context?: string;
  selection?: string;
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
  const selection = data.selection?.trim() || note;

  if (action === "improve") {
    return {
      system: "你是寫作助手。用繁體中文改寫選取文字，更清晰流暢，保留原意與語氣。只輸出改寫後文字，不要解釋。",
      prompt: `請改善以下文字：\n\n${selection}`,
    };
  }
  if (action === "shorten") {
    return {
      system: "你是寫作助手。用繁體中文精簡選取文字，保留關鍵資訊。只輸出精簡後文字。",
      prompt: `請精簡：\n\n${selection}`,
    };
  }
  if (action === "continue") {
    return {
      system: "你是寫作助手。用繁體中文延續選取文字的風格與思路，自然接續。只輸出延續內容，不要重複原文。",
      prompt: `請延續寫下去：\n\n${selection}`,
    };
  }
  if (action === "translate") {
    return {
      system: "你是翻譯助手。若原文是中文則譯成流暢英文；若是其他語言則譯成繁體中文。只輸出譯文。",
      prompt: `請翻譯：\n\n${selection}`,
    };
  }
  if (action === "ask_selection") {
    return {
      system: "你是 Cadence 筆記助手。依使用者問題，針對框選文字作答，使用繁體中文。可給出可直接貼回筆記的 Markdown。",
      prompt: `筆記標題：${title}\n\n框選文字：\n${selection}\n\n${context ? `周圍脈絡：\n${context.slice(0, 2000)}\n\n` : ""}使用者問題：\n${data.prompt?.trim() || "請說明這段在說什麼"}`,
      temperature: 0.55,
    };
  }

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
  if (action === "expand") {
    return {
      system: "你是 Cadence 筆記助手。用繁體中文擴寫，補上例子、解釋與結構，保留原意。只輸出擴寫後的完整 Markdown 正文。",
      prompt: `請擴寫這篇筆記：\n\n標題：${title}\n\n${note}`,
    };
  }
  if (action === "actions") {
    return {
      system: "你是 Cadence 筆記助手。從內容抽出可執行待辦，用 Markdown checklist（- [ ]）。繁體中文，只輸出清單。",
      prompt: `請抽出行動項目：\n\n標題：${title}\n\n${note}`,
    };
  }
  if (action === "quiz") {
    return {
      system: "你是 Cadence 學習助手。依筆記出 5 題複習問答（含簡短答案），繁體中文 Markdown。",
      prompt: `請為以下筆記出測驗題：\n\n標題：${title}\n\n${note}`,
    };
  }
  if (action === "explain") {
    return {
      system: "你是 Cadence 筆記助手。用繁體中文白話解釋整篇重點，像對朋友說明，分段清楚。",
      prompt: `請說明這篇筆記在講什麼：\n\n標題：${title}\n\n${note}`,
    };
  }

  if (action === "chat" || action === "library" || action === "note") {
    const history = (data.messages || []).slice(-12);
    const system = [
      "你是 Cadence 筆記助手。",
      "使用繁體中文回答，具體、可執行。",
      "優先根據提供的筆記內容作答；不要捏造筆記裡沒有的事實。",
      "若使用者要求改寫／插入內容，用 Markdown 清楚標出建議文字。",
      "可用標題、清單、粗體。",
    ].join("");

    const ctxBlock = context || note
      ? `\n\n—— 目前筆記 ——\n標題：${title}\n\n${context || note}\n—— 結束 ——\n`
      : "\n\n（尚未附上筆記內容）\n";

    return {
      system,
      prompt: `${ctxBlock}\n使用者：\n${data.prompt?.trim() || "請幫我理解這篇筆記"}`,
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

    const multi =
      data.action === "chat" || data.action === "library" || data.action === "note";
    const result = await vertexGenerateContent(built.prompt, {
      system: built.system,
      history: built.history,
      temperature: built.temperature,
      maxOutputTokens: multi ? 6144 : 4096,
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
