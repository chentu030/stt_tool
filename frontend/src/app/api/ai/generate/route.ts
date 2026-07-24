import { NextRequest, NextResponse } from "next/server";
import {
  vertexConfigStatus,
  vertexGenerateContent,
  VertexChatMessage,
  type VertexContentPart,
} from "@/lib/vertex";
import {
  assistantSystemPrefix,
  resolveAiTextModel,
  AI_TEXT_MODELS,
  appendGroundingSources,
} from "@/lib/aiPrefs";
import { NOTE_EDIT_SYSTEM_RULES } from "@/lib/noteAiEdit";
import { DB_EDIT_SYSTEM_RULES } from "@/lib/dbAiEdit";
import { SCHEDULE_EDIT_SYSTEM_RULES } from "@/lib/scheduleAiEdit";
import { MEDIA_INSERT_SYSTEM_RULES } from "@/lib/aiMediaInsert";
import { requireAiUser } from "@/lib/aiApiGuard";

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
    | "transcript_study_notes"
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
  /** Multimodal refs (YouTube public URL, PDF URL, …) */
  mediaRefs?: Array<{
    kind?: string;
    url: string;
    mimeType?: string;
    title?: string;
  }>;
  /** Inline uploads (base64) — images / PDF pages for vision models */
  attachments?: Array<{
    name?: string;
    mimeType: string;
    /** Raw base64 (no data: prefix) */
    data: string;
    kind?: string;
  }>;
  /** When true, system prompt allows albireus-note-edit fences for the open note. */
  allowNoteEdit?: boolean;
  /** When true, system prompt allows albireus-db-edit fences for the open database. */
  allowDbEdit?: boolean;
  /** When true, system prompt allows albireus-schedule-edit fences for journal schedule. */
  allowScheduleEdit?: boolean;
  /** When true, system prompt allows albireus-media-insert fences (images / YouTube). */
  allowMediaInsert?: boolean;
  /** Focus note id (for edit targeting hints). */
  focusNoteId?: string;
  /** Focus database id (for edit targeting hints). */
  focusDatabaseId?: string;
  /** Focus schedule selected date (YYYY-MM-DD). */
  focusScheduleDate?: string;
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
      system:
        "你是 Albireus 筆記／白板助手。依使用者問題作答，使用繁體中文。若有附上影片、PDF 或網頁網址／內文，請依實際內容回答，不要說「只有平台名稱」或「看不到連結」。可給出可直接貼回白板的 Markdown。",
      prompt: `${context ? `${context}\n\n` : ""}白板／筆記標題：${title}\n\n選取內容：\n${selection}\n\n使用者問題：\n${data.prompt?.trim() || "請說明這段在說什麼"}`,
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
      system: `${asst}你是會議助手。用繁體中文輸出 Markdown，結構必須包含且僅優先使用這些二級標題：## 摘要、## 決議、## 待辦、## 未決／跟進。待辦必須是 - [ ] checklist；沒有內容時寫「無」。不要覆寫或改寫使用者原本的筆記子彈，只整理逐字稿與脈絡。`,
      prompt: `請產出會議整理包：\n\n${noteBlock}`,
    };
  }
  if (action === "transcript_study_notes") {
    const instruction =
      data.prompt?.trim() ||
      "幫我把全部內容，按照時間先後順序製作筆記，繁體中文，條列，1000字以上，文字清楚完整，重點寫到，方便之後複習";
    return {
      system: `${asst}你是 Albireus 逐字稿筆記助手。只輸出繁體中文 Markdown 筆記正文（可用 ##、-、粗體），不要開場白或結尾說明。務必依時間先後組織、條列清楚、涵蓋重點，篇幅至少約 1000 字，方便日後複習。若內容含時間戳，可在段落標註時間。`,
      prompt: `${instruction}\n\n—— 逐字稿 ——\n${noteBlock}\n—— 結束 ——`,
      temperature: 0.45,
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
- {"op":"add_media","media":"image"|"youtube"|"link","url":"https://…","title":"可選","x":n,"y":n}
- {"op":"update","id":"現有id","text":"...","label":"...","x":n,"y":n}
- {"op":"delete","id":"現有id"}
- {"op":"connect","from":"id","to":"id"}
- {"op":"pin_note","noteId":"必須來自 noteCatalog","x":n,"y":n}
規則：不要捏造 noteId；刪除要謹慎；一次最多 12 個 ops；座標以現有物件附近為佳；若只需建議可不給 ops（ops:[]）。add_media 的 url 必須是真實可公開存取的網址（YouTube 用完整 watch／youtu.be；圖片用 https 圖檔）；不要捏造圖床或影片 id。需要 AI 生圖時改在 message 說明，並另外輸出 albireus-media-insert（type:image_generate），不要用假 url。使用者會在介面按「套用到白板」或「插入圖片／影片」後才寫入，你要在 message 清楚說明將做哪些變更。
${MEDIA_INSERT_SYSTEM_RULES}`,
      prompt: `畫布狀態：\n${data.canvasSummary || "{}"}\n\n選取：${JSON.stringify(data.selectedIds || [])}\n\n使用者：\n${data.prompt?.trim() || "請分析這張白板並給建議"}`,
      temperature: 0.45,
    };
  }

  if (action === "chat" || action === "library" || action === "note") {
    const history = (data.messages || []).slice(-12);
    const allowEdit = !!data.allowNoteEdit;
    const allowDb = !!data.allowDbEdit;
    const allowSchedule = !!data.allowScheduleEdit;
    const allowMedia = !!data.allowMediaInsert;
    const editRules = [
      allowDb
        ? `使用者已授權你在「明確要求修改資料庫」時直接產出可套用的資料庫編輯區塊。目前資料庫 ID：${data.focusDatabaseId || "（未知）"}。\n${DB_EDIT_SYSTEM_RULES}`
        : "",
      allowEdit
        ? `使用者已授權你在「明確要求修改筆記」時直接產出可套用的編輯區塊。目前對焦筆記 ID：${data.focusNoteId || "（未知）"}。\n${NOTE_EDIT_SYSTEM_RULES}`
        : "",
      allowSchedule
        ? `使用者已授權你在「明確要求修改日誌行程」時產出可套用的行程編輯區塊（需使用者確認後才會寫入）。目前選取日：${data.focusScheduleDate || "（未知）"}。\n${SCHEDULE_EDIT_SYSTEM_RULES}`
        : "",
      allowMedia
        ? `使用者目前在可插入媒體的頁面。當對方要求配圖、插圖、生成圖片或嵌入 YouTube 時，請輸出媒體插入區塊（按「插入圖片／插入影片」才會寫入）。\n${MEDIA_INSERT_SYSTEM_RULES}`
        : "",
      !allowDb && !allowEdit && !allowSchedule
        ? "你目前沒有寫入筆記、資料庫或行程的權限；只能在對話中給出建議，不要假裝已修改。"
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    const system = [
      asst,
      allowDb
        ? "優先根據提供的資料庫脈絡作答；改資料時用列 id／屬性 id（或清楚的顯示名稱），不要捏造不存在的列。"
        : allowSchedule
          ? "優先根據提供的日誌行程脈絡作答；改行程時用脈絡中的 id 與 dateKey，不要捏造不存在的行程。"
          : "優先根據提供的筆記／知識庫脈絡作答；不要捏造沒有的事實。",
      "若使用者要求改寫／插入內容，用 Markdown 清楚標出建議文字。",
      "可用標題、清單、粗體、表格。",
      "提到具體筆記時，盡量附上路徑如 /notes/ID。",
      editRules,
    ].join("\n");

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
    const gate = await requireAiUser(req);
    if (gate instanceof NextResponse) return gate;

    const data = (await req.json()) as Body;
    const built = buildPrompt(data);
    if (!built.prompt.trim()) {
      return NextResponse.json({ error: "缺少內容" }, { status: 400 });
    }

    const multi =
      data.action === "chat" || data.action === "library" || data.action === "note";
    const longForm =
      data.action === "transcript_study_notes" || data.action === "expand";
    const model = resolveAiTextModel(data.assistant?.model || data.model);
    const grounding = !!(data.assistant?.grounding ?? data.grounding);

    const mediaParts: VertexContentPart[] = [];
    for (const ref of data.mediaRefs || []) {
      const u = (ref.url || "").trim();
      if (!/^https?:\/\//i.test(u)) continue;
      if (ref.kind === "youtube" || /youtube\.com|youtu\.be/i.test(u)) {
        mediaParts.push({
          fileData: { fileUri: u, mimeType: ref.mimeType || "video/mp4" },
        });
        // Vertex accepts one YouTube URL per request in practice for many models
        break;
      }
      if (ref.kind === "pdf" || /\.pdf(\?|#|$)/i.test(u)) {
        mediaParts.push({
          fileData: { fileUri: u, mimeType: ref.mimeType || "application/pdf" },
        });
      }
      if (ref.kind === "image" || /\.(png|jpe?g|webp|gif)(\?|#|$)/i.test(u)) {
        mediaParts.push({
          fileData: {
            fileUri: u,
            mimeType: ref.mimeType || "image/jpeg",
          },
        });
      }
    }

    const MAX_INLINE = 6;
    let inlineCount = 0;
    for (const att of data.attachments || []) {
      if (inlineCount >= MAX_INLINE) break;
      const raw = (att.data || "").trim();
      if (!raw) continue;
      const mime = (att.mimeType || "application/octet-stream").trim();
      const okImage = /^image\/(png|jpe?g|webp|gif)$/i.test(mime);
      const okPdf = mime === "application/pdf";
      if (!okImage && !okPdf) continue;
      // ~8MB raw base64 ceiling (chars)
      if (raw.length > 12_000_000) continue;
      mediaParts.push({
        inlineData: {
          mimeType: mime,
          data: raw.replace(/^data:[^;]+;base64,/, ""),
        },
      });
      inlineCount += 1;
    }

    const result = await vertexGenerateContent(built.prompt, {
      system: built.system,
      history: built.history,
      temperature: built.temperature,
      maxOutputTokens: multi ? 6144 : longForm ? 8192 : 4096,
      model,
      grounding,
      parts: mediaParts.length ? mediaParts : undefined,
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
