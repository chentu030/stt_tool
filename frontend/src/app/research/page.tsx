"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { createNote, listenToUserNotes, loginWithGoogle, type Note } from "@/lib/firebase";
import { searchNotes, type LibraryNote } from "@/lib/libraryIndex";
import { usePrefsOptional } from "@/components/PrefsProvider";
import ScrambleText from "@/components/motion/ScrambleText";
import { markdownToHtml } from "@/lib/mdHtml";
import {
  RESEARCH_STARTERS,
  deleteResearchHistoryItem,
  loadResearchHistory,
  saveResearchHistoryItem,
  type ResearchHistoryItem,
} from "@/lib/researchHistory";

type Citation = {
  index: number;
  kind: "web" | "note";
  title: string;
  uri: string;
  noteId?: string;
};

type Plan = {
  title: string;
  angle: string;
  questions: string[];
  keywords: string[];
};

type Finding = {
  question: string;
  summary: string;
  sources: Citation[];
  searchQueries: string[];
  retries: number;
  noteHits: { id: string; title: string }[];
  adequate: boolean;
};

type Report = {
  title: string;
  summary: string;
  markdown: string;
  plan: Plan;
  findings?: Finding[];
  sources: Citation[];
  webSources: Citation[];
  noteSources: Citation[];
  searchQueries: string[];
  model?: string;
};

type LogItem = {
  id: string;
  message: string;
  level: "info" | "ok" | "warn" | "retry";
  at: number;
};

type Phase = "clarify" | "plan" | "hunt" | "analyze" | "report" | "";
type Depth = "standard" | "max";

const PHASE_LABEL: Record<string, string> = {
  clarify: "釐清意圖",
  plan: "規劃路徑",
  hunt: "混合搜尋",
  analyze: "閱讀萃取",
  report: "撰寫報告",
};

function toLibraryNotes(notes: Note[]): LibraryNote[] {
  return notes.map((n) => ({
    id: n.id,
    title: n.title || "未命名",
    body_md: n.body_md || "",
    tags: n.tags,
    folder: n.folder,
    journal_date: n.journal_date,
    status: n.status,
    icon: n.icon,
    source_job_id: n.source_job_id,
    updated_at: n.updated_at,
    created_at: n.created_at,
  }));
}

function buildLibraryPayload(notes: LibraryNote[], topic: string) {
  const ranked = searchNotes(notes, topic, { sort: topic.trim() ? "relevance" : "updated" });
  const pool = (ranked.length ? ranked : notes).slice(0, 28);
  return pool.map((n) => ({
    id: n.id,
    title: n.title,
    excerpt: (n.body_md || "").replace(/\s+/g, " ").trim().slice(0, 900),
    updatedAt: n.updated_at?.toISOString?.() || undefined,
  }));
}

function linkCitations(html: string, sources: Citation[]): string {
  const map = new Map(sources.map((s) => [s.index, s]));
  return html.replace(/\[(\d+)\]/g, (full, num) => {
    const s = map.get(Number(num));
    if (!s) return full;
    const external = s.kind === "web";
    const rel = external ? ' target="_blank" rel="noreferrer"' : "";
    return `<a class="dr-fn" href="${s.uri.replace(/"/g, "")}"${rel} title="${(s.title || "").replace(/"/g, "&quot;")}">[${num}]</a>`;
  });
}

