import { NextRequest, NextResponse } from "next/server";
import { vertexConfigStatus, vertexGenerateContent, VertexChatMessage } from "@/lib/vertex";
import {
  assistantSystemPrefix,
  resolveAiTextModel,
  AI_TEXT_MODELS,
  appendGroundingSources,
} from "@/lib/aiPrefs";

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
    | "ask_selection"
    | "draft_meeting"
    | "draft_email"
    | "draft_outline"
    | "write_anything"
    | "make_table"
    | "make_mermaid"
    | "meeting_pack"
    | "journal_review"
    | "board_scaffold"
    | "canvas";
  title?: string;
  canvasSummary?: string;
  selectedIds?: string[];
  body?: string;
  context?: string;
  selection?: string;
  messages?: VertexChatMessage[];
  model?: string;
  grounding?: boolean;
  assistant?: {
    name?: string;
    style?: "concise" | "balanced" | "detailed";
    model?: string;
    grounding?: boolean;
  };
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
  const noteBlock = context || (note ? `標題：${title}\n\n${note}` : `標題：${title}`);
  const asst = assistantSystemPrefix({
    ...data.assistant,
    grounding: data.assistant?.grounding ?? data.grounding,
  });

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
      system: "你是 Albireus 筆記助手。依使用者問題，針對框選文字作答，使用繁體中文。可給出可直接貼回筆記的 Markdown。",
      prompt: `${context ? `${context}\n\n` : ""}筆記標題：${title}\n\n框選文字：\n${selection}\n\n使用者問題：\n${data.prompt?.trim() || "請說明這段在說什麼"}`,
      temperature: 0.55,
    };
  }

  if (action === "summarize") {
    return {
      system: "你是 Albireus 筆記助手。用繁體中文輸出，精簡條列重點，不要廢話。",
      prompt: `請摘要以下筆記：\n\n${noteBlock}`,
    };
  }
  if (action === "rewrite") {
    return {
      system: "你是 Albireus 筆記助手。用繁體中文改寫，保留原意，讓文字更清晰、可讀。只輸出改寫後正文。",
      prompt: `請改寫：\n\n${noteBlock}`,
    };
  }
  if (action === "outline") {
    return {
      system: "你是 Albireus 筆記助手。用繁體中文產出 Markdown 大綱（# / ## / -），適合之後做成簡報。",
      prompt: `請依內容產出簡報大綱：\n\n${noteBlock}`,
    };
  }
  if (action === "expand") {
    return {
      system: "你是 Albireus 筆記助手。用繁體中文擴寫，補上例子、解釋與結構，保留原意。只輸出擴寫後的完整 Markdown 正文。",
      prompt: `請擴寫這篇筆記：\n\n${noteBlock}`,
    };
  }
  if (action === "actions") {
    return {
      system: "你是 Albireus 筆記助手。從內容抽出可執行待辦，用 Markdown checklist（- [ ]）。繁體中文，只輸出清單。",
      prompt: `請抽出行動項目：\n\n${noteBlock}`,
    };
  }
  if (action === "quiz") {
    return {
      system: "你是 Albireus 學習助手。依筆記出 5 題複習問答（含簡短答案），繁體中文 Markdown。",
      prompt: `請為以下筆記出測驗題：\n\n${noteBlock}`,
    };
  }
  if (action === "explain") {
    return {
      system: "你是 Albireus 筆記助手。用繁體中文白話解釋整篇重點，像對朋友說明，分段清楚。",
      prompt: `請說明這篇筆記在講什麼：\n\n${noteBlock}`,
    };
  }

  if (action === "draft_meeting") {
    return {
      system: "你是 Albireus 會議助手。用繁體中文產出完整會議紀錄 Markdown（出席、議程、討論、決議、待辦 checklist）。可直接貼入筆記。",
      prompt: `${data.prompt?.trim() || "產出會議紀錄草稿"}\n\n${noteBlock}`,
    };
  }
  if (action === "draft_email") {
    return {
      system: "你是 Albireus 寫作助手。用繁體中文產出信件草稿（先給主旨建議，再給正文）。語氣專業清楚。",
      prompt: `${data.prompt?.trim() || "產出信件草稿"}\n\n${noteBlock}`,
    };
  }
  if (action === "draft_outline") {
    return {
      system: "你是 Albireus 簡報助手。用繁體中文產出 ## 標題層級的簡報大綱，每張投影片簡短要點。",
      prompt: `${data.prompt?.trim() || "產出簡報大綱"}\n\n${noteBlock}`,
    };
  }
  if (action === "write_anything") {
    return {
      system: "你是 Albireus 寫作助手。依使用者指示撰寫繁體中文 Markdown，可直接插入筆記。只輸出正文。",
      prompt: `指示：${data.prompt?.trim() || "寫一段有用的內容"}\n\n參考脈絡：\n${noteBlock}`,
    };
  }
  if (action === "make_table") {
    return {
      system: "你是 Albireus 筆記助手。只輸出一個 Markdown 表格（含表頭），繁體中文，不要其他說明。",
      prompt: `${data.prompt?.trim() || "整理成表格"}\n\n${noteBlock}`,
    };
  }
  if (action === "make_mermaid") {
    return {
      system: "你是 Albireus 筆記助手。只輸出一個 ```mermaid 程式碼區塊（flowchart TD 或類似），節點文字用繁體中文。",
      prompt: `${data.prompt?.trim() || "畫流程圖"}\n\n${noteBlock}`,
    };
  }
  if (action === "meeting_pack") {
    return {
      system: `${asst}你是會議助手。依逐字稿／筆記產出：1) 摘要 2) 決議 3) 待辦 checklist 4) 會後跟進。繁體中文 Markdown。`,
      prompt: `請產出會議整理包：\n\n${noteBlock}`,
    };
  }
  if (action === "journal_review") {
    return {
      system: `${asst}你是日誌復盤助手。根據多日日誌產出：本月亮點、挑戰、情緒／能量趨勢、學習、下月 3–5 個具體行動建議。繁體中文 Markdown，可直接存成筆記。`,
      prompt: `${data.prompt?.trim() || "請做月度復盤"}\n\n${noteBlock}`,
      temperature: 0.55,
    };
  }
  if (action === "board_scaffold") {
    return {
      system: `${asst}你是看板規劃助手。依使用者描述，輸出 JSON 陣列（不要 markdown 圍籬），每項：{"title":"...","status":"backlog"|"doing"|"done","priority":"urgent"|"high"|"normal"|"low","due":"YYYY-MM-DD或空字串","body":"簡短說明"}。最多 12 張卡。`,
      prompt: `請規劃看板卡片：\n${data.prompt?.trim() || "一個個人專案看板"}\n\n可參考脈絡：\n${noteBlock}`,
      temperature: 0.4,
    };
  }

  if (action === "canvas") {
    return {
      system: `${asst}你是 Albireus 白板助手。你會收到畫布 JSON（items、edges、noteCatalog、selectedIds）。用繁體中文回覆。
必須回傳單一 JSON 物件（可包在 markdown code fence）：
{"message":"給使用者看的說明與建議","ops":[...]}
ops 可用：
- {"op":"add_sticky","text":"...","x":number,"y":number,"color":"yellow"|"mint"|"sky"|"rose"|"violet"|"sand"}
- {"op":"add_shape","shape":"rect"|"ellipse"|"frame","label":"...","x":n,"y":n,"w":n,"h":n}
- {"op":"update","id":"現有id","text":"...","label":"...","x":n,"y":n}
- {"op":"delete","id":"現有id"}
- {"op":"connect","from":"id","to":"id"}
- {"op":"pin_note","noteId":"必須來自 noteCatalog","x":n,"y":n}
規則：不要捏造 noteId；刪除要謹慎；一次最多 12 個 ops；座標以現有物件附近為佳；若只需建議可不給 ops。`,
      prompt: `畫布狀態：\n${data.canvasSummary || "{}"}\n\n選取：${JSON.stringify(data.selectedIds || [])}\n\n使用者：\n${data.prompt?.trim() || "請分析這張白板並給建議"}`,
      temperature: 0.45,
    };
  }

  if (action === "chat" || action === "library" || action === "note") {
    const history = (data.messages || []).slice(-12);
    const system = [
      asst,
      "優先根據提供的筆記／知識庫脈絡作答；不要捏造沒有的事實。",
      "若使用者要求改寫／插入內容，用 Markdown 清楚標出建議文字。",
      "可用標題、清單、粗體、表格。",
      "提到具體筆記時，盡量附上路徑如 /notes/ID。",
    ].join("");

    const ctxBlock = context || note
      ? `\n\n${context || `—— 目前筆記 ——\n標題：${title}\n\n${note}\n—— 結束 ——`}\n`
      : "\n\n（尚未附上筆記內容）\n";

    return {
      system,
      prompt: `${ctxBlock}\n使用者：\n${data.prompt?.trim() || "請幫我理解這篇筆記"}`,
      history,
      temperature: 0.55,
    };
  }

  return {
    system: "你是 Albireus 筆記助手，使用繁體中文。",
    prompt: data.prompt?.trim() || note || "你好",
  };
}

export async function GET() {
  return NextResponse.json({
    ...vertexConfigStatus(),
    models: AI_TEXT_MODELS,
  });
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
    const model = resolveAiTextModel(data.assistant?.model || data.model);
    const grounding = !!(data.assistant?.grounding ?? data.grounding);
    const result = await vertexGenerateContent(built.prompt, {
      system: built.system,
      history: built.history,
      temperature: built.temperature,
      maxOutputTokens: multi ? 6144 : 4096,
      model,
      grounding,
    });
    const text = appendGroundingSources(result.text, result.sources);
    return NextResponse.json({
      text,
      model: result.model,
      grounding: grounding,
      groundingUsed: !!result.groundingUsed,
      sources: result.sources || [],
      searchQueries: result.searchQueries || [],
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
