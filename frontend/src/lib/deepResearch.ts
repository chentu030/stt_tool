/**
 * Deep Research agent — Vertex Gemini 3.x + Google Search grounding.
 *
 * Agentic loop (industry Deep Research pattern):
 *   Clarify → Plan → Hybrid Hunt (web + notes) → Analyze/Retry → Report
 */

import { vertexGenerateContent, type VertexGroundingSource } from "@/lib/vertex";
import { drainResearchGuidance } from "@/lib/researchRunStore";

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
  | { type: "question_done"; index: number; total: number; adequate: boolean }
  | {
      type: "finding";
      index: number;
      total: number;
      finding: {
        question: string;
        summary: string;
        adequate: boolean;
        retries: number;
        sources: CitationSource[];
        noteHits: NoteSnippet[];
      };
    }
  | {
      type: "progress";
      pct: number;
      done: number;
      total: number;
      etaSec?: number;
    }
  | { type: "guidance_applied"; text: string }
  | { type: "sources"; web: number; notes: number }
  | { type: "done"; report: ResearchReport }
  | { type: "error"; message: string };

export function depthConfig(depth: ResearchDepth = "standard") {
  if (depth === "max") {
    return { maxQuestions: 7, maxRetries: 2, label: "深度 Max" };
  }
  return { maxQuestions: 5, maxRetries: 1, label: "標準" };
}

export class ResearchAbortedError extends Error {
  constructor(message = "研究已中止") {
    super(message);
    this.name = "ResearchAbortedError";
  }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new ResearchAbortedError();
}

function normalizeDomainHost(d: string): string {
  return d
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("/")[0]
    .toLowerCase();
}

/** Inject site: operators so preferred domains actually bias grounding. */
function withPreferredDomainHint(
  hint: string,
  domains: string[],
  attempt = 0
): string {
  const hosts = domains.map(normalizeDomainHost).filter(Boolean).slice(0, 8);
  if (!hosts.length) return hint;
  if (attempt > 0) {
    const focus = hosts[attempt % hosts.length];
    return `${hint} site:${focus}`;
  }
  const sites = hosts
    .slice(0, 3)
    .map((h) => `site:${h}`)
    .join(" OR ");
  return `${hint} (${sites})`;
}

