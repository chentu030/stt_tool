/**
 * Deep Research agent — Vertex Gemini 3.x + Google Search grounding.
 *
 * Agentic loop (industry Deep Research pattern):
 *   Clarify → Plan → Hybrid Hunt (web + notes) → Analyze/Retry → Report
 */

import { vertexGenerateContent, type VertexGroundingSource } from "@/lib/vertex";

export type NoteSnippet = {
  id: string;
  title: string;
  excerpt: string;
  updatedAt?: string;
};

export type ResearchPlan = {
  title: string;
  angle: string;
  questions: string[];
  keywords: string[];
};

export type CitationSource = {
  /** Footnote index starting at 1 */
  index: number;
  kind: "web" | "note";
  title: string;
  uri: string;
  noteId?: string;
};

export type ResearchFinding = {
  question: string;
  summary: string;
  sources: CitationSource[];
  searchQueries: string[];
  retries: number;
  noteHits: NoteSnippet[];
  adequate: boolean;
};

export type ResearchReport = {
  title: string;
  summary: string;
  markdown: string;
  plan: ResearchPlan;
  findings: ResearchFinding[];
  sources: CitationSource[];
  webSources: CitationSource[];
  noteSources: CitationSource[];
  searchQueries: string[];
};

export type ClarifyResult = {
  clear: boolean;
  clarifyingQuestions: string[];
  assumedIntent: string;
};

export type ResearchDepth = "standard" | "max";

export type ResearchProgressEvent =
  | { type: "log"; message: string; level?: "info" | "ok" | "warn" | "retry" }
  | {
      type: "phase";
      phase: "clarify" | "plan" | "hunt" | "analyze" | "report";
      detail: string;
    }
  | { type: "clarify"; questions: string[]; assumedIntent: string }
  | { type: "plan"; plan: ResearchPlan; intent?: string; awaitingApproval?: boolean }
  | { type: "question"; index: number; total: number; question: string }
  | { type: "sources"; web: number; notes: number }
  | { type: "done"; report: ResearchReport }
  | { type: "error"; message: string };

export function depthConfig(depth: ResearchDepth = "standard") {
  if (depth === "max") {
    return { maxQuestions: 7, maxRetries: 2, label: "深度 Max" };
  }
  return { maxQuestions: 5, maxRetries: 1, label: "標準" };
}

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

