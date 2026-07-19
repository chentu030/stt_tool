"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { createNote, loginWithGoogle } from "@/lib/firebase";
import { usePrefsOptional } from "@/components/PrefsProvider";
import ScrambleText from "@/components/motion/ScrambleText";

type Source = { title: string; uri: string };
type Finding = {
  question: string;
  summary: string;
  sources: Source[];
  searchQueries: string[];
};
type Report = {
  title: string;
  markdown: string;
  plan: { title: string; angle: string; questions: string[] };
  findings: Finding[];
  sources: Source[];
  searchQueries: string[];
  model?: string;
  steps?: { phase: string; detail: string }[];
};

const PHASE_LABEL: Record<string, string> = {
  plan: "規劃",
  gather: "搜尋調查",
  synthesize: "彙整報告",
};

export default function DeepResearchPage() {
  const { user, loading } = useAuth();
  const prefs = usePrefsOptional();
  const [topic, setTopic] = useState("");
  const [context, setContext] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const abortRef = useRef(false);

  const run = async () => {
    if (!topic.trim() || busy) return;
    setBusy(true);
    setError("");
    setReport(null);
    setSavedId(null);
    setStatus("規劃研究計畫…（深度研究通常需 1～3 分鐘）");
    abortRef.current = false;
    try {
      const res = await fetch("/api/ai/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topic.trim(),
          context: context.trim() || undefined,
          model: prefs?.prefs.aiModel,
          maxQuestions: 5,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "研究失敗");
      setReport(data as Report);
      setStatus("完成");
    } catch (e) {
      setError(e instanceof Error ? e.message : "研究失敗");
      setStatus("");
    } finally {
      setBusy(false);
    }
  };

  const saveNote = async () => {
    if (!user || !report) return;
    const body = `# ${report.title}\n\n> 由 Cadence 深度研究產生\n\n${report.markdown}\n\n---\n\n## 來源\n\n${report.sources
      .map((s, i) => `${i + 1}. [${s.title}](${s.uri})`)
      .join("\n")}\n`;
    const id = await createNote(user.uid, report.title, body, undefined, ["深度研究"]);
    setSavedId(id);
  };

  if (loading) return <p style={{ padding: "2rem", color: "var(--text-muted)" }}>載入中…</p>;

  if (!user) {
    return (
      <div className="dr-page">
        <ScrambleText words="深度研究" as="h1" className="page-title font-display" />
        <p className="page-sub">登入後使用多步驟 AI 研究（規劃 → 搜尋 → 彙整引用報告）。</p>
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
            仿照 OpenAI／Gemini Deep Research：先規劃子問題，再多次上網搜尋，最後合成完整引用報告。
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
              placeholder="例如：2026 年遠端團隊協作工具的趨勢與 Cadence 可借鏡之處"
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
              placeholder="你的產業、預算、已知假設…"
              value={context}
              disabled={busy}
              onChange={(e) => setContext(e.target.value)}
            />
          </label>
          <div className="dr-actions">
            <button
              type="button"
              className="btn"
              disabled={busy || !topic.trim()}
              onClick={() => void run()}
            >
              {busy ? "研究中…" : "開始深度研究"}
            </button>
            {busy && <span className="dr-status">{status}</span>}
          </div>
          {error && <p className="note-aside-error">{error}</p>}

          <div className="dr-howto">
            <h3>怎麼做到「完整」</h3>
            <ol>
              <li>
                <strong>規劃</strong>：拆成 4～6 個可驗證子問題（業界的 Plan 階段）
              </li>
              <li>
                <strong>搜尋調查</strong>：每個子問題啟用 Google Search grounding 取證
              </li>
              <li>
                <strong>彙整</strong>：合成長文報告並附來源清單（Perplexity／Gemini 式引用）
              </li>
            </ol>
          </div>
        </section>

        <section className="dr-result">
          {!report && !busy && (
            <div className="dr-empty">
              <p>輸入主題後開始。報告可存成筆記，繼續用白板／圖譜整理。</p>
            </div>
          )}
          {busy && (
            <div className="dr-busy">
              <div className="dr-busy-bar" />
              <p>{status || "處理中…"}</p>
              <p className="dr-hint">會連續呼叫多次模型＋搜尋，請稍候勿關閉分頁。</p>
            </div>
          )}
          {report && (
            <>
              <div className="dr-result-bar">
                <h2>{report.title}</h2>
                <div className="dr-result-actions">
                  <button type="button" className="btn btn-sm" onClick={() => void saveNote()}>
                    {savedId ? "已存筆記" : "存成筆記"}
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
              {report.steps && report.steps.length > 0 && (
                <details className="dr-steps">
                  <summary>研究步驟（{report.steps.length}）</summary>
                  <ul>
                    {report.steps.map((s, i) => (
                      <li key={i}>
                        <em>{PHASE_LABEL[s.phase] || s.phase}</em> — {s.detail}
                      </li>
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
                      </strong>
                      <pre>{f.summary}</pre>
                    </div>
                  ))}
                </details>
              )}
              {report.sources?.length > 0 && (
                <div className="dr-sources">
                  <h3>來源（{report.sources.length}）</h3>
                  <ol>
                    {report.sources.map((s, i) => (
                      <li key={s.uri + i}>
                        <a href={s.uri} target="_blank" rel="noreferrer">
                          {s.title || s.uri}
                        </a>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
              {report.searchQueries?.length > 0 && (
                <p className="dr-queries">
                  搜尋詞：{report.searchQueries.join(" · ")}
                  {report.model ? ` · 模型 ${report.model}` : ""}
                </p>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
