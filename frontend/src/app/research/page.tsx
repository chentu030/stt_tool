"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { createNote, listenToUserNotes, loginWithGoogle, type Note } from "@/lib/firebase";
import { searchNotes, type LibraryNote } from "@/lib/libraryIndex";
import { usePrefsOptional } from "@/components/PrefsProvider";
import ScrambleText from "@/components/motion/ScrambleText";

type Citation = {
  index: number;
  kind: "web" | "note";
  title: string;
  uri: string;
  noteId?: string;
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
  plan: {
    title: string;
    angle: string;
    questions: string[];
    keywords: string[];
  };
  findings: Finding[];
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

export default function DeepResearchPage() {
  const { user, loading } = useAuth();
  const prefs = usePrefsOptional();
  const [notes, setNotes] = useState<Note[]>([]);
  const [topic, setTopic] = useState("");
  const [context, setContext] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>("");
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [error, setError] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [clarifyQs, setClarifyQs] = useState<string[]>([]);
  const [clarifyAnswers, setClarifyAnswers] = useState<string[]>([]);
  const [assumedIntent, setAssumedIntent] = useState("");
  const [sourceStats, setSourceStats] = useState({ web: 0, notes: 0 });
  const [modelUsed, setModelUsed] = useState("");
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    return listenToUserNotes(user.uid, setNotes);
  }, [user]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const libraryNotes = useMemo(() => toLibraryNotes(notes), [notes]);
  const notePreview = useMemo(() => {
    if (!topic.trim()) return [];
    return searchNotes(libraryNotes, topic, { sort: "relevance" }).slice(0, 5);
  }, [libraryNotes, topic]);

  const pushLog = (message: string, level: LogItem["level"] = "info") => {
    setLogs((prev) => [
      ...prev,
      { id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, message, level, at: Date.now() },
    ]);
  };

  const runResearch = async (opts?: {
    skipClarify?: boolean;
    answers?: string;
  }) => {
    if (!topic.trim() || busy) return;
    setBusy(true);
    setError("");
    setReport(null);
    setSavedId(null);
    setClarifyQs([]);
    setPhase("clarify");
    setLogs([]);
    setSourceStats({ web: 0, notes: 0 });
    pushLog("啟動深度研究代理人…");
    pushLog(`模型：Gemini 3.1 Pro（Vertex）· 筆記庫 ${notes.length} 則`);

    const libraryPayload = buildLibraryPayload(libraryNotes, topic.trim());
    if (libraryPayload.length) {
      pushLog(`已打包 ${libraryPayload.length} 則相關筆記供內部檢索`, "ok");
    }

    try {
      const res = await fetch("/api/ai/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topic.trim(),
          context: context.trim() || undefined,
          model: prefs?.prefs.aiModel || "gemini-3.1-pro-preview",
          maxQuestions: 6,
          skipClarify: !!opts?.skipClarify,
          clarifyAnswers: opts?.answers || undefined,
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
            pushLog(
              String(event.message || ""),
              (event.level as LogItem["level"]) || "info"
            );
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
            const plan = event.plan as Report["plan"];
            if (plan?.keywords?.length) {
              pushLog(`關鍵字：${plan.keywords.slice(0, 6).join(" · ")}`, "ok");
            }
          } else if (type === "question") {
            pushLog(
              `子問題 ${event.index}/${event.total}：${event.question}`,
              "info"
            );
          } else if (type === "sources") {
            setSourceStats({
              web: Number(event.web) || 0,
              notes: Number(event.notes) || 0,
            });
          } else if (type === "done") {
            setReport({ ...(event.report as Report), model: streamModel });
            setPhase("");
            pushLog("深度研究完成", "ok");
          } else if (type === "error") {
            throw new Error(String(event.message || "研究失敗"));
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "研究失敗");
      pushLog(e instanceof Error ? e.message : "研究失敗", "warn");
    } finally {
      setBusy(false);
    }
  };

  const submitClarify = () => {
    const answers = clarifyQs
      .map((q, i) => `Q: ${q}\nA: ${clarifyAnswers[i]?.trim() || "（未答）"}`)
      .join("\n\n");
    void runResearch({ answers });
  };

  const skipClarify = () => {
    void runResearch({ skipClarify: true });
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

  if (loading) return <p style={{ padding: "2rem", color: "var(--text-muted)" }}>載入中…</p>;

  if (!user) {
    return (
      <div className="dr-page">
        <ScrambleText words="深度研究" as="h1" className="page-title font-display" />
        <p className="page-sub">登入後使用代理人工作流：釐清 → 規劃 → 內外搜尋 → 自我修正 → 引用報告。</p>
        <button type="button" className="btn" onClick={() => loginWithGoogle()}>
          登入
        </button>
      </div>
    );
  }

  return (
    <div className="dr-page">
      <header className="dr-head">
        <div>
          <ScrambleText words="深度研究" as="h1" className="page-title font-display" />
          <p className="page-sub">
            自主代理人：先釐清意圖，再混合搜尋網路與你的筆記庫，資料不足會自我修正，最後產出帶腳註的長文報告。
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
              placeholder="例如：2025–2026 生成式 AI 企業導入趨勢，對筆記／知識工作產品的啟示"
              value={topic}
              disabled={busy}
              onChange={(e) => setTopic(e.target.value)}
            />
          </label>
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
                  確認並開始研究
                </button>
                <button type="button" className="btn btn-ghost" onClick={skipClarify}>
                  跳過，直接研究
                </button>
              </div>
            </div>
          )}

          {clarifyQs.length === 0 && (
            <div className="dr-actions">
              <button
                type="button"
                className="btn"
                disabled={busy || !topic.trim()}
                onClick={() => void runResearch()}
              >
                {busy ? "代理人工作中…" : "開始深度研究"}
              </button>
            </div>
          )}

          {error && <p className="note-aside-error">{error}</p>}

          <div className="dr-howto">
            <h3>代理人四階段</h3>
            <ol>
              <li>
                <strong>釐清</strong>：不夠清楚會反問你
              </li>
              <li>
                <strong>規劃</strong>：產出計畫書與關鍵字
              </li>
              <li>
                <strong>混合獵人</strong>：Google 搜尋 + 筆記庫 RAG
              </li>
              <li>
                <strong>分析／報告</strong>：不足則換詞重搜，最後加 [n] 腳註
              </li>
            </ol>
            <p className="dr-hint">大腦模型：Gemini 3.1 Pro（Vertex）· 約需 2～5 分鐘</p>
          </div>
        </section>

        <section className="dr-result">
          {!report && !busy && clarifyQs.length === 0 && (
            <div className="dr-empty">
              <p>輸入主題後開始。過程會即時顯示思考步驟；完成後可一鍵存成筆記。</p>
            </div>
          )}

          {(busy || logs.length > 0) && !report && (
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
                <svg className="dr-graph-svg" viewBox="0 0 320 80" aria-hidden>
                  <circle cx="160" cy="40" r="18" className="dr-node-core" />
                  <text x="160" y="44" textAnchor="middle" className="dr-node-label">
                    報告
                  </text>
                  {(report.webSources || []).slice(0, 4).map((_, i) => {
                    const a = (-50 + i * 28) * (Math.PI / 180);
                    const x = 160 + Math.cos(a) * 90;
                    const y = 40 + Math.sin(a) * 28;
                    return (
                      <g key={`wg-${i}`}>
                        <line x1="160" y1="40" x2={x} y2={y} className="dr-edge-web" />
                        <circle cx={x} cy={y} r="5" className="dr-node-web" />
                      </g>
                    );
                  })}
                  {(report.noteSources || []).slice(0, 4).map((_, i) => {
                    const a = (130 + i * 28) * (Math.PI / 180);
                    const x = 160 + Math.cos(a) * 90;
                    const y = 40 + Math.sin(a) * 28;
                    return (
                      <g key={`ng-${i}`}>
                        <line x1="160" y1="40" x2={x} y2={y} className="dr-edge-note" />
                        <circle cx={x} cy={y} r="5" className="dr-node-note" />
                      </g>
                    );
                  })}
                </svg>
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

              <article className="dr-markdown">
                <pre className="dr-md-pre">{report.markdown}</pre>
              </article>

              {report.findings?.length > 0 && (
                <details className="dr-findings">
                  <summary>子問題筆記（{report.findings.length}）</summary>
                  {report.findings.map((f, i) => (
                    <div key={i} className="dr-finding">
                      <strong>
                        {i + 1}. {f.question}
                        {f.retries ? ` · 修正 ${f.retries} 次` : ""}
                        {!f.adequate ? " · 資料偏弱" : ""}
                      </strong>
                      <pre>{f.summary}</pre>
                    </div>
                  ))}
                </details>
              )}

              <p className="dr-queries">
                {report.searchQueries?.length
                  ? `搜尋詞：${report.searchQueries.join(" · ")}`
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
