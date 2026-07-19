/**
 * Deep Research orchestration — mirrors industry pattern:
 * Plan → multi-query grounded search → synthesize cited report
 * (OpenAI / Gemini Deep Research style, using Vertex + Google Search grounding)
 */

import { vertexGenerateContent, type VertexGroundingSource } from "@/lib/vertex";

export type ResearchPlan = {
  title: string;
  angle: string;
  questions: string[];
};

export type ResearchFinding = {
  question: string;
  summary: string;
  sources: VertexGroundingSource[];
  searchQueries: string[];
};

export type ResearchReport = {
  title: string;
  markdown: string;
  plan: ResearchPlan;
  findings: ResearchFinding[];
  sources: VertexGroundingSource[];
  searchQueries: string[];
};

export type ResearchProgressEvent =
  | { type: "phase"; phase: "plan" | "gather" | "synthesize"; detail: string }
  | { type: "question"; index: number; total: number; question: string }
  | { type: "sources"; count: number }
  | { type: "done"; report: ResearchReport }
  | { type: "error"; message: string };

function parseJsonLoose<T>(text: string): T | null {
  const trimmed = text.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence ? fence[1].trim() : trimmed;
  try {
    return JSON.parse(raw) as T;
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function buildResearchPlan(
  topic: string,
  opts?: { model?: string; context?: string }
): Promise<ResearchPlan> {
  const res = await vertexGenerateContent(
    `研究主題：${topic}
${opts?.context ? `\n補充脈絡：\n${opts.context.slice(0, 4000)}` : ""}

請輸出 JSON（不要 markdown 解釋）：
{
  "title": "報告標題（繁中）",
  "angle": "研究切入角度一句話",
  "questions": ["子問題1", "子問題2", "...共 4 到 6 個可獨立上網查證的子問題"]
}`,
    {
      system:
        "你是資深研究分析師。把使用者主題拆成可驗證的子問題，涵蓋背景、現況、比較、風險、結論。只用繁體中文。只輸出 JSON。",
      temperature: 0.3,
      maxOutputTokens: 2048,
      model: opts?.model,
      grounding: false,
    }
  );

  const parsed = parseJsonLoose<ResearchPlan>(res.text);
  if (parsed?.questions?.length) {
    return {
      title: parsed.title || topic.slice(0, 40),
      angle: parsed.angle || "",
      questions: parsed.questions.map(String).filter(Boolean).slice(0, 6),
    };
  }

  // Fallback plan
  return {
    title: topic.slice(0, 60) || "研究報告",
    angle: "全面盤點現況、關鍵論點與可執行建議",
    questions: [
      `${topic}：背景與定義`,
      `${topic}：目前主流做法與趨勢`,
      `${topic}：關鍵數據或案例`,
      `${topic}：風險、爭議與限制`,
      `${topic}：對實務的建議`,
    ],
  };
}

export async function gatherOnQuestion(
  topic: string,
  question: string,
  opts?: { model?: string }
): Promise<ResearchFinding> {
  const res = await vertexGenerateContent(
    `總主題：${topic}

請針對以下子問題做「有來源」的調查，用繁體中文寫 3～6 點精要發現（每點可附具體事實／數據／觀點）。不要寫完整報告。

子問題：${question}`,
    {
      system:
        "你是調查研究員。必須善用網路搜尋取得最新可驗證資訊。條列重點，標明不確定之處。繁體中文。",
      temperature: 0.35,
      maxOutputTokens: 4096,
      model: opts?.model,
      grounding: true,
    }
  );

  return {
    question,
    summary: res.text.trim(),
    sources: res.sources || [],
    searchQueries: res.searchQueries || [],
  };
}

function mergeSources(findings: ResearchFinding[]): VertexGroundingSource[] {
  const seen = new Set<string>();
  const out: VertexGroundingSource[] = [];
  for (const f of findings) {
    for (const s of f.sources) {
      if (!s.uri || seen.has(s.uri)) continue;
      seen.add(s.uri);
      out.push(s);
    }
  }
  return out;
}

export async function synthesizeReport(
  topic: string,
  plan: ResearchPlan,
  findings: ResearchFinding[],
  opts?: { model?: string; context?: string }
): Promise<string> {
  const sourceList = mergeSources(findings);
  const findingBlock = findings
    .map(
      (f, i) =>
        `### 子問題 ${i + 1}：${f.question}\n${f.summary}\n來源：${
          f.sources.map((s) => s.title || s.uri).join("；") || "（無）"
        }`
    )
    .join("\n\n");

  const citeBlock = sourceList
    .map((s, i) => `[${i + 1}] ${s.title} — ${s.uri}`)
    .join("\n");

  const res = await vertexGenerateContent(
    `總主題：${topic}
報告標題：${plan.title}
切入角度：${plan.angle}
${opts?.context ? `\n使用者脈絡：\n${opts.context.slice(0, 3000)}\n` : ""}

以下是各子問題的調查筆記：
${findingBlock}

可用引用清單：
${citeBlock || "（本次搜尋未回傳明確網址，請依內容標註「待查證」）"}

請寫一份完整 Markdown 研究報告（繁體中文），結構建議：
1. 執行摘要（5～8 句）
2. 背景與範圍
3. 主要發現（分節，必要處用 [n] 引用）
4. 比較／對照（若適用）
5. 風險與限制
6. 結論與可執行建議
7. 參考來源（重列清單）

要求：完整、條理清楚、避免空話；有衝突證據時並列說明。`,
    {
      system:
        "你是首席研究分析師。輸出可直接給決策者閱讀的長文報告。繁體中文 Markdown。不要輸出 JSON。",
      temperature: 0.4,
      maxOutputTokens: 8192,
      model: opts?.model,
      grounding: false,
    }
  );

  return res.text.trim();
}

/** Full pipeline (server-side). */
export async function runDeepResearch(
  topic: string,
  opts?: {
    model?: string;
    context?: string;
    onProgress?: (e: ResearchProgressEvent) => void;
    maxQuestions?: number;
  }
): Promise<ResearchReport> {
  const emit = opts?.onProgress;
  const model = opts?.model;

  emit?.({ type: "phase", phase: "plan", detail: "擬定研究計畫與子問題…" });
  const plan = await buildResearchPlan(topic, { model, context: opts?.context });
  const questions = plan.questions.slice(0, opts?.maxQuestions ?? 5);

  emit?.({
    type: "phase",
    phase: "gather",
    detail: `開始調查 ${questions.length} 個子問題…`,
  });

  const findings: ResearchFinding[] = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    emit?.({ type: "question", index: i + 1, total: questions.length, question: q });
    const finding = await gatherOnQuestion(topic, q, { model });
    findings.push(finding);
    emit?.({
      type: "sources",
      count: mergeSources(findings).length,
    });
  }

  emit?.({ type: "phase", phase: "synthesize", detail: "彙整為完整引用報告…" });
  const markdown = await synthesizeReport(topic, plan, findings, {
    model,
    context: opts?.context,
  });

  const sources = mergeSources(findings);
  const searchQueries = Array.from(
    new Set(findings.flatMap((f) => f.searchQueries))
  );

  const report: ResearchReport = {
    title: plan.title,
    markdown,
    plan: { ...plan, questions },
    findings,
    sources,
    searchQueries,
  };
  emit?.({ type: "done", report });
  return report;
}