function pickNotesForQuery(notes: NoteSnippet[], query: string, limit = 4): NoteSnippet[] {
  if (!notes.length) return [];
  const tokens = query
    .toLowerCase()
    .split(/[\s,，、/|]+/)
    .filter((t) => t.length >= 2);
  if (!tokens.length) return notes.slice(0, limit);

  const scored = notes
    .map((n) => {
      const hay = `${n.title}\n${n.excerpt}`.toLowerCase();
      let score = 0;
      for (const t of tokens) {
        if (hay.includes(t)) score += t.length >= 4 ? 3 : 1;
      }
      if (n.title.toLowerCase().includes(tokens[0])) score += 4;
      return { n, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length) return scored.slice(0, limit).map((x) => x.n);
  return notes.slice(0, Math.min(2, limit));
}

function formatNoteBlock(notes: NoteSnippet[]): string {
  if (!notes.length) return "（本次無相關個人筆記）";
  return notes
    .map(
      (n, i) =>
        `[筆記${i + 1}] 標題：${n.title}\n路徑：/notes/${n.id}\n摘要：\n${n.excerpt.slice(0, 900)}`
    )
    .join("\n\n---\n\n");
}

export async function clarifyTopic(
  topic: string,
  opts?: { model?: string; context?: string; answers?: string }
): Promise<ClarifyResult> {
  const res = await vertexGenerateContent(
    `使用者研究主題：${topic}
${opts?.context ? `\n補充脈絡：\n${opts.context.slice(0, 3000)}` : ""}
${opts?.answers ? `\n使用者對先前澄清問題的回答：\n${opts.answers.slice(0, 2000)}` : ""}

判斷主題是否夠清楚可開始深度研究。輸出 JSON：
{
  "clear": true/false,
  "clarifyingQuestions": ["若不清楚，最多 3 個短問句"],
  "assumedIntent": "若 clear=true，用一句話重述確定的研究意圖；否則寫目前猜測"
}`,
    {
      system:
        "你是研究規劃顧問。主題若缺少範圍（產業/技術/投資）、時間或受眾，就設 clear=false 並反問。若使用者已回答澄清問題，通常可設 clear=true。只用繁體中文。只輸出 JSON。",
      temperature: 0.2,
      maxOutputTokens: 1024,
      model: opts?.model,
      grounding: false,
    }
  );

  const parsed = parseJsonLoose<ClarifyResult>(res.text);
  if (parsed) {
    return {
      clear: !!parsed.clear,
      clarifyingQuestions: (parsed.clarifyingQuestions || []).map(String).filter(Boolean).slice(0, 3),
      assumedIntent: String(parsed.assumedIntent || topic).slice(0, 200),
    };
  }
  return { clear: true, clarifyingQuestions: [], assumedIntent: topic };
}

export async function buildResearchPlan(
  topic: string,
  opts?: { model?: string; context?: string; intent?: string }
): Promise<ResearchPlan> {
  const res = await vertexGenerateContent(
    `研究主題：${topic}
確定意圖：${opts?.intent || topic}
${opts?.context ? `\n補充脈絡：\n${opts.context.slice(0, 4000)}` : ""}

請輸出 JSON：
{
  "title": "報告標題（繁中）",
  "angle": "研究切入角度一句話",
  "questions": ["子問題1", "...共 5 到 7 個可獨立查證的子問題"],
  "keywords": ["搜尋關鍵字組合1", "...共 6 到 10 組，可含英文專有名詞"]
}`,
    {
      system:
        "你是資深研究分析師。把主題拆成可驗證子問題與搜尋關鍵字，涵蓋背景、現況、比較、數據、風險、結論。只用繁體中文。只輸出 JSON。",
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
      questions: parsed.questions.map(String).filter(Boolean).slice(0, 7),
      keywords: (parsed.keywords || []).map(String).filter(Boolean).slice(0, 10),
    };
  }

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
    keywords: [topic, `${topic} 趨勢`, `${topic} 案例`, `${topic} 風險`],
  };
}

async function evaluateFinding(
  question: string,
  summary: string,
  webCount: number,
  noteCount: number,
  opts?: { model?: string }
): Promise<{ adequate: boolean; reason: string; retryQuery?: string }> {
  const res = await vertexGenerateContent(
    `子問題：${question}
網路來源數：${webCount}
筆記命中數：${noteCount}
調查摘要：
${summary.slice(0, 2500)}

判斷資料是否足夠寫進最終報告。輸出 JSON：
{
  "adequate": true/false,
  "reason": "一句話原因",
  "retryQuery": "若 inadequate，給一組更好的搜尋關鍵字（可中英混合）；否則空字串"
}`,
    {
      system:
        "你是研究品質審核員。若摘要空洞、過時、離題，或幾乎無來源，設 adequate=false。繁體中文。只輸出 JSON。",
      temperature: 0.1,
      maxOutputTokens: 512,
      model: opts?.model,
      grounding: false,
    }
  );
  const parsed = parseJsonLoose<{
    adequate?: boolean;
    reason?: string;
    retryQuery?: string;
  }>(res.text);
  if (parsed) {
    return {
      adequate: parsed.adequate !== false,
      reason: String(parsed.reason || ""),
      retryQuery: (parsed.retryQuery || "").trim() || undefined,
    };
  }
  // Heuristic fallback
  const adequate = summary.length > 120 && (webCount > 0 || noteCount > 0);
  return {
    adequate,
    reason: adequate ? "啟發式通過" : "摘要過短或無來源",
    retryQuery: adequate ? undefined : `${question} 最新 2025 2026`,
  };
}

async function huntOnce(
  topic: string,
  question: string,
  searchHint: string,
  noteHits: NoteSnippet[],
  opts?: { model?: string; preferredDomains?: string[] }
): Promise<{
  summary: string;
  webSources: VertexGroundingSource[];
  searchQueries: string[];
}> {
  const domains = (opts?.preferredDomains || []).filter(Boolean).slice(0, 8);
  const domainLine = domains.length
    ? `\n優先參考這些網站／網域（仍可使用其他可靠來源）：${domains.join("、")}`
    : "";

  const res = await vertexGenerateContent(
    `總主題：${topic}
子問題：${question}
建議搜尋方向：${searchHint}${domainLine}

—— 使用者個人筆記（內部知識庫，可引用）——
${formatNoteBlock(noteHits)}

請針對子問題做「有來源」的調查，用繁體中文寫 4～8 點精要發現。
規則：
- 優先引用可驗證的網路事實／數據
- 若筆記觀點相關，明確寫「與你的筆記《標題》一致／補充／不同」並指出差異
- 標明不確定之處
- 不要寫完整長報告`,
    {
      system:
        "你是混合研究調查員：同時運用 Google 搜尋與使用者筆記。條列重點，繁體中文。",
      temperature: 0.35,
      maxOutputTokens: 4096,
      model: opts?.model,
      grounding: true,
    }
  );

  return {
    summary: res.text.trim(),
    webSources: res.sources || [],
    searchQueries: res.searchQueries || [],
  };
}

function toCitations(
  web: VertexGroundingSource[],
  notes: NoteSnippet[],
  startIndex: number
): { citations: CitationSource[]; nextIndex: number } {
  const citations: CitationSource[] = [];
  let idx = startIndex;
  const seen = new Set<string>();

  for (const s of web) {
    if (!s.uri || seen.has(s.uri)) continue;
    seen.add(s.uri);
    citations.push({
      index: idx++,
      kind: "web",
      title: s.title || s.uri,
      uri: s.uri,
    });
  }
  for (const n of notes) {
    const key = `note:${n.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    citations.push({
      index: idx++,
      kind: "note",
      title: n.title,
      uri: `/notes/${n.id}`,
      noteId: n.id,
    });
  }
  return { citations, nextIndex: idx };
}

export async function gatherOnQuestion(
  topic: string,
  question: string,
  opts?: {
    model?: string;
    libraryNotes?: NoteSnippet[];
    keywordPool?: string[];
    citeStart?: number;
    maxRetries?: number;
    preferredDomains?: string[];
    emit?: (e: ResearchProgressEvent) => void;
  }
): Promise<ResearchFinding> {
  const emit = opts?.emit;
  const library = opts?.libraryNotes || [];
  const maxRetries = Math.max(0, opts?.maxRetries ?? 1);
  let noteHits = pickNotesForQuery(library, question, 4);
  let hint = opts?.keywordPool?.slice(0, 3).join(" / ") || question;

  if (noteHits.length) {
    emit?.({
      type: "log",
      level: "ok",
      message: `整合筆記庫 ${noteHits.length} 則：${noteHits.map((n) => n.title).join("、")}`,
    });
  } else {
    emit?.({ type: "log", message: "筆記庫無直接命中，以網路搜尋為主" });
  }

  if (opts?.preferredDomains?.length) {
    emit?.({
      type: "log",
      message: `優先網域：${opts.preferredDomains.slice(0, 5).join("、")}`,
    });
  }

  emit?.({
    type: "log",
    message: `正在搜尋「${hint.slice(0, 60)}」…`,
  });

  let retries = 0;
  let result = await huntOnce(topic, question, hint, noteHits, {
    model: opts?.model,
    preferredDomains: opts?.preferredDomains,
  });
  let allQueries = [...result.searchQueries];
  let evalResult = await evaluateFinding(
    question,
    result.summary,
    result.webSources.length,
    noteHits.length,
    { model: opts?.model }
  );

  while (!evalResult.adequate && evalResult.retryQuery && retries < maxRetries) {
    retries += 1;
    hint = evalResult.retryQuery;
    emit?.({
      type: "log",
      level: "retry",
      message: `資料不足（${evalResult.reason}），第 ${retries} 次自我修正：「${hint}」`,
    });
    const retryNotes = pickNotesForQuery(library, `${question} ${hint}`, 4);
    const retry = await huntOnce(
      topic,
      question,
      hint,
      retryNotes.length ? retryNotes : noteHits,
      { model: opts?.model, preferredDomains: opts?.preferredDomains }
    );
    allQueries = [...allQueries, ...retry.searchQueries];
    if (
      retry.summary.length >= result.summary.length * 0.75 ||
      retry.webSources.length >= result.webSources.length
    ) {
      result = {
        summary: `${result.summary}\n\n—— 補充調查 ——\n${retry.summary}`,
        webSources: [...result.webSources, ...retry.webSources],
        searchQueries: allQueries,
      };
      if (retryNotes.length) noteHits = retryNotes;
    }
    evalResult = await evaluateFinding(
      question,
      result.summary,
      result.webSources.length,
      noteHits.length,
      { model: opts?.model }
    );
  }

  emit?.({
    type: "log",
    level: evalResult.adequate ? "ok" : "warn",
    message: evalResult.adequate
      ? retries
        ? `重試後資料足夠（修正 ${retries} 次）`
        : evalResult.reason || "本子問題資料足夠"
      : `仍偏弱（${evalResult.reason}），先保留現有發現`,
  });

  const { citations } = toCitations(
    result.webSources,
    noteHits,
    opts?.citeStart ?? 1
  );

  return {
    question,
    summary: result.summary,
    sources: citations,
    searchQueries: Array.from(new Set(allQueries.length ? allQueries : result.searchQueries)),
    retries,
    noteHits: [...noteHits],
    adequate: evalResult.adequate,
  };
}

function mergeAllSources(findings: ResearchFinding[]): CitationSource[] {
  const seen = new Set<string>();
  const out: CitationSource[] = [];
  let idx = 1;
  for (const f of findings) {
    for (const s of f.sources) {
      const key = s.kind === "note" ? `note:${s.noteId}` : s.uri;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ ...s, index: idx++ });
    }
  }
  return out;
}

export async function synthesizeReport(
  topic: string,
  plan: ResearchPlan,
  findings: ResearchFinding[],
  sources: CitationSource[],
  opts?: { model?: string; context?: string; intent?: string }
): Promise<{ markdown: string; summary: string }> {
  const findingBlock = findings
    .map(
      (f, i) =>
        `### 子問題 ${i + 1}：${f.question}\n重試次數：${f.retries}\n${f.summary}\n引用：${
          f.sources.map((s) => `[${s.index}] ${s.title}`).join("；") || "（無）"
        }`
    )
    .join("\n\n");

  const citeBlock = sources
    .map((s) => {
      const tag = s.kind === "note" ? "筆記" : "網路";
      return `[${s.index}] (${tag}) ${s.title} — ${s.uri}`;
    })
    .join("\n");

  const res = await vertexGenerateContent(
    `總主題：${topic}
確定意圖：${opts?.intent || topic}
報告標題：${plan.title}
切入角度：${plan.angle}
${opts?.context ? `\n使用者脈絡：\n${opts.context.slice(0, 3000)}\n` : ""}

調查筆記：
${findingBlock}

引用清單（報告中必須用 [n] 標註，網路與筆記皆可引用）：
${citeBlock || "（無明確網址，請標「待查證」）"}

請寫完整 Markdown 研究報告（繁體中文），結構：
1. 執行摘要（5～8 句，獨立成段）
2. 背景與範圍
3. 主要發現（分節，關鍵陳述加 [n]）
4. 與你的筆記的對話（若有筆記來源：指出一致／補充／衝突）
5. 比較／對照（若適用）
6. 風險與限制
7. 結論與可執行建議
8. 參考來源（重列清單，區分【網路】與【筆記】）

要求：長文、條理清楚；有衝突證據時並列；筆記引用用 [n] 指向 /notes/…`,
    {
      system:
        "你是首席研究分析師。產出可給決策者閱讀的長文，並嚴格使用提供的 [n] 腳註。繁體中文 Markdown。不要輸出 JSON。",
      temperature: 0.4,
      maxOutputTokens: 8192,
      model: opts?.model,
      grounding: false,
    }
  );

  const markdown = res.text.trim();

  const sumRes = await vertexGenerateContent(
    `從以下研究報告抽出 4～6 句「卡片摘要」（繁體中文，不要標題、不要 bullet）：\n\n${markdown.slice(0, 6000)}`,
    {
      system: "只輸出摘要正文。",
      temperature: 0.2,
      maxOutputTokens: 512,
      model: opts?.model,
      grounding: false,
    }
  );

  return {
    markdown,
    summary: sumRes.text.trim() || markdown.slice(0, 280),
  };
}

export type RunDeepResearchOpts = {
  model?: string;
  context?: string;
  /** Pre-ranked personal notes from client */
  libraryNotes?: NoteSnippet[];
  /** Skip clarify phase (user already answered or chose skip) */
  skipClarify?: boolean;
  /** Answers to clarifying questions */
  clarifyAnswers?: string;
  /** User-approved / edited plan — skips plan generation */
  approvedPlan?: ResearchPlan;
  /**
   * Pause after plan for user review (OpenAI/Gemini style).
   * Default true unless approvedPlan is provided.
   */
  requirePlanApproval?: boolean;
  depth?: ResearchDepth;
  maxQuestions?: number;
  maxRetries?: number;
  /** Prefer these domains/sites when searching (OpenAI-style source focus) */
  preferredDomains?: string[];
  onProgress?: (e: ResearchProgressEvent) => void;
};

/**
 * Full agent pipeline. May emit `clarify` / `plan` and pause via thrown errors.
 */
export class ClarifyNeededError extends Error {
  questions: string[];
  assumedIntent: string;
  constructor(questions: string[], assumedIntent: string) {
    super("NEED_CLARIFY");
    this.name = "ClarifyNeededError";
    this.questions = questions;
    this.assumedIntent = assumedIntent;
  }
}

export class PlanApprovalNeededError extends Error {
  plan: ResearchPlan;
  intent: string;
  constructor(plan: ResearchPlan, intent: string) {
    super("NEED_PLAN_APPROVAL");
    this.name = "PlanApprovalNeededError";
    this.plan = plan;
    this.intent = intent;
  }
}

export async function runDeepResearch(
  topic: string,
  opts?: RunDeepResearchOpts
): Promise<ResearchReport> {
  const emit = opts?.onProgress;
  const model = opts?.model;
  const libraryNotes = opts?.libraryNotes || [];
  const depth = opts?.depth || "standard";
  const cfg = depthConfig(depth);
  const maxQuestions = opts?.maxQuestions ?? cfg.maxQuestions;
  const maxRetries = opts?.maxRetries ?? cfg.maxRetries;
  const preferredDomains = (opts?.preferredDomains || [])
    .map((d) => d.trim())
    .filter(Boolean)
    .slice(0, 8);

  emit?.({
    type: "log",
    message: `深度模式：${cfg.label}（最多 ${maxQuestions} 題、自我修正 ${maxRetries} 次）`,
  });
  if (preferredDomains.length) {
    emit?.({
      type: "log",
      message: `來源偏好：${preferredDomains.join("、")}`,
    });
  }

  // ── 1. Clarify ──────────────────────────────────────────
  let intent = topic;
  if (opts?.approvedPlan) {
    intent = opts.approvedPlan.angle || topic;
    emit?.({ type: "log", level: "ok", message: "使用你核准的研究計畫，略過釐清／規劃" });
  } else {
    emit?.({ type: "phase", phase: "clarify", detail: "釐清研究意圖…" });
    emit?.({ type: "log", message: "正在判斷主題是否夠清楚…" });

    if (!opts?.skipClarify) {
      const clarified = await clarifyTopic(topic, {
        model,
        context: opts?.context,
        answers: opts?.clarifyAnswers,
      });
      intent = clarified.assumedIntent || topic;

      if (!clarified.clear && clarified.clarifyingQuestions.length && !opts?.clarifyAnswers) {
        emit?.({
          type: "clarify",
          questions: clarified.clarifyingQuestions,
          assumedIntent: clarified.assumedIntent,
        });
        emit?.({
          type: "log",
          level: "warn",
          message: "主題不夠清楚，需要你補充幾點再繼續",
        });
        throw new ClarifyNeededError(clarified.clarifyingQuestions, clarified.assumedIntent);
      }
      emit?.({
        type: "log",
        level: "ok",
        message: `意圖確認：${intent}`,
      });
    } else if (opts?.clarifyAnswers) {
      intent = `${topic}（補充：${opts.clarifyAnswers.slice(0, 300)}）`;
      emit?.({ type: "log", level: "ok", message: `已套用你的補充說明` });
    }
  }

  // ── 2. Plan ─────────────────────────────────────────────
  let plan: ResearchPlan;
  if (opts?.approvedPlan?.questions?.length) {
    plan = {
      title: opts.approvedPlan.title || topic.slice(0, 40),
      angle: opts.approvedPlan.angle || "",
      questions: opts.approvedPlan.questions.map(String).filter(Boolean).slice(0, maxQuestions),
      keywords: (opts.approvedPlan.keywords || []).map(String).filter(Boolean).slice(0, 12),
    };
  } else {
    emit?.({ type: "phase", phase: "plan", detail: "擬定研究計畫書…" });
    emit?.({ type: "log", message: "正在規劃研究路徑與關鍵字組合…" });
    plan = await buildResearchPlan(topic, {
      model,
      context: opts?.context,
      intent,
    });
    plan = {
      ...plan,
      questions: plan.questions.slice(0, maxQuestions),
    };
    const needApproval = opts?.requirePlanApproval !== false;
    emit?.({
      type: "plan",
      plan,
      intent,
      awaitingApproval: needApproval,
    });
    emit?.({
      type: "log",
      level: "ok",
      message: `計畫完成：${plan.questions.length} 個子問題、${plan.keywords.length} 組關鍵字`,
    });
    if (needApproval) {
      emit?.({
        type: "log",
        level: "warn",
        message: "請檢視／編輯研究計畫後再繼續（可增刪子問題）",
      });
      throw new PlanApprovalNeededError(plan, intent);
    }
  }

  const questions = plan.questions.slice(0, maxQuestions);

  // ── 3–4. Hunt + Analyze (with retry) ────────────────────
  emit?.({
    type: "phase",
    phase: "hunt",
    detail: `混合搜尋：網路 + ${libraryNotes.length} 則筆記庫`,
  });
  if (libraryNotes.length) {
    emit?.({
      type: "log",
      message: `已載入筆記庫 ${libraryNotes.length} 則供內部檢索`,
    });
  }

  const findings: ResearchFinding[] = [];
  let citeCursor = 1;

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    emit?.({ type: "question", index: i + 1, total: questions.length, question: q });
    emit?.({
      type: "phase",
      phase: "analyze",
      detail: `閱讀與萃取（${i + 1}/${questions.length}）`,
    });

    const finding = await gatherOnQuestion(topic, q, {
      model,
      libraryNotes,
      keywordPool: plan.keywords,
      citeStart: citeCursor,
      maxRetries,
      preferredDomains,
      emit,
    });
    citeCursor += finding.sources.length;
    findings.push(finding);

    const all = mergeAllSources(findings);
    emit?.({
      type: "sources",
      web: all.filter((s) => s.kind === "web").length,
      notes: all.filter((s) => s.kind === "note").length,
    });
    emit?.({
      type: "log",
      level: "ok",
      message: `已完成子問題 ${i + 1}/${questions.length}${
        finding.retries ? `（含 ${finding.retries} 次自我修正）` : ""
      }`,
    });
  }

  // ── 5. Report ───────────────────────────────────────────
  emit?.({ type: "phase", phase: "report", detail: "撰寫完整引用報告…" });
  emit?.({ type: "log", message: "正在整合發現、對照筆記並加上腳註…" });

  const sources = mergeAllSources(findings);
  const uriToIndex = new Map(
    sources.map((s) => [s.kind === "note" ? `note:${s.noteId}` : s.uri, s.index])
  );
  for (const f of findings) {
    f.sources = f.sources.map((s) => ({
      ...s,
      index: uriToIndex.get(s.kind === "note" ? `note:${s.noteId}` : s.uri) || s.index,
    }));
  }

  const { markdown, summary } = await synthesizeReport(topic, plan, findings, sources, {
    model,
    context: opts?.context,
    intent,
  });

  const webSources = sources.filter((s) => s.kind === "web");
  const noteSources = sources.filter((s) => s.kind === "note");
  const searchQueries = Array.from(new Set(findings.flatMap((f) => f.searchQueries)));

  emit?.({
    type: "log",
    level: "ok",
    message: `報告完成：${webSources.length} 個網路來源、${noteSources.length} 則筆記引用`,
  });

  const report: ResearchReport = {
    title: plan.title,
    summary,
    markdown,
    plan: { ...plan, questions },
    findings,
    sources,
    webSources,
    noteSources,
    searchQueries,
  };
  emit?.({ type: "done", report });
  return report;
}

/**
 * Re-hunt weak (or selected) findings and rewrite the report — selective refine.
 */
export async function refineResearchReport(
  topic: string,
  plan: ResearchPlan,
  findings: ResearchFinding[],
  opts?: {
    model?: string;
    context?: string;
    intent?: string;
    libraryNotes?: NoteSnippet[];
    preferredDomains?: string[];
    maxRetries?: number;
    /** If omitted, re-hunt all inadequate findings */
    questions?: string[];
    onProgress?: (e: ResearchProgressEvent) => void;
  }
): Promise<ResearchReport> {
  const emit = opts?.onProgress;
  const model = opts?.model;
  const libraryNotes = opts?.libraryNotes || [];
  const preferredDomains = (opts?.preferredDomains || []).filter(Boolean).slice(0, 8);
  const maxRetries = opts?.maxRetries ?? 2;

  const targets = new Set(
    (opts?.questions?.length
      ? opts.questions
      : findings.filter((f) => !f.adequate).map((f) => f.question)
    ).map((q) => q.trim())
  );

  if (!targets.size) {
    throw new Error("沒有需要重跑的子問題");
  }

  emit?.({
    type: "phase",
    phase: "hunt",
    detail: `重跑 ${targets.size} 個偏弱子問題…`,
  });
  emit?.({
    type: "log",
    level: "retry",
    message: `選擇性補強：${Array.from(targets).join("；")}`,
  });

  const next: ResearchFinding[] = [];
  let citeCursor = 1;

  for (let i = 0; i < findings.length; i++) {
    const f = findings[i];
    if (!targets.has(f.question.trim())) {
      // re-index later
      next.push(f);
      continue;
    }
    emit?.({
      type: "question",
      index: i + 1,
      total: findings.length,
      question: f.question,
    });
    const updated = await gatherOnQuestion(topic, f.question, {
      model,
      libraryNotes,
      keywordPool: plan.keywords,
      citeStart: citeCursor,
      maxRetries,
      preferredDomains,
      emit,
    });
    citeCursor += updated.sources.length;
    next.push(updated);
  }

  // Re-index all
  const sources = mergeAllSources(next);
  const uriToIndex = new Map(
    sources.map((s) => [s.kind === "note" ? `note:${s.noteId}` : s.uri, s.index])
  );
  for (const f of next) {
    f.sources = f.sources.map((s) => ({
      ...s,
      index: uriToIndex.get(s.kind === "note" ? `note:${s.noteId}` : s.uri) || s.index,
    }));
  }

  emit?.({ type: "phase", phase: "report", detail: "依補強結果重寫報告…" });
  const { markdown, summary } = await synthesizeReport(topic, plan, next, sources, {
    model,
    context: opts?.context,
    intent: opts?.intent || plan.angle || topic,
  });

  const report: ResearchReport = {
    title: plan.title,
    summary,
    markdown,
    plan,
    findings: next,
    sources,
    webSources: sources.filter((s) => s.kind === "web"),
    noteSources: sources.filter((s) => s.kind === "note"),
    searchQueries: Array.from(new Set(next.flatMap((f) => f.searchQueries))),
  };
  emit?.({
    type: "log",
    level: "ok",
    message: `補強完成：仍偏弱 ${next.filter((f) => !f.adequate).length} 題`,
  });
  emit?.({ type: "done", report });
  return report;
}