function countPreferredHits(
  sources: VertexGroundingSource[],
  domains: string[]
): number {
  const hosts = domains.map(normalizeDomainHost).filter(Boolean);
  if (!hosts.length) return 0;
  return sources.filter((s) => {
    const uri = (s.uri || "").toLowerCase();
    return hosts.some((h) => uri.includes(h));
  }).length;
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

function tokenizeQuery(query: string): string[] {
  const q = query.toLowerCase().trim();
  const parts = q
    .split(/[\s,，、/|；;。.！!？?（）()【】\[\]「」]+/)
    .filter((t) => t.length >= 2);
  const out = new Set<string>(parts);
  // CJK bigrams so Chinese topics match excerpts without spaces
  const cjk = q.replace(/[^\u4e00-\u9fff]/g, "");
  for (let i = 0; i < cjk.length - 1; i++) {
    out.add(cjk.slice(i, i + 2));
  }
  if (cjk.length >= 3) {
    for (let i = 0; i < cjk.length - 2; i += 2) {
      out.add(cjk.slice(i, i + 3));
    }
  }
  return Array.from(out).filter(Boolean).slice(0, 48);
}

function pickNotesForQuery(notes: NoteSnippet[], query: string, limit = 5): NoteSnippet[] {
  if (!notes.length) return [];
  const tokens = tokenizeQuery(query);
  if (!tokens.length) return notes.slice(0, limit);

  const scored = notes
    .map((n) => {
      const title = n.title.toLowerCase();
      const excerpt = (n.excerpt || "").toLowerCase();
      const hay = `${title}\n${excerpt}`;
      let score = 0;
      for (const t of tokens) {
        if (title.includes(t)) score += t.length >= 4 ? 8 : t.length >= 2 ? 5 : 3;
        else if (excerpt.includes(t)) score += t.length >= 4 ? 3 : 1.5;
      }
      // phrase boost
      if (hay.includes(query.toLowerCase().slice(0, 40))) score += 6;
      // denser excerpts rank slightly higher
      score += Math.min(3, Math.floor((n.excerpt || "").length / 600));
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
        `[筆記${i + 1}] 標題：${n.title}\n路徑：/notes/${n.id}\n內容摘錄：\n${n.excerpt.slice(0, 1800)}`
    )
    .join("\n\n---\n\n");
}

export async function clarifyTopic(
  topic: string,
  opts?: { model?: string; context?: string; answers?: string; signal?: AbortSignal }
): Promise<ClarifyResult> {
  throwIfAborted(opts?.signal);
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
      signal: opts?.signal,
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
  return {
    clear: false,
    clarifyingQuestions: ["請補充研究範圍（產業／對象）、時間區間與期望產出形式"],
    assumedIntent: topic,
  };
}

export async function buildResearchPlan(
  topic: string,
  opts?: { model?: string; context?: string; intent?: string; signal?: AbortSignal }
): Promise<ResearchPlan> {
  throwIfAborted(opts?.signal);
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
      signal: opts?.signal,
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
  opts?: { model?: string; signal?: AbortSignal }
): Promise<{ adequate: boolean; reason: string; retryQuery?: string }> {
  throwIfAborted(opts?.signal);
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
      signal: opts?.signal,
    }
  );
  const parsed = parseJsonLoose<{
    adequate?: boolean;
    reason?: string;
    retryQuery?: string;
  }>(res.text);
  if (parsed && typeof parsed.adequate === "boolean") {
    return {
      adequate: parsed.adequate,
      reason: String(parsed.reason || ""),
      retryQuery: (parsed.retryQuery || "").trim() || undefined,
    };
  }
  // Heuristic fallback when JSON missing or ambiguous
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
  opts?: {
    model?: string;
    preferredDomains?: string[];
    domainAttempt?: number;
    signal?: AbortSignal;
  }
): Promise<{
  summary: string;
  webSources: VertexGroundingSource[];
  searchQueries: string[];
}> {
  throwIfAborted(opts?.signal);
  const domains = (opts?.preferredDomains || []).filter(Boolean).slice(0, 8);
  const biasedHint = withPreferredDomainHint(
    searchHint,
    domains,
    opts?.domainAttempt || 0
  );
  const domainLine = domains.length
    ? `\n【嚴格偏好】優先且盡量只引用這些網域的資料：${domains
        .map(normalizeDomainHost)
        .join("、")}。搜尋時已附 site: 運算子；若找不到再謹慎使用其他權威來源並標明。`
    : "";

  const res = await vertexGenerateContent(
    `總主題：${topic}
子問題：${question}
建議搜尋方向：${biasedHint}${domainLine}

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
      signal: opts?.signal,
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
    signal?: AbortSignal;
    emit?: (e: ResearchProgressEvent) => void;
  }
): Promise<ResearchFinding> {
  const emit = opts?.emit;
  const signal = opts?.signal;
  throwIfAborted(signal);
  const library = opts?.libraryNotes || [];
  const maxRetries = Math.max(0, opts?.maxRetries ?? 1);
  const preferredDomains = (opts?.preferredDomains || []).filter(Boolean).slice(0, 8);
  let noteHits = pickNotesForQuery(library, question, 4);
  let hint = opts?.keywordPool?.slice(0, 3).join(" / ") || question;
  let domainAttempt = 0;

  if (noteHits.length) {
    emit?.({
      type: "log",
      level: "ok",
      message: `整合筆記庫 ${noteHits.length} 則：${noteHits.map((n) => n.title).join("、")}`,
    });
  } else {
    emit?.({ type: "log", message: "筆記庫無直接命中，以網路搜尋為主" });
  }

  if (preferredDomains.length) {
    emit?.({
      type: "log",
      message: `優先網域（site:）：${preferredDomains
        .map(normalizeDomainHost)
        .slice(0, 5)
        .join("、")}`,
    });
  }

  emit?.({
    type: "log",
    message: `正在搜尋「${hint.slice(0, 60)}」…`,
  });

  let retries = 0;
  let result = await huntOnce(topic, question, hint, noteHits, {
    model: opts?.model,
    preferredDomains,
    domainAttempt,
    signal,
  });
  let allQueries = [...result.searchQueries];
  let preferredHits = countPreferredHits(result.webSources, preferredDomains);

  // If preferred domains set but zero hits, force one domain-focused pass
  if (preferredDomains.length && preferredHits === 0 && maxRetries > 0) {
    domainAttempt = 1;
    emit?.({
      type: "log",
      level: "retry",
      message: "未命中優先網域，改以 site: 加強搜尋…",
    });
    const focused = await huntOnce(topic, question, hint, noteHits, {
      model: opts?.model,
      preferredDomains,
      domainAttempt,
      signal,
    });
    allQueries = [...allQueries, ...focused.searchQueries];
    preferredHits = countPreferredHits(focused.webSources, preferredDomains);
    if (
      focused.webSources.length >= result.webSources.length ||
      preferredHits > 0 ||
      focused.summary.length >= result.summary.length * 0.7
    ) {
      result = {
        summary:
          preferredHits > 0
            ? focused.summary
            : `${result.summary}\n\n—— 網域加強補充 ——\n${focused.summary}`,
        webSources: [...result.webSources, ...focused.webSources],
        searchQueries: allQueries,
      };
    }
    if (preferredHits > 0) {
      emit?.({
        type: "log",
        level: "ok",
        message: `已命中優先網域 ${preferredHits} 筆`,
      });
    }
  } else if (preferredHits > 0) {
    emit?.({
      type: "log",
      level: "ok",
      message: `優先網域命中 ${preferredHits} 筆`,
    });
  }

  let evalResult = await evaluateFinding(
    question,
    result.summary,
    result.webSources.length,
    noteHits.length,
    { model: opts?.model, signal }
  );

  while (!evalResult.adequate && evalResult.retryQuery && retries < maxRetries) {
    throwIfAborted(signal);
    retries += 1;
    hint = evalResult.retryQuery;
    domainAttempt = preferredDomains.length ? retries + 1 : 0;
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
      {
        model: opts?.model,
        preferredDomains,
        domainAttempt,
        signal,
      }
    );
    allQueries = [...allQueries, ...retry.searchQueries];
    if (
      retry.summary.length >= result.summary.length * 0.75 ||
      retry.webSources.length >= result.webSources.length ||
      countPreferredHits(retry.webSources, preferredDomains) >
        countPreferredHits(result.webSources, preferredDomains)
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
      { model: opts?.model, signal }
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

/** Simple concurrency pool — fail-fast aborts siblings on first error */
async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  let firstError: unknown = null;
  const local = new AbortController();
  const onParent = () => local.abort();
  signal?.addEventListener("abort", onParent);

  const check = () => {
    if (signal?.aborted || local.signal.aborted) throw new ResearchAbortedError();
    if (firstError) throw firstError;
  };

  try {
    const workers = Array.from(
      { length: Math.max(1, Math.min(concurrency, items.length || 1)) },
      async () => {
        while (true) {
          check();
          const i = cursor++;
          if (i >= items.length) break;
          try {
            results[i] = await fn(items[i], i);
          } catch (e) {
            if (!firstError) firstError = e;
            local.abort();
            throw e;
          }
        }
      }
    );
    await Promise.allSettled(workers);
  } finally {
    signal?.removeEventListener("abort", onParent);
  }
  if (firstError) throw firstError;
  throwIfAborted(signal);
  return results;
}

function emitProgress(
  emit: ((e: ResearchProgressEvent) => void) | undefined,
  done: number,
  total: number,
  startedAt: number,
  phaseWeight: "hunt" | "report"
) {
  if (!total) return;
  const huntPct = Math.min(78, Math.round((done / total) * 70) + 12);
  const pct = phaseWeight === "report" ? Math.min(95, huntPct + 12) : huntPct;
  const elapsed = Date.now() - startedAt;
  let etaSec: number | undefined;
  if (done > 0 && done < total) {
    const per = elapsed / done;
    etaSec = Math.round(((total - done) * per + 25000) / 1000);
  } else if (done >= total && phaseWeight === "hunt") {
    etaSec = 25;
  }
  emit?.({ type: "progress", pct, done, total, etaSec });
}

export async function synthesizeReport(
  topic: string,
  plan: ResearchPlan,
  findings: ResearchFinding[],
  sources: CitationSource[],
  opts?: { model?: string; context?: string; intent?: string; signal?: AbortSignal }
): Promise<{ markdown: string; summary: string }> {
  throwIfAborted(opts?.signal);
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
2. 可信度分層（必須獨立成章，標題用「## 可信度分層」）：
   - ### 已確立 — 至少兩處獨立來源支持的結論（每點標 [n]）
   - ### 仍有爭議 — 來源互相衝突的論點（並列雙方並標 [n]，勿擅自選邊）
   - ### 不確定／待查證 — 單來源、過時或資料缺口（列出還缺什麼）
3. 背景與範圍
4. 主要發現（分節，關鍵陳述加 [n]；重要結論可在句末加標籤如〔已確立〕〔爭議〕〔不確定〕）
5. 與你的筆記的對話（若有筆記來源：指出一致／補充／衝突；引用筆記時用 [n]）
6. 比較／對照（若適用）
7. 風險與限制
8. 結論與可執行建議（最多 5 點，優先可驗證行動）
9. 參考來源（重列清單，區分【網路】與【筆記】）

要求：長文、條理清楚；有衝突證據時並列；筆記與網路皆用 [n] 腳註（系統稍後會轉成 wiki／連結）。不要省略「可信度分層」章節。`,
    {
      system:
        "你是首席研究分析師。產出可給決策者閱讀的長文，嚴格使用 [n] 腳註，並明確標示已確立／爭議／不確定。繁體中文 Markdown。不要輸出 JSON。",
      temperature: 0.4,
      maxOutputTokens: 8192,
      model: opts?.model,
      grounding: false,
      signal: opts?.signal,
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
      signal: opts?.signal,
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
  /** Parallel hunt concurrency (1–3). Default 2 for standard, 3 for max. */
  concurrency?: number;
  /** Mid-run guidance store key */
  runId?: string;
  /** Abort between Vertex calls / pool workers */
  signal?: AbortSignal;
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
  const concurrency = Math.max(
    1,
    Math.min(3, opts?.concurrency ?? (depth === "max" ? 3 : 2))
  );
  const runId = opts?.runId;
  const signal = opts?.signal;

  emit?.({
    type: "log",
    message: `深度模式：${cfg.label}（最多 ${maxQuestions} 題、自我修正 ${maxRetries} 次、並行 ${concurrency}）`,
  });
  if (preferredDomains.length) {
    emit?.({
      type: "log",
      message: `來源偏好（site:）：${preferredDomains.map(normalizeDomainHost).join("、")}`,
    });
  }

  // ── 1. Clarify ──────────────────────────────────────────
  let intent = topic;
  if (opts?.approvedPlan) {
    intent = opts.approvedPlan.angle || topic;
    emit?.({ type: "log", level: "ok", message: "使用你核准的研究計畫，略過釐清／規劃" });
  } else {
    throwIfAborted(signal);
    emit?.({ type: "phase", phase: "clarify", detail: "釐清研究意圖…" });
    emit?.({ type: "log", message: "正在判斷主題是否夠清楚…" });

    if (!opts?.skipClarify) {
      const clarified = await clarifyTopic(topic, {
        model,
        context: opts?.context,
        answers: opts?.clarifyAnswers,
        signal,
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
    throwIfAborted(signal);
    plan = await buildResearchPlan(topic, {
      model,
      context: opts?.context,
      intent,
      signal,
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

  // ── 3–4. Hunt + Analyze (parallel + mid-run guidance) ──
  emit?.({
    type: "phase",
    phase: "hunt",
    detail: `混合搜尋：網路 + ${libraryNotes.length} 則筆記庫（並行 ${concurrency}）`,
  });
  if (libraryNotes.length) {
    emit?.({
      type: "log",
      message: `已載入筆記庫 ${libraryNotes.length} 則供內部檢索`,
    });
  }

  const huntStarted = Date.now();
  let doneCount = 0;
  let extraKeywords = [...plan.keywords];
  const extraContextBits: string[] = [];
  emitProgress(emit, 0, questions.length, huntStarted, "hunt");

  const findings = await mapPool(
    questions,
    concurrency,
    async (q, i) => {
      throwIfAborted(signal);
      const myTips: string[] = [];
      if (runId) {
        const tips = drainResearchGuidance(runId);
        for (const t of tips) {
          myTips.push(t);
          emit?.({ type: "guidance_applied", text: t });
          emit?.({
            type: "log",
            level: "warn",
            message: `已注入方向：${t.slice(0, 120)}`,
          });
          extraKeywords = [
            ...extraKeywords,
            ...t.split(/[\s,，]+/).filter(Boolean).slice(0, 4),
          ];
          extraContextBits.push(t);
        }
      }

      emit?.({ type: "question", index: i + 1, total: questions.length, question: q });

      const finding = await gatherOnQuestion(topic, q, {
        model,
        libraryNotes,
        keywordPool: [
          ...extraKeywords,
          ...myTips.flatMap((t) => t.split(/[\s,，]+/).filter(Boolean).slice(0, 4)),
        ],
        citeStart: i * 50 + 1,
        maxRetries,
        preferredDomains,
        signal,
        emit,
      });

      if (myTips.length) {
        finding.summary = `${finding.summary}\n\n（使用者中途補充：${myTips.join("；")}）`;
      }

      doneCount += 1;
      emit?.({
        type: "question_done",
        index: i + 1,
        total: questions.length,
        adequate: finding.adequate,
      });
      emit?.({
        type: "finding",
        index: i + 1,
        total: questions.length,
        finding: {
          question: finding.question,
          summary: finding.summary.slice(0, 1200),
          adequate: finding.adequate,
          retries: finding.retries,
          // omit provisional indices — final [n] remap happens after hunt
          sources: finding.sources.slice(0, 8).map((s) => ({
            ...s,
            index: 0,
          })),
          noteHits: finding.noteHits.slice(0, 4),
        },
      });
      emitProgress(emit, doneCount, questions.length, huntStarted, "hunt");
      emit?.({
        type: "log",
        level: "ok",
        message: `已完成子問題 ${i + 1}/${questions.length}${
          finding.retries ? `（含 ${finding.retries} 次自我修正）` : ""
        }`,
      });
      return finding;
    },
    signal
  );

  {
    const all = mergeAllSources(findings);
    emit?.({
      type: "sources",
      web: all.filter((s) => s.kind === "web").length,
      notes: all.filter((s) => s.kind === "note").length,
    });
  }

  // ── 5. Report ───────────────────────────────────────────
  throwIfAborted(signal);
  emit?.({ type: "phase", phase: "report", detail: "撰寫完整引用報告…" });
  emit?.({ type: "log", message: "正在整合發現、對照筆記並加上腳註…" });
  emitProgress(emit, questions.length, questions.length, huntStarted, "report");

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

  const synthContext = [
    opts?.context,
    extraContextBits.length
      ? `使用者中途補充方向：\n${extraContextBits.join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const { markdown, summary } = await synthesizeReport(topic, plan, findings, sources, {
    model,
    context: synthContext || undefined,
    intent,
    signal,
  });

  const webSources = sources.filter((s) => s.kind === "web");
  const noteSources = sources.filter((s) => s.kind === "note");
  const searchQueries = Array.from(new Set(findings.flatMap((f) => f.searchQueries)));

  emit?.({
    type: "log",
    level: "ok",
    message: `報告完成：${webSources.length} 個網路來源、${noteSources.length} 則筆記引用`,
  });
  emit?.({ type: "progress", pct: 100, done: questions.length, total: questions.length });

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
 * Re-hunt weak findings and/or add new questions, then rewrite the report.
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
    /** Re-hunt these existing questions; if omitted and no addQuestions, re-hunt inadequate */
    questions?: string[];
    /** Brand-new sub-questions to hunt and merge */
    addQuestions?: string[];
    signal?: AbortSignal;
    onProgress?: (e: ResearchProgressEvent) => void;
  }
): Promise<ResearchReport> {
  const emit = opts?.onProgress;
  const model = opts?.model;
  const signal = opts?.signal;
  const libraryNotes = opts?.libraryNotes || [];
  const preferredDomains = (opts?.preferredDomains || []).filter(Boolean).slice(0, 8);
  const maxRetries = opts?.maxRetries ?? 2;
  const addQuestions = (opts?.addQuestions || [])
    .map((q) => q.trim())
    .filter(Boolean)
    .slice(0, 4);

  const targets = new Set(
    (
      opts?.questions?.length
        ? opts.questions
        : addQuestions.length
          ? []
          : findings.filter((f) => !f.adequate).map((f) => f.question)
    ).map((q) => q.trim())
  );

  if (!targets.size && !addQuestions.length) {
    throw new Error("沒有需要重跑或新增的子問題");
  }

  if (targets.size) {
    emit?.({
      type: "phase",
      phase: "hunt",
      detail: `重跑 ${targets.size} 個子問題…`,
    });
    emit?.({
      type: "log",
      level: "retry",
      message: `選擇性補強：${Array.from(targets).join("；")}`,
    });
  }

  const next: ResearchFinding[] = [];
  let citeCursor = 1;

  for (let i = 0; i < findings.length; i++) {
    throwIfAborted(signal);
    const f = findings[i];
    if (!targets.has(f.question.trim())) {
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
      signal,
      emit,
    });
    citeCursor += updated.sources.length;
    emit?.({
      type: "finding",
      index: i + 1,
      total: findings.length,
      finding: {
        question: updated.question,
        summary: updated.summary.slice(0, 1200),
        adequate: updated.adequate,
        retries: updated.retries,
        sources: updated.sources.slice(0, 8),
        noteHits: updated.noteHits.slice(0, 4),
      },
    });
    next.push(updated);
  }

  for (let i = 0; i < addQuestions.length; i++) {
    throwIfAborted(signal);
    const q = addQuestions[i];
    emit?.({
      type: "phase",
      phase: "hunt",
      detail: `追問調查 ${i + 1}/${addQuestions.length}`,
    });
    emit?.({
      type: "question",
      index: next.length + 1,
      total: next.length + addQuestions.length - i,
      question: q,
    });
    const finding = await gatherOnQuestion(topic, q, {
      model,
      libraryNotes,
      keywordPool: plan.keywords,
      citeStart: citeCursor,
      maxRetries,
      preferredDomains,
      signal,
      emit,
    });
    citeCursor += finding.sources.length;
    emit?.({
      type: "finding",
      index: next.length + 1,
      total: next.length + addQuestions.length - i,
      finding: {
        question: finding.question,
        summary: finding.summary.slice(0, 1200),
        adequate: finding.adequate,
        retries: finding.retries,
        sources: finding.sources.slice(0, 8),
        noteHits: finding.noteHits.slice(0, 4),
      },
    });
    next.push(finding);
  }

  const mergedPlan: ResearchPlan = {
    ...plan,
    questions: Array.from(
      new Set([...plan.questions, ...addQuestions.map((q) => q.trim())])
    ).slice(0, 10),
  };

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

  emit?.({ type: "phase", phase: "report", detail: "依補強／追問結果重寫報告…" });
  throwIfAborted(signal);
  const { markdown, summary } = await synthesizeReport(
    topic,
    mergedPlan,
    next,
    sources,
    {
      model,
      context: opts?.context,
      intent: opts?.intent || plan.angle || topic,
      signal,
    }
  );

  const report: ResearchReport = {
    title: mergedPlan.title,
    summary,
    markdown,
    plan: mergedPlan,
    findings: next,
    sources,
    webSources: sources.filter((s) => s.kind === "web"),
    noteSources: sources.filter((s) => s.kind === "note"),
    searchQueries: Array.from(new Set(next.flatMap((f) => f.searchQueries))),
  };
  emit?.({
    type: "log",
    level: "ok",
    message: `更新完成：${next.length} 個子問題、${sources.length} 個來源`,
  });
  emit?.({ type: "done", report });
  return report;
}