export default function DeepResearchPage() {
  const { user, loading } = useAuth();
  const prefs = usePrefsOptional();
  const [notes, setNotes] = useState<Note[]>([]);
  const [topic, setTopic] = useState("");
  const [context, setContext] = useState("");
  const [depth, setDepth] = useState<Depth>("standard");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>("");
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [error, setError] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [clarifyQs, setClarifyQs] = useState<string[]>([]);
  const [clarifyAnswers, setClarifyAnswers] = useState<string[]>([]);
  const [assumedIntent, setAssumedIntent] = useState("");
  const [draftPlan, setDraftPlan] = useState<Plan | null>(null);
  const [sourceStats, setSourceStats] = useState({ web: 0, notes: 0 });
  const [modelUsed, setModelUsed] = useState("");
  const [history, setHistory] = useState<ResearchHistoryItem[]>([]);
  const [followUp, setFollowUp] = useState("");
  const [followBusy, setFollowBusy] = useState(false);
  const [followAnswer, setFollowAnswer] = useState("");
  const logEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!user) return;
    return listenToUserNotes(user.uid, setNotes);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    setHistory(loadResearchHistory(user.uid));
  }, [user]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const libraryNotes = useMemo(() => toLibraryNotes(notes), [notes]);
  const notePreview = useMemo(() => {
    if (!topic.trim()) return [];
    return searchNotes(libraryNotes, topic, { sort: "relevance" }).slice(0, 5);
  }, [libraryNotes, topic]);

  const renderedHtml = useMemo(() => {
    if (!report?.markdown) return "";
    try {
      const html = markdownToHtml(report.markdown);
      return linkCitations(html, report.sources || []);
    } catch {
      return "";
    }
  }, [report]);

  const pushLog = (message: string, level: LogItem["level"] = "info") => {
    setLogs((prev) => [
      ...prev,
      {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        message,
        level,
        at: Date.now(),
      },
    ]);
  };

  const cancelRun = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    pushLog("已中止研究", "warn");
  };

  const persistReport = (r: Report, topicText: string) => {
    if (!user) return;
    const list = saveResearchHistoryItem(user.uid, {
      topic: topicText,
      title: r.title,
      summary: r.summary,
      depth,
      model: r.model,
      webCount: r.webSources?.length || 0,
      noteCount: r.noteSources?.length || 0,
      report: {
        title: r.title,
        summary: r.summary,
        markdown: r.markdown,
        plan: r.plan,
        sources: r.sources || [],
        webSources: r.webSources || [],
        noteSources: r.noteSources || [],
        searchQueries: r.searchQueries || [],
        model: r.model,
      },
    });
    setHistory(list);
  };

  const runResearch = async (opts?: {
    skipClarify?: boolean;
    answers?: string;
    approvedPlan?: Plan;
    resetLogs?: boolean;
  }) => {
    if (!topic.trim() || busy) return;
    setBusy(true);
    setError("");
    setReport(null);
    setSavedId(null);
    setClarifyQs([]);
    setDraftPlan(null);
    setFollowAnswer("");
    setPhase(opts?.approvedPlan ? "hunt" : "clarify");
    if (opts?.resetLogs !== false) {
      setLogs([]);
      setSourceStats({ web: 0, notes: 0 });
      pushLog("啟動深度研究代理人…");
      pushLog(
        `模型：Gemini 3.1 Pro · 模式 ${depth === "max" ? "Max" : "標準"} · 筆記庫 ${notes.length} 則`
      );
    } else {
      pushLog("依核准計畫繼續執行搜尋與報告…", "ok");
    }

    const libraryPayload = buildLibraryPayload(libraryNotes, topic.trim());
    if (libraryPayload.length && opts?.resetLogs !== false) {
      pushLog(`已打包 ${libraryPayload.length} 則相關筆記供內部檢索`, "ok");
    }

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const res = await fetch("/api/ai/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ac.signal,
        body: JSON.stringify({
          topic: topic.trim(),
          context: context.trim() || undefined,
          model: prefs?.prefs.aiModel || "gemini-3.1-pro-preview",
          depth,
          skipClarify: !!opts?.skipClarify || !!opts?.approvedPlan,
          clarifyAnswers: opts?.answers || undefined,
          approvedPlan: opts?.approvedPlan || undefined,
          requirePlanApproval: !opts?.approvedPlan,
          libraryNotes: libraryPayload,
          stream: true,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "研究失敗");
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("無法讀取串流回應");

      const decoder = new TextDecoder();
      let buffer = "";
      let streamModel = "gemini-3.1-pro-preview";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const chunk of parts) {
          const line = chunk
            .split("\n")
            .map((l) => l.trim())
            .find((l) => l.startsWith("data:"));
          if (!line) continue;
          const raw = line.slice(5).trim();
          if (!raw) continue;
          let event: Record<string, unknown>;
          try {
            event = JSON.parse(raw);
          } catch {
            continue;
          }

          const type = event.type as string;
          if (type === "meta" && typeof event.model === "string") {
            streamModel = event.model;
            setModelUsed(event.model);
          } else if (type === "log") {
            pushLog(String(event.message || ""), (event.level as LogItem["level"]) || "info");
          } else if (type === "phase") {
            setPhase((event.phase as Phase) || "");
            if (event.detail) pushLog(String(event.detail));
          } else if (type === "clarify") {
            const qs = (event.questions as string[]) || [];
            setClarifyQs(qs);
            setClarifyAnswers(qs.map(() => ""));
            setAssumedIntent(String(event.assumedIntent || ""));
            pushLog("等待你回答澄清問題…", "warn");
          } else if (type === "plan") {
            const plan = event.plan as Plan;
            if (event.awaitingApproval) {
              setDraftPlan({
                title: plan.title || topic.slice(0, 40),
                angle: plan.angle || "",
                questions: [...(plan.questions || [])],
                keywords: [...(plan.keywords || [])],
              });
              setAssumedIntent(String(event.intent || assumedIntent || ""));
              pushLog("研究計畫已就緒，請審核後繼續", "warn");
            } else if (plan?.keywords?.length) {
              pushLog(`關鍵字：${plan.keywords.slice(0, 6).join(" · ")}`, "ok");
            }
          } else if (type === "question") {
            pushLog(`子問題 ${event.index}/${event.total}：${event.question}`, "info");
          } else if (type === "sources") {
            setSourceStats({
              web: Number(event.web) || 0,
              notes: Number(event.notes) || 0,
            });
          } else if (type === "done") {
            const r = { ...(event.report as Report), model: streamModel };
            setReport(r);
            setPhase("");
            setDraftPlan(null);
            pushLog("深度研究完成", "ok");
            persistReport(r, topic.trim());
          } else if (type === "error") {
            throw new Error(String(event.message || "研究失敗"));
          }
        }
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        /* cancelled */
      } else {
        setError(e instanceof Error ? e.message : "研究失敗");
        pushLog(e instanceof Error ? e.message : "研究失敗", "warn");
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  };

  const submitClarify = () => {
    const answers = clarifyQs
      .map((q, i) => `Q: ${q}\nA: ${clarifyAnswers[i]?.trim() || "（未答）"}`)
      .join("\n\n");
    void runResearch({ answers });
  };

  const approvePlan = () => {
    if (!draftPlan) return;
    const cleaned: Plan = {
      title: draftPlan.title.trim() || topic.slice(0, 40),
      angle: draftPlan.angle.trim(),
      questions: draftPlan.questions.map((q) => q.trim()).filter(Boolean).slice(0, 8),
      keywords: draftPlan.keywords.map((k) => k.trim()).filter(Boolean).slice(0, 12),
    };
    if (!cleaned.questions.length) {
      setError("至少保留一個子問題");
      return;
    }
    void runResearch({ approvedPlan: cleaned, skipClarify: true, resetLogs: false });
  };

  const saveNote = async () => {
    if (!user || !report) return;
    const webList = report.webSources
      .map((s) => `${s.index}. [${s.title}](${s.uri})`)
      .join("\n");
    const noteList = report.noteSources
      .map((s) => `${s.index}. [${s.title}](${s.uri})`)
      .join("\n");
    const body = `# ${report.title}

> 由 Cadence 深度研究產生 · ${report.model || "gemini-3.1-pro-preview"}

## 摘要

${report.summary}

${report.markdown}

---

## 來源圖譜

### 網路
${webList || "（無）"}

### 筆記
${noteList || "（無）"}
`;
    const id = await createNote(user.uid, report.title, body, undefined, ["深度研究"]);
    setSavedId(id);
  };

  const askFollowUp = async () => {
    if (!report || !followUp.trim() || followBusy) return;
    setFollowBusy(true);
    setFollowAnswer("");
    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "chat",
          prompt: followUp.trim(),
          context: `—— 深度研究報告脈絡 ——\n研究主題：${topic}\n報告標題：${report.title}\n\n摘要：\n${report.summary}\n\n報告正文（節錄）：\n${report.markdown.slice(0, 12000)}\n\n來源：\n${(report.sources || [])
            .map((s) => `[${s.index}] ${s.title} ${s.uri}`)
            .join("\n")}\n—— 結束 ——`,
          assistant: {
            name: prefs?.prefs.aiAssistantName,
            style: prefs?.prefs.aiStyle,
            model: prefs?.prefs.aiModel || "gemini-3.1-pro-preview",
            grounding: true,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "追問失敗");
      setFollowAnswer(data.text || "（沒有回覆）");
    } catch (e) {
      setFollowAnswer(e instanceof Error ? e.message : "追問失敗");
    } finally {
      setFollowBusy(false);
    }
  };

  const openHistory = (item: ResearchHistoryItem) => {
    setTopic(item.topic);
    setReport({ ...item.report, findings: [] });
    setModelUsed(item.model || item.report.model || "");
    setSavedId(null);
    setClarifyQs([]);
    setDraftPlan(null);
    setLogs([]);
    setFollowAnswer("");
  };

  if (loading) return <p style={{ padding: "2rem", color: "var(--text-muted)" }}>載入中…</p>;

  if (!user) {
    return (
      <div className="dr-page">
        <ScrambleText words="深度研究" as="h1" className="page-title font-display" />
        <p className="page-sub">登入後使用代理人工作流：釐清 → 審核計畫 → 內外搜尋 → 自我修正 → 引用報告。</p>
        <button type="button" className="btn" onClick={() => loginWithGoogle()}>
          登入
        </button>
      </div>
    );
  }

  const showStart =
    !busy && clarifyQs.length === 0 && !draftPlan;

  return (
    <div className="dr-page">
      <header className="dr-head">
        <div>
          <ScrambleText words="深度研究" as="h1" className="page-title font-display" />
          <p className="page-sub">
            對齊 OpenAI／Gemini：可審核計畫、標準／Max 深度、即時思考、筆記混合搜尋、可點引用與追問。
          </p>
        </div>
      </header>

      <div className="dr-layout">
        <section className="dr-form">
          <label className="dr-label">
            研究主題
            <textarea
              className="input"
              rows={3}
              placeholder="例如：2026 遠端團隊協作工具趨勢…"
              value={topic}
              disabled={busy}
              onChange={(e) => setTopic(e.target.value)}
            />
          </label>

          <div className="dr-starters">
            {RESEARCH_STARTERS.map((s) => (
              <button
                key={s}
                type="button"
                className="dr-starter"
                disabled={busy}
                onClick={() => setTopic(s)}
              >
                {s.length > 28 ? `${s.slice(0, 28)}…` : s}
              </button>
            ))}
          </div>

          <label className="dr-label">
            補充脈絡（選填）
            <textarea
              className="input"
              rows={2}
              placeholder="產業、受眾、已知假設、排除範圍…"
              value={context}
              disabled={busy}
              onChange={(e) => setContext(e.target.value)}
            />
          </label>

          <div className="dr-depth">
            <span className="dr-depth-label">研究深度</span>
            <div className="dr-depth-btns">
              <button
                type="button"
                className={`btn btn-sm${depth === "standard" ? "" : " btn-ghost"}`}
                disabled={busy}
                onClick={() => setDepth("standard")}
              >
                標準 · 較快
              </button>
              <button
                type="button"
                className={`btn btn-sm${depth === "max" ? "" : " btn-ghost"}`}
                disabled={busy}
                onClick={() => setDepth("max")}
              >
                Max · 更完整
              </button>
            </div>
            <p className="dr-hint">
              {depth === "max"
                ? "最多 7 子問題、自我修正 2 次（約 3～6 分鐘）"
                : "最多 5 子問題、自我修正 1 次（約 2～4 分鐘）"}
            </p>
          </div>

          {notePreview.length > 0 && (
            <div className="dr-note-preview">
              <h4>可能用到的筆記</h4>
              <ul>
                {notePreview.map((n) => (
                  <li key={n.id}>
                    <Link href={`/notes/${n.id}`}>{n.title}</Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {clarifyQs.length > 0 && !busy && !report && (
            <div className="dr-clarify">
              <h3>請先釐清幾點</h3>
              {assumedIntent && <p className="dr-angle">目前猜測：{assumedIntent}</p>}
              {clarifyQs.map((q, i) => (
                <label key={q} className="dr-label">
                  {q}
                  <input
                    className="input"
                    value={clarifyAnswers[i] || ""}
                    onChange={(e) => {
                      const next = [...clarifyAnswers];
                      next[i] = e.target.value;
                      setClarifyAnswers(next);
                    }}
                    placeholder="你的回答…"
                  />
                </label>
              ))}
              <div className="dr-actions">
                <button type="button" className="btn" onClick={submitClarify}>
                  確認並規劃
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void runResearch({ skipClarify: true })}
                >
                  跳過
                </button>
              </div>
            </div>
          )}

          {draftPlan && !busy && (
            <div className="dr-plan-edit">
              <h3>審核研究計畫</h3>
              {assumedIntent && <p className="dr-angle">意圖：{assumedIntent}</p>}
              <label className="dr-label">
                報告標題
                <input
                  className="input"
                  value={draftPlan.title}
                  onChange={(e) => setDraftPlan({ ...draftPlan, title: e.target.value })}
                />
              </label>
              <label className="dr-label">
                切入角度
                <input
                  className="input"
                  value={draftPlan.angle}
                  onChange={(e) => setDraftPlan({ ...draftPlan, angle: e.target.value })}
                />
              </label>
              <label className="dr-label">
                子問題（每行一題）
                <textarea
                  className="input"
                  rows={6}
                  value={draftPlan.questions.join("\n")}
                  onChange={(e) =>
                    setDraftPlan({
                      ...draftPlan,
                      questions: e.target.value.split("\n"),
                    })
                  }
                />
              </label>
              <label className="dr-label">
                關鍵字（逗號分隔）
                <input
                  className="input"
                  value={draftPlan.keywords.join(", ")}
                  onChange={(e) =>
                    setDraftPlan({
                      ...draftPlan,
                      keywords: e.target.value.split(/[,，]/).map((s) => s.trim()),
                    })
                  }
                />
              </label>
              <div className="dr-actions">
                <button type="button" className="btn" onClick={approvePlan}>
                  核准並開始搜尋
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setDraftPlan(null);
                    setLogs([]);
                  }}
                >
                  取消
                </button>
              </div>
            </div>
          )}

          {showStart && (
            <div className="dr-actions">
              <button
                type="button"
                className="btn"
                disabled={!topic.trim()}
                onClick={() => void runResearch()}
              >
                開始深度研究
              </button>
            </div>
          )}

          {busy && (
            <div className="dr-actions">
              <button type="button" className="btn btn-ghost" onClick={cancelRun}>
                中止
              </button>
              <span className="dr-status">代理人工作中…</span>
            </div>
          )}

          {error && <p className="note-aside-error">{error}</p>}

          {history.length > 0 && (
            <div className="dr-history">
              <h3>最近報告</h3>
              <ul>
                {history.slice(0, 6).map((h) => (
                  <li key={h.id}>
                    <button type="button" className="dr-history-open" onClick={() => openHistory(h)}>
                      <strong>{h.title}</strong>
                      <span>{new Date(h.at).toLocaleString("zh-TW")}</span>
                    </button>
                    <button
                      type="button"
                      className="dr-history-del"
                      title="刪除"
                      onClick={() => setHistory(deleteResearchHistoryItem(user.uid, h.id))}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="dr-howto">
            <h3>流程</h3>
            <ol>
              <li>
                <strong>釐清</strong> → <strong>審核計畫</strong>
              </li>
              <li>
                <strong>混合獵人</strong>（網路 + 筆記）
              </li>
              <li>
                <strong>自我修正</strong> → <strong>引用報告</strong>
              </li>
            </ol>
          </div>
        </section>

        <section className="dr-result">
          {!report && !busy && !draftPlan && clarifyQs.length === 0 && logs.length === 0 && (
            <div className="dr-empty">
              <p>選一個範例主題，或自己輸入。開始後可審核計畫，過程會即時顯示思考步驟。</p>
            </div>
          )}

          {(busy || (logs.length > 0 && !report)) && (
            <div className="dr-thinking">
              <div className="dr-thinking-head">
                <div>
                  <strong>透明思考過程</strong>
                  {phase && (
                    <span className="dr-phase-pill">{PHASE_LABEL[phase] || phase}</span>
                  )}
                </div>
                <span className="dr-src-stat">
                  網路 {sourceStats.web} · 筆記 {sourceStats.notes}
                </span>
              </div>
              {busy && <div className="dr-busy-bar" />}
              <ul className="dr-log">
                {logs.map((l) => (
                  <li key={l.id} className={`dr-log-item is-${l.level}`}>
                    <span className="dr-log-mark">
                      {l.level === "ok"
                        ? "✓"
                        : l.level === "retry"
                          ? "↻"
                          : l.level === "warn"
                            ? "!"
                            : "·"}
                    </span>
                    <span>{l.message}</span>
                  </li>
                ))}
                <div ref={logEndRef} />
              </ul>
            </div>
          )}

          {report && (
            <div className="dr-card">
              <div className="dr-result-bar">
                <h2>{report.title}</h2>
                <div className="dr-result-actions">
                  <button type="button" className="btn btn-sm" onClick={() => void saveNote()}>
                    {savedId ? "已存筆記" : "一鍵轉筆記"}
                  </button>
                  {savedId && (
                    <Link href={`/notes/${savedId}`} className="btn btn-sm btn-soft">
                      開啟筆記
                    </Link>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => void navigator.clipboard.writeText(report.markdown)}
                  >
                    複製 Markdown
                  </button>
                </div>
              </div>

              {report.plan?.angle && <p className="dr-angle">{report.plan.angle}</p>}

              <div className="dr-summary-card">
                <h3>摘要</h3>
                <p>{report.summary}</p>
              </div>

              <div className="dr-source-graph">
                <h3>來源圖譜</h3>
                <div className="dr-graph-grid">
                  <div className="dr-graph-col">
                    <h4>網路（{report.webSources?.length || 0}）</h4>
                    <ul>
                      {(report.webSources || []).map((s) => (
                        <li key={`w-${s.index}`}>
                          <span className="dr-cite">[{s.index}]</span>{" "}
                          <a href={s.uri} target="_blank" rel="noreferrer">
                            {s.title}
                          </a>
                        </li>
                      ))}
                      {!report.webSources?.length && <li className="dr-muted">無</li>}
                    </ul>
                  </div>
                  <div className="dr-graph-col">
                    <h4>筆記（{report.noteSources?.length || 0}）</h4>
                    <ul>
                      {(report.noteSources || []).map((s) => (
                        <li key={`n-${s.index}`}>
                          <span className="dr-cite">[{s.index}]</span>{" "}
                          <Link href={s.uri}>{s.title}</Link>
                        </li>
                      ))}
                      {!report.noteSources?.length && <li className="dr-muted">無</li>}
                    </ul>
                  </div>
                </div>
              </div>

              <article
                className="dr-markdown prose-dr"
                dangerouslySetInnerHTML={{ __html: renderedHtml || `<pre>${report.markdown}</pre>` }}
              />

              <div className="dr-follow">
                <h3>追問這份報告</h3>
                <div className="dr-follow-row">
                  <input
                    className="input"
                    placeholder="例如：把結論改成給產品經理的三點行動…"
                    value={followUp}
                    disabled={followBusy}
                    onChange={(e) => setFollowUp(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void askFollowUp();
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={followBusy || !followUp.trim()}
                    onClick={() => void askFollowUp()}
                  >
                    {followBusy ? "…" : "追問"}
                  </button>
                </div>
                {followAnswer && <pre className="dr-follow-ans">{followAnswer}</pre>}
              </div>

              {logs.length > 0 && (
                <details className="dr-steps">
                  <summary>研究過程（{logs.length}）</summary>
                  <ul>
                    {logs.map((l) => (
                      <li key={l.id}>{l.message}</li>
                    ))}
                  </ul>
                </details>
              )}

              <p className="dr-queries">
                {report.searchQueries?.length
                  ? `搜尋詞：${report.searchQueries.slice(0, 8).join(" · ")}`
                  : ""}
                {report.model || modelUsed
                  ? ` · 模型 ${report.model || modelUsed}`
                  : ""}
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
