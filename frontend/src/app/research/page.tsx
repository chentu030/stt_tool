"use client";

import { useEffect, useMemo, useRef, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import {
  createNote,
  getNote,
  listenToUserNotes,
  loginWithGoogle,
  updateNote,
  type Note,
} from "@/lib/firebase";
import { searchNotes, packLibraryContext, type LibraryNote } from "@/lib/libraryIndex";
import { usePrefsOptional } from "@/components/PrefsProvider";
import ScrambleText from "@/components/motion/ScrambleText";
import { markdownToHtml } from "@/lib/mdHtml";
import {
  downloadDocx,
  downloadMarkdown,
  downloadPdfViaPrint,
  downloadPptOutline,
} from "@/lib/exportNote";
import {
  RESEARCH_STARTERS,
  deleteResearchHistoryItem,
  loadResearchHistory,
  saveResearchHistoryItem,
  type ResearchHistoryItem,
} from "@/lib/researchHistory";
import {
  formatResearchInsertBlock,
  formatResearchNoteBody,
  notesToResearchSnippets,
  parseNotesParam,
  expandScopeWithWiki,
  stashResearchInsert,
  takeResearchSelection,
} from "@/lib/researchBridge";
import { extractWikiLinks } from "@/lib/wiki";
import ContinueChips, { researchContinueChips } from "@/components/shell/ContinueChips";
import { libraryFolderUrl, RESEARCH_FOLDER } from "@/lib/navApps";

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
  noteHits: { id: string; title: string; excerpt?: string }[];
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

type ChatMsg = { id: string; role: "user" | "assistant"; text: string };

type Phase = "clarify" | "plan" | "hunt" | "analyze" | "report" | "";
type Depth = "standard" | "max";

const PHASE_LABEL: Record<string, string> = {
  clarify: "釐清意圖",
  plan: "規劃路徑",
  hunt: "混合搜尋",
  analyze: "閱讀萃取",
  report: "撰寫報告",
};

const TRANSFORMS: { id: string; label: string; action: string; prompt: string }[] = [
  {
    id: "actions",
    label: "待辦清單",
    action: "actions",
    prompt: "從這份研究報告抽出可執行待辦",
  },
  {
    id: "table",
    label: "比較表",
    action: "make_table",
    prompt: "把報告核心比較點整理成表格",
  },
  {
    id: "outline",
    label: "簡報大綱",
    action: "outline",
    prompt: "把報告改成適合簡報的 Markdown 大綱（## 為投影片）",
  },
  {
    id: "faq",
    label: "FAQ",
    action: "chat",
    prompt:
      "把這份研究報告改寫成 FAQ（常見問題集）。用繁體中文，8～12 組 Q&A，先列最可能被問的問題；答案要簡短可驗證，能引用處保留 [n]。",
  },
  {
    id: "brief",
    label: "一頁簡報",
    action: "chat",
    prompt:
      "把報告濃縮成一頁決策簡報（繁體中文）：背景三句、已確立三點、爭議一點、不確定一點、下一步三項。",
  },
];

function extractToc(md: string): { id: string; text: string; level: number }[] {
  const out: { id: string; text: string; level: number }[] = [];
  let inFence = false;
  for (const line of (md || "").split("\n")) {
    if (/^```/.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{2,3})\s+(.+)$/.exec(line.trim());
    if (!m) continue;
    const text = m[2].replace(/\[(\d+)\]/g, "").trim();
    const slug = text
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fff-]+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 40);
    const id = `toc-${out.length}-${slug || "h"}`;
    out.push({ id, text, level: m[1].length });
  }
  return out.slice(0, 24);
}

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

function buildLibraryPayload(
  notes: LibraryNote[],
  topic: string,
  selectedIds?: string[]
) {
  if (selectedIds?.length) {
    return notesToResearchSnippets(notes, {
      selectedIds,
      limit: 40,
      excerptChars: 1800,
    });
  }
  return notesToResearchSnippets(notes, {
    query: topic,
    limit: 28,
    excerptChars: 1800,
  });
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

function reportExportBody(report: Report, sourceTitle?: string): string {
  return formatResearchNoteBody({
    title: report.title,
    summary: report.summary,
    markdown: report.markdown,
    model: report.model,
    sourceNoteTitle: sourceTitle,
    webSources: report.webSources,
    noteSources: report.noteSources,
  }).replace(/^# .+\n\n/, "");
}

export default function DeepResearchPage() {
  return (
    <Suspense fallback={<p style={{ padding: "2rem", color: "var(--text-muted)" }}>載入中…</p>}>
      <DeepResearchPageInner />
    </Suspense>
  );
}

function DeepResearchPageInner() {
  const { user, loading } = useAuth();
  const prefs = usePrefsOptional();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [notes, setNotes] = useState<Note[]>([]);
  const [topic, setTopic] = useState("");
  const [context, setContext] = useState("");
  const [domains, setDomains] = useState("");
  const [depth, setDepth] = useState<Depth>("standard");
  const [timeRange, setTimeRange] = useState<"any" | "ytd" | "1y" | "2y">("1y");
  const [sourceNoteId, setSourceNoteId] = useState<string | null>(null);
  const [sourceNoteTitle, setSourceNoteTitle] = useState("");
  const [scopeIds, setScopeIds] = useState<string[]>([]);
  const [scopeQ, setScopeQ] = useState("");
  const [wantReturn, setWantReturn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<Phase>("");
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [error, setError] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [clarifyQs, setClarifyQs] = useState<string[]>([]);
  const [clarifyAnswers, setClarifyAnswers] = useState<string[]>([]);
  const [assumedIntent, setAssumedIntent] = useState("");
  const seededRef = useRef(false);
  const [draftPlan, setDraftPlan] = useState<Plan | null>(null);
  const [sourceStats, setSourceStats] = useState({ web: 0, notes: 0 });
  const [modelUsed, setModelUsed] = useState("");
  const [history, setHistory] = useState<ResearchHistoryItem[]>([]);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [followUp, setFollowUp] = useState("");
  const [followBusy, setFollowBusy] = useState(false);
  const [transformBusy, setTransformBusy] = useState("");
  const [transformOut, setTransformOut] = useState("");
  const [runId, setRunId] = useState("");
  const [progressPct, setProgressPct] = useState(0);
  const [etaSec, setEtaSec] = useState<number | undefined>();
  const [checklist, setChecklist] = useState<
    { q: string; status: "pending" | "active" | "done" | "weak" }[]
  >([]);
  const [guidance, setGuidance] = useState("");
  const [guidanceBusy, setGuidanceBusy] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [liveFindings, setLiveFindings] = useState<
    {
      index: number;
      question: string;
      summary: string;
      adequate: boolean;
      retries: number;
      sources: { index: number; kind: string; title: string; uri: string }[];
    }[]
  >([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef("");
  const runGenRef = useRef(0);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const logsRef = useRef<LogItem[]>([]);
  const savedIdRef = useRef<string | null>(null);

  useEffect(() => {
    logsRef.current = logs;
  }, [logs]);

  useEffect(() => {
    savedIdRef.current = savedId;
  }, [savedId]);

  const isAbortError = (e: unknown) =>
    (e instanceof DOMException && e.name === "AbortError") ||
    (e instanceof Error && (e.name === "AbortError" || /aborted|中止/i.test(e.message)));

  const scrollToHeading = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  useEffect(() => {
    if (!user) return;
    return listenToUserNotes(user.uid, setNotes);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    setHistory(loadResearchHistory(user.uid));
  }, [user]);

  // Seed from notebook / library URL params
  useEffect(() => {
    if (seededRef.current || !user) return;
    const from = searchParams.get("from");
    const notesParam = parseNotesParam(searchParams.get("notes"));
    const topicParam = searchParams.get("topic");
    const returnTo = searchParams.get("returnTo") === "1";
    if (!from && !notesParam.length && !topicParam && searchParams.get("sel") !== "1") {
      seededRef.current = true;
      return;
    }
    seededRef.current = true;
    setWantReturn(returnTo && !!from);
    if (notesParam.length) setScopeIds(notesParam);
    if (topicParam) setTopic(topicParam);

    if (searchParams.get("sel") === "1") {
      const sel = takeResearchSelection();
      if (sel) {
        setContext((prev) =>
          prev.trim()
            ? prev
            : `使用者框選內容：\n${sel.slice(0, 4000)}`
        );
        if (!topicParam) setTopic(sel.slice(0, 80).replace(/\s+/g, " "));
      }
    }

    if (from) {
      setSourceNoteId(from);
      setScopeIds((prev) => (prev.includes(from) ? prev : [from, ...prev].slice(0, 40)));
      void getNote(from).then((n) => {
        if (!n || n.user_id !== user.uid) return;
        setSourceNoteTitle(n.title || "未命名");
        if (!topicParam && !searchParams.get("sel")) setTopic(n.title || "");
        const body = (n.body_md || "").trim();
        if (body && searchParams.get("sel") !== "1") {
          setContext((prev) =>
            prev.trim()
              ? prev
              : `來源筆記《${n.title}》：\n${body.slice(0, 4000)}`
          );
        }
      });
    }
  }, [user, searchParams]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  useEffect(() => {
    if (!busy) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [busy]);

  useEffect(() => {
    if (!exportOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!exportMenuRef.current?.contains(e.target as Node)) setExportOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExportOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("keydown", onKey);
    };
  }, [exportOpen]);

  const libraryNotes = useMemo(() => toLibraryNotes(notes), [notes]);

  // When scope notes change, enrich context with packed library (multi-note)
  useEffect(() => {
    if (!scopeIds.length || !libraryNotes.length) return;
    if (context.trim().length > 500) return;
    const packed = packLibraryContext(libraryNotes, topic || sourceNoteTitle || "研究", {
      selectedIds: scopeIds,
      maxNotes: Math.min(8, scopeIds.length),
      maxChars: 10000,
    });
    if (packed.context.trim()) {
      setContext((prev) =>
        prev.trim() ? prev : `—— 研究範圍筆記 ——\n${packed.context}`
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeIds.join(","), libraryNotes.length]);

  const notePreview = useMemo(() => {
    if (scopeIds.length) {
      return libraryNotes.filter((n) => scopeIds.includes(n.id)).slice(0, 8);
    }
    if (!topic.trim()) return [];
    return searchNotes(libraryNotes, topic, { sort: "relevance" }).slice(0, 5);
  }, [libraryNotes, topic, scopeIds]);

  const scopeCandidates = useMemo(() => {
    const q = scopeQ.trim().toLowerCase();
    const list = q
      ? libraryNotes.filter(
          (n) =>
            n.title.toLowerCase().includes(q) ||
            (n.body_md || "").toLowerCase().includes(q)
        )
      : libraryNotes;
    return list.slice(0, 12);
  }, [libraryNotes, scopeQ]);

  const toggleScope = (id: string) => {
    setScopeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(0, 40)
    );
  };

  const preferredDomains = useMemo(
    () =>
      domains
        .split(/[,，\s]+/)
        .map((d) => d.trim())
        .filter(Boolean)
        .slice(0, 8),
    [domains]
  );

  const toc = useMemo(() => (report ? extractToc(report.markdown) : []), [report]);

  const renderedHtml = useMemo(() => {
    if (!report?.markdown) return "";
    try {
      let html = markdownToHtml(report.markdown);
      html = linkCitations(html, report.sources || []);
      html = html
        .replace(/〔已確立〕/g, '<span class="dr-tag-ok">〔已確立〕</span>')
        .replace(/〔爭議〕/g, '<span class="dr-tag-warn">〔爭議〕</span>')
        .replace(/〔不確定〕/g, '<span class="dr-tag-uncertain">〔不確定〕</span>');
      // inject heading ids for TOC
      let i = 0;
      html = html.replace(/<(h[23])>(.*?)<\/\1>/gi, (_m, tag, inner) => {
        const item = toc[i++];
        const id = (item?.id || `h-${i}`).replace(/"/g, "");
        return `<${tag} id="${id}">${inner}</${tag}>`;
      });
      return html;
    } catch {
      return "";
    }
  }, [report, toc]);

  const weakFindings = useMemo(
    () => (report?.findings || []).filter((f) => !f.adequate),
    [report]
  );

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
    runGenRef.current += 1; // invalidate in-flight finally / SSE
    abortRef.current = null;
    setBusy(false);
    setRunId("");
    runIdRef.current = "";
    pushLog("已中止研究", "warn");
  };

  const copyShareLink = async () => {
    if (!savedId) return;
    const url = `${window.location.origin}/notes/${savedId}`;
    try {
      await navigator.clipboard.writeText(url);
      pushLog("已複製筆記連結", "ok");
    } catch {
      setError("無法複製連結");
    }
  };

  const injectGuidance = async () => {
    const text = guidance.trim();
    const id = runIdRef.current || runId;
    if (!text || !id || guidanceBusy) return;
    setGuidanceBusy(true);
    try {
      const res = await fetch("/api/ai/research/guidance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId: id, text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "注入失敗");
      pushLog(`已送出方向（下一輪搜尋會採用）：${text.slice(0, 80)}`, "warn");
      setGuidance("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "注入失敗");
    } finally {
      setGuidanceBusy(false);
    }
  };

  const persistReport = async (
    r: Report,
    topicText: string,
    opts?: { forceNewNote?: boolean }
  ) => {
    if (!user) return;
    let noteId = opts?.forceNewNote ? null : savedIdRef.current;
    try {
      const body = formatResearchNoteBody({
        title: r.title,
        summary: r.summary,
        markdown: r.markdown,
        model: r.model,
        sourceNoteTitle: sourceNoteTitle || undefined,
        webSources: r.webSources,
        noteSources: r.noteSources,
        sources: r.sources,
      });
      if (noteId) {
        await updateNote(noteId, { title: r.title, body_md: body });
      } else {
        noteId = await createNote(
          user.uid,
          r.title,
          body,
          undefined,
          ["深度研究", "自動存檔"],
          {
            folder: "深度研究",
            parent_id: sourceNoteId || undefined,
          }
        );
        setSavedId(noteId);
        savedIdRef.current = noteId;
        pushLog(`已自動存成筆記（可在知識庫「深度研究」資料夾找到）`, "ok");
      }
    } catch {
      pushLog("自動存筆記失敗，仍保留本機歷史", "warn");
    }

    const activity = logsRef.current.slice(-40).map((l) => ({
      message: l.message,
      level: l.level,
      at: l.at,
    }));

    const saved = saveResearchHistoryItem(user.uid, {
      topic: topicText,
      title: r.title,
      summary: r.summary,
      depth,
      model: r.model,
      domains: domains.trim() || undefined,
      context: context.trim().slice(0, 6000) || undefined,
      webCount: r.webSources?.length || 0,
      noteCount: r.noteSources?.length || 0,
      savedNoteId: noteId || undefined,
      sourceNoteId: sourceNoteId || undefined,
      activity,
      report: {
        title: r.title,
        summary: r.summary,
        markdown: r.markdown,
        plan: r.plan,
        findings: (r.findings || []).map((f) => ({
          question: f.question,
          summary: f.summary.slice(0, 2000),
          adequate: f.adequate,
          retries: f.retries,
          searchQueries: f.searchQueries || [],
          noteHits: (f.noteHits || []).map((n) => ({
            id: n.id,
            title: n.title,
            excerpt: (n.excerpt || "").slice(0, 200),
          })),
          sources: f.sources || [],
        })),
        sources: r.sources || [],
        webSources: r.webSources || [],
        noteSources: r.noteSources || [],
        searchQueries: r.searchQueries || [],
        model: r.model,
      },
    });
    setHistory(saved.list);
    if (!saved.ok) pushLog("本機歷史寫入失敗（空間不足）", "warn");
  };

  const consumeStream = async (
    res: Response,
    opts?: { onDone?: (r: Report) => void; gen?: number }
  ) => {
    const reader = res.body?.getReader();
    if (!reader) throw new Error("無法讀取串流回應");
    const decoder = new TextDecoder();
    let buffer = "";
    let streamModel = "gemini-3.1-pro-preview";
    const mine = () => opts?.gen == null || runGenRef.current === opts.gen;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!mine()) {
        try {
          reader.cancel();
        } catch {
          /* ignore */
        }
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() || "";

      for (const chunk of parts) {
        if (!mine()) break;
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
          if (type === "meta") {
            if (typeof event.model === "string") {
              streamModel = event.model;
              setModelUsed(event.model);
            }
            if (typeof event.runId === "string") {
              setRunId(event.runId);
              runIdRef.current = event.runId;
            }
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
              setAssumedIntent(String(event.intent || ""));
              pushLog("研究計畫已就緒，請審核後繼續", "warn");
            }
            if (plan?.questions?.length) {
              setChecklist(
                plan.questions.map((q) => ({ q, status: "pending" as const }))
              );
            }
          } else if (type === "question") {
            const idx = Number(event.index) || 0;
            pushLog(`子問題 ${event.index}/${event.total}：${event.question}`, "info");
            setChecklist((prev) =>
              prev.map((row, i) =>
                i === idx - 1
                  ? { ...row, status: "active", q: String(event.question || row.q) }
                  : row
              )
            );
          } else if (type === "question_done") {
            const idx = Number(event.index) || 0;
            setChecklist((prev) =>
              prev.map((row, i) =>
                i === idx - 1
                  ? { ...row, status: event.adequate ? "done" : "weak" }
                  : row
              )
            );
          } else if (type === "progress") {
            setProgressPct(Number(event.pct) || 0);
            setEtaSec(
              typeof event.etaSec === "number" ? event.etaSec : undefined
            );
          } else if (type === "guidance_applied") {
            pushLog(`方向已套用：${event.text}`, "warn");
          } else if (type === "finding") {
            const f = event.finding as {
              question?: string;
              summary?: string;
              adequate?: boolean;
              retries?: number;
              sources?: { index: number; kind: string; title: string; uri: string }[];
            };
            const idx = Number(event.index) || 0;
            setLiveFindings((prev) => {
              const row = {
                index: idx,
                question: String(f?.question || ""),
                summary: String(f?.summary || ""),
                adequate: !!f?.adequate,
                retries: Number(f?.retries) || 0,
                sources: Array.isArray(f?.sources) ? f.sources : [],
              };
              const without = prev.filter((x) => x.index !== idx);
              return [...without, row].sort((a, b) => a.index - b.index);
            });
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
            setProgressPct(100);
            setTransformOut("");
            pushLog("深度研究完成", "ok");
            opts?.onDone?.(r);
          } else if (type === "error") {
            throw new Error(String(event.message || "研究失敗"));
          }
      }
    }
  };

  const runResearch = async (opts?: {
    skipClarify?: boolean;
    answers?: string;
    approvedPlan?: Plan;
    resetLogs?: boolean;
  }) => {
    if (!topic.trim() || busy) return;
    const gen = ++runGenRef.current;
    setBusy(true);
    setError("");
    setReport(null);
    setSavedId(null);
    savedIdRef.current = null;
    setClarifyQs([]);
    setDraftPlan(null);
    setProgressPct(0);
    setEtaSec(undefined);
    setChecklist([]);
    setRunId("");
    runIdRef.current = "";
    setLiveFindings([]);
    setExportOpen(false);
    setShowActivity(false);
    setPhase(opts?.approvedPlan ? "hunt" : "clarify");
    if (opts?.resetLogs !== false) {
      setLogs([]);
      setSourceStats({ web: 0, notes: 0 });
      setChat([]);
      pushLog("啟動深度研究代理人…");
      pushLog(
        `Gemini 3.1 Pro · ${depth === "max" ? "Max" : "標準"} · 筆記 ${notes.length} 則`
      );
    } else {
      pushLog("依核准計畫繼續執行…", "ok");
    }

    const expanded = scopeIds.length
      ? expandScopeWithWiki(libraryNotes, scopeIds, extractWikiLinks)
      : scopeIds;
    if (expanded.length > scopeIds.length) {
      setScopeIds(expanded);
      pushLog(`已依 [[wiki]] 擴充研究範圍至 ${expanded.length} 則`, "ok");
    }

    const libraryPayload = buildLibraryPayload(
      libraryNotes,
      topic.trim(),
      expanded.length ? expanded : undefined
    );
    if (libraryPayload.length && opts?.resetLogs !== false) {
      pushLog(`已打包 ${libraryPayload.length} 則相關筆記`, "ok");
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
          preferredDomains,
          timeRange,
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
      await consumeStream(res, {
        gen,
        onDone: (r) => {
          void persistReport(r, topic.trim(), { forceNewNote: true });
        },
      });
    } catch (e) {
      if (!isAbortError(e)) {
        setError(e instanceof Error ? e.message : "研究失敗");
        pushLog(e instanceof Error ? e.message : "研究失敗", "warn");
      }
    } finally {
      if (runGenRef.current === gen) {
        abortRef.current = null;
        setBusy(false);
        setRunId("");
        runIdRef.current = "";
      }
    }
  };

  const refineWeak = async (questions?: string[]) => {
    if (!report || busy) return;
    const qs =
      questions ||
      (report.findings || []).filter((f) => !f.adequate).map((f) => f.question);
    if (!qs.length) {
      setError("沒有偏弱子問題可重跑");
      return;
    }
    const gen = ++runGenRef.current;
    setBusy(true);
    setError("");
    setLiveFindings([]);
    setProgressPct(0);
    pushLog(`開始補強 ${qs.length} 個子問題…`, "retry");
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch("/api/ai/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ac.signal,
        body: JSON.stringify({
          mode: "refine",
          topic: topic.trim(),
          context: context.trim() || undefined,
          model: prefs?.prefs.aiModel || "gemini-3.1-pro-preview",
          depth,
          preferredDomains,
          timeRange,
          approvedPlan: report.plan,
          findings: report.findings,
          refineQuestions: qs,
          libraryNotes: buildLibraryPayload(
            libraryNotes,
            topic.trim(),
            scopeIds.length ? scopeIds : undefined
          ),
          stream: true,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "補強失敗");
      }
      await consumeStream(res, {
        gen,
        onDone: (r) => {
          void persistReport(r, topic.trim());
        },
      });
    } catch (e) {
      if (!isAbortError(e)) {
        setError(e instanceof Error ? e.message : "補強失敗");
        pushLog(e instanceof Error ? e.message : "補強失敗", "warn");
      }
    } finally {
      if (runGenRef.current === gen) {
        abortRef.current = null;
        setBusy(false);
        setRunId("");
        runIdRef.current = "";
      }
    }
  };

  const saveNote = async (asChild = !!sourceNoteId) => {
    if (!user || !report) return;
    const body = formatResearchNoteBody({
      title: report.title,
      summary: report.summary,
      markdown: report.markdown,
      model: report.model,
      sourceNoteTitle: sourceNoteTitle || undefined,
      webSources: report.webSources,
      noteSources: report.noteSources,
      sources: report.sources,
    });
    if (savedId) {
      await updateNote(savedId, { title: report.title, body_md: body });
      if (wantReturn && sourceNoteId) router.push(`/notes/${sourceNoteId}`);
      return;
    }
    const id = await createNote(
      user.uid,
      report.title,
      body,
      undefined,
      ["深度研究"],
      {
        folder: "深度研究",
        parent_id: asChild && sourceNoteId ? sourceNoteId : undefined,
      }
    );
    if (asChild && sourceNoteId) {
      try {
        const parent = await getNote(sourceNoteId);
        if (parent?.body_md != null) {
          const link = `\n\n[[${report.title}]]\n`;
          if (!parent.body_md.includes(`[[${report.title}]]`)) {
            await updateNote(sourceNoteId, {
              body_md: `${parent.body_md.trim()}${link}`,
            });
          }
        }
      } catch {
        /* ignore parent link failure */
      }
    }
    setSavedId(id);
    if (wantReturn && sourceNoteId) {
      router.push(`/notes/${sourceNoteId}`);
    }
  };

  const insertIntoSource = async (mode: "full" | "summary" = "full") => {
    if (!user || !report || !sourceNoteId) return;
    const block = formatResearchInsertBlock({
      title: report.title,
      summary: report.summary,
      markdown: report.markdown,
      mode,
      sources: report.sources,
    });
    try {
      const parent = await getNote(sourceNoteId);
      if (!parent || parent.user_id !== user.uid) throw new Error("找不到來源筆記");
      await updateNote(sourceNoteId, {
        body_md: `${(parent.body_md || "").trim()}${block}`,
      });
      pushLog(`已寫入來源筆記《${sourceNoteTitle || sourceNoteId}》`, "ok");
      if (wantReturn) router.push(`/notes/${sourceNoteId}?researchInserted=1`);
    } catch (e) {
      // Fallback: stash for note page to apply
      stashResearchInsert(sourceNoteId, block);
      setError(e instanceof Error ? e.message : "寫入筆記失敗（已暫存，回筆記時會嘗試插入）");
      if (wantReturn) router.push(`/notes/${sourceNoteId}?researchInserted=1`);
    }
  };

  const askFollowUp = async () => {
    if (!report || !followUp.trim() || followBusy) return;
    const q = followUp.trim();
    setFollowBusy(true);
    setFollowUp("");
    const userMsg: ChatMsg = {
      id: `u_${Date.now()}`,
      role: "user",
      text: q,
    };
    const nextChat = [...chat, userMsg];
    setChat(nextChat);
    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "chat",
          prompt: q,
          context: `—— 深度研究報告 ——\n主題：${topic}\n標題：${report.title}\n\n摘要：\n${report.summary}\n\n正文：\n${report.markdown.slice(0, 10000)}\n—— 結束 ——`,
          messages: nextChat.slice(0, -1).map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            text: m.text,
          })),
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
      setChat((prev) => [
        ...prev,
        {
          id: `a_${Date.now()}`,
          role: "assistant",
          text: data.text || "（沒有回覆）",
        },
      ]);
    } catch (e) {
      setChat((prev) => [
        ...prev,
        {
          id: `e_${Date.now()}`,
          role: "assistant",
          text: e instanceof Error ? e.message : "追問失敗",
        },
      ]);
    } finally {
      setFollowBusy(false);
    }
  };

  /** Grounded follow-up: hunt as new sub-question and rewrite report */
  const followUpIntoReport = async () => {
    if (!report || !followUp.trim() || busy) return;
    const q = followUp.trim();
    setFollowUp("");
    setChat((prev) => [
      ...prev,
      { id: `u_${Date.now()}`, role: "user", text: `【納入報告】${q}` },
    ]);
    const gen = ++runGenRef.current;
    setBusy(true);
    setLiveFindings([]);
    pushLog(`追問並納入報告：${q}`, "retry");
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch("/api/ai/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ac.signal,
        body: JSON.stringify({
          mode: "refine",
          topic: topic.trim(),
          context: context.trim() || undefined,
          model: prefs?.prefs.aiModel || "gemini-3.1-pro-preview",
          depth,
          preferredDomains,
          timeRange,
          approvedPlan: report.plan,
          findings: report.findings,
          addQuestions: [q],
          libraryNotes: buildLibraryPayload(
            libraryNotes,
            topic.trim(),
            scopeIds.length ? scopeIds : undefined
          ),
          stream: true,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "納入報告失敗");
      }
      await consumeStream(res, {
        gen,
        onDone: (r) => {
          void persistReport(r, topic.trim());
          setChat((prev) => [
            ...prev,
            {
              id: `a_${Date.now()}`,
              role: "assistant",
              text: `已調查並重寫報告。新增子問題：「${q}」`,
            },
          ]);
        },
      });
    } catch (e) {
      if (!isAbortError(e)) {
        setError(e instanceof Error ? e.message : "納入報告失敗");
      }
    } finally {
      if (runGenRef.current === gen) {
        abortRef.current = null;
        setBusy(false);
        setRunId("");
        runIdRef.current = "";
      }
    }
  };

  const appendChatToReport = (text: string) => {
    if (!report) return;
    const next = {
      ...report,
      markdown: `${report.markdown}\n\n## 追問補充\n\n${text}\n`,
    };
    setReport(next);
    void persistReport(next, topic.trim() || next.title);
  };

  const runTransform = async (t: (typeof TRANSFORMS)[0]) => {
    if (!report || transformBusy) return;
    setTransformBusy(t.id);
    setTransformOut("");
    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: t.action,
          prompt: t.prompt,
          body: report.markdown.slice(0, 14000),
          title: report.title,
          context:
            t.action === "chat"
              ? `報告標題：${report.title}\n\n摘要：\n${report.summary}\n\n正文：\n${report.markdown.slice(0, 12000)}`
              : undefined,
          assistant: {
            model: prefs?.prefs.aiModel || "gemini-3.1-pro-preview",
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "轉換失敗");
      setTransformOut(data.text || "");
    } catch (e) {
      setTransformOut(e instanceof Error ? e.message : "轉換失敗");
    } finally {
      setTransformBusy("");
    }
  };

  const openHistory = (item: ResearchHistoryItem) => {
    setTopic(item.topic);
    if (item.depth === "max" || item.depth === "standard") setDepth(item.depth);
    if (item.domains != null) setDomains(item.domains);
    if (item.context != null) setContext(item.context);
    setReport({
      ...item.report,
      findings: item.report.findings || [],
    });
    setModelUsed(item.model || item.report.model || "");
    setSavedId(item.savedNoteId || null);
    savedIdRef.current = item.savedNoteId || null;
    setSourceNoteId(item.sourceNoteId || null);
    setSourceStats({
      web: item.webCount || item.report.webSources?.length || 0,
      notes: item.noteCount || item.report.noteSources?.length || 0,
    });
    setClarifyQs([]);
    setDraftPlan(null);
    setLogs(
      (item.activity || []).map((a, i) => ({
        id: `h_${item.id}_${i}`,
        message: a.message,
        level: a.level || "info",
        at: a.at,
      }))
    );
    setChecklist(
      (item.report.plan?.questions || []).map((q) => {
        const f = (item.report.findings || []).find((x) => x.question === q);
        return {
          q,
          status: f ? (f.adequate ? ("done" as const) : ("weak" as const)) : ("pending" as const),
        };
      })
    );
    setChat([]);
    setTransformOut("");
    setLiveFindings([]);
    setFullscreen(false);
    setShowActivity(!!(item.activity && item.activity.length));
    pushLog(`已還原報告：${item.title}`, "ok");
  };

  if (loading) return <p style={{ padding: "2rem", color: "var(--text-muted)" }}>載入中…</p>;

  if (!user) {
    return (
      <div className="dr-page">
        <ScrambleText words="深度研究" as="h1" className="page-title font-display" />
        <p className="page-sub">登入後使用完整深度研究代理人。</p>
        <button type="button" className="btn" onClick={() => loginWithGoogle()}>
          登入
        </button>
      </div>
    );
  }

  const showStart = !busy && clarifyQs.length === 0 && !draftPlan;

  return (
    <div className="dr-page">
      <header className="dr-head">
        <div>
          <ScrambleText words="深度研究" as="h1" className="page-title font-display" />
          <p className="page-sub">
            與筆記本結合：從筆記啟動、指定研究範圍、存成子筆記或寫回原文。
          </p>
        </div>
        <div className="dr-head-actions">
          <Link href={libraryFolderUrl(RESEARCH_FOLDER)} className="btn btn-sm btn-soft">
            知識庫 · 深度研究
          </Link>
          <Link href="/library" className="btn btn-sm btn-ghost">
            知識庫
          </Link>
        </div>
      </header>

      <ContinueChips
        className="dr-continue"
        chips={researchContinueChips({
          savedNoteId: savedId,
          sourceNoteId,
        })}
      />

      <div className="dr-layout">
        <section className="dr-form">
          {sourceNoteId && (
            <div className="dr-source-banner">
              <span>
                來源筆記：{" "}
                <Link href={`/notes/${sourceNoteId}`}>{sourceNoteTitle || "開啟筆記"}</Link>
              </span>
              <label className="dr-return-check">
                <input
                  type="checkbox"
                  checked={wantReturn}
                  onChange={(e) => setWantReturn(e.target.checked)}
                />
                完成後回到筆記
              </label>
            </div>
          )}

          <label className="dr-label">
            研究主題
            <textarea
              className="input"
              rows={3}
              value={topic}
              disabled={busy}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="研究主題…"
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
              value={context}
              disabled={busy}
              onChange={(e) => setContext(e.target.value)}
            />
          </label>

          <label className="dr-label">
            優先來源網域（選填，逗號分隔；會以 site: 加強搜尋）
            <input
              className="input"
              placeholder="例：nih.gov, who.int, nature.com"
              value={domains}
              disabled={busy}
              onChange={(e) => setDomains(e.target.value)}
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
                標準
              </button>
              <button
                type="button"
                className={`btn btn-sm${depth === "max" ? "" : " btn-ghost"}`}
                disabled={busy}
                onClick={() => setDepth("max")}
              >
                Max
              </button>
            </div>
          </div>

          <div className="dr-depth">
            <span className="dr-depth-label">時間範圍（新鮮度）</span>
            <div className="dr-depth-btns">
              {(
                [
                  { id: "any" as const, label: "不限" },
                  { id: "ytd" as const, label: "今年" },
                  { id: "1y" as const, label: "近 1 年" },
                  { id: "2y" as const, label: "近 2 年" },
                ] as const
              ).map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={`btn btn-sm${timeRange === o.id ? "" : " btn-ghost"}`}
                  disabled={busy}
                  onClick={() => setTimeRange(o.id)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {notePreview.length > 0 && (
            <div className="dr-note-preview">
              <h4>{scopeIds.length ? "研究範圍筆記" : "可能用到的筆記"}</h4>
              <ul>
                {notePreview.map((n) => (
                  <li key={n.id}>
                    <Link href={`/notes/${n.id}`}>{n.title}</Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="dr-scope">
            <h4>
              指定筆記範圍{" "}
              <span className="dr-muted-inline">
                {scopeIds.length ? `${scopeIds.length} 篇` : "自動相關"}
              </span>
            </h4>
            <input
              className="input"
              placeholder="搜尋筆記加入範圍…"
              value={scopeQ}
              disabled={busy}
              onChange={(e) => setScopeQ(e.target.value)}
            />
            <ul className="dr-scope-list">
              {scopeCandidates.map((n) => {
                const on = scopeIds.includes(n.id);
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      className={`dr-scope-item${on ? " is-on" : ""}`}
                      disabled={busy}
                      onClick={() => toggleScope(n.id)}
                    >
                      {on ? "✓ " : ""}
                      {n.title}
                    </button>
                  </li>
                );
              })}
            </ul>
            {scopeIds.length > 0 && (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                disabled={busy}
                onClick={() => setScopeIds(sourceNoteId ? [sourceNoteId] : [])}
              >
                清除範圍
              </button>
            )}
          </div>

          {clarifyQs.length > 0 && !busy && !report && (
            <div className="dr-clarify">
              <h3>請先釐清幾點</h3>
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
                  />
                </label>
              ))}
              <div className="dr-actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    const answers = clarifyQs
                      .map((q, i) => `Q: ${q}\nA: ${clarifyAnswers[i]?.trim() || "（未答）"}`)
                      .join("\n\n");
                    void runResearch({ answers });
                  }}
                >
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
              <label className="dr-label">
                標題
                <input
                  className="input"
                  value={draftPlan.title}
                  onChange={(e) => setDraftPlan({ ...draftPlan, title: e.target.value })}
                />
              </label>
              <label className="dr-label">
                角度
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
                    setDraftPlan({ ...draftPlan, questions: e.target.value.split("\n") })
                  }
                />
              </label>
              <label className="dr-label">
                關鍵字
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
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    const maxQ = depth === "max" ? 7 : 5;
                    let questions = draftPlan.questions.map((q) => q.trim()).filter(Boolean);
                    if (questions.length > maxQ) {
                      pushLog(
                        `子問題超過 ${depth === "max" ? "Max" : "標準"} 上限 ${maxQ}，已截取前 ${maxQ} 題`,
                        "warn"
                      );
                      questions = questions.slice(0, maxQ);
                    }
                    const cleaned: Plan = {
                      title: draftPlan.title.trim() || topic.slice(0, 40),
                      angle: draftPlan.angle.trim(),
                      questions,
                      keywords: draftPlan.keywords.map((k) => k.trim()).filter(Boolean),
                    };
                    if (!cleaned.questions.length) {
                      setError("至少保留一個子問題");
                      return;
                    }
                    void runResearch({
                      approvedPlan: cleaned,
                      skipClarify: true,
                      resetLogs: false,
                    });
                  }}
                >
                  核准並搜尋
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setDraftPlan(null);
                    void runResearch({ skipClarify: true, resetLogs: true });
                  }}
                >
                  重新規劃
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setDraftPlan(null);
                    setClarifyQs([]);
                    setLogs([]);
                    setPhase("");
                    pushLog("已放棄研究計畫", "warn");
                  }}
                >
                  放棄
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
              <span className="dr-status">工作中…</span>
            </div>
          )}

          {error && <p className="note-aside-error">{error}</p>}

          {history.length > 0 && (
            <div className="dr-history">
              <h3>最近報告</h3>
              <p className="dr-hint">
                自動存檔也在{" "}
                <Link href={libraryFolderUrl(RESEARCH_FOLDER)}>
                  知識庫「深度研究」
                </Link>
              </p>
              <ul>
                {history.slice(0, 6).map((h) => (
                  <li key={h.id}>
                    <button type="button" className="dr-history-open" onClick={() => openHistory(h)}>
                      <strong>{h.title}</strong>
                      <span>
                        {new Date(h.at).toLocaleString("zh-TW")}
                        {h.savedNoteId ? " · 已存筆記" : ""}
                      </span>
                    </button>
                    {h.savedNoteId && (
                      <Link
                        href={`/notes/${h.savedNoteId}`}
                        className="dr-history-note"
                        title="開啟筆記"
                      >
                        筆記
                      </Link>
                    )}
                    <button
                      type="button"
                      className="dr-history-del"
                      onClick={() => setHistory(deleteResearchHistoryItem(user.uid, h.id))}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="dr-result">
          {!report && !busy && !draftPlan && clarifyQs.length === 0 && logs.length === 0 && (
            <div className="dr-empty">
              <p>輸入主題後開始。可指定優先網域、審核計畫，完成後可匯出與補強偏弱題。</p>
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
                  {progressPct > 0 ? ` · ${progressPct}%` : ""}
                  {etaSec != null && busy ? ` · 約 ${etaSec}s` : ""}
                </span>
              </div>
              {busy && (
                <div className="dr-progress">
                  <div
                    className="dr-progress-fill"
                    style={{ width: `${Math.max(4, progressPct)}%` }}
                  />
                </div>
              )}
              {checklist.length > 0 && (
                <ul className="dr-checklist">
                  {checklist.map((c, i) => (
                    <li key={i} className={`is-${c.status}`}>
                      <span>
                        {c.status === "done"
                          ? "✓"
                          : c.status === "weak"
                            ? "!"
                            : c.status === "active"
                              ? "…"
                              : "○"}
                      </span>
                      {c.q}
                    </li>
                  ))}
                </ul>
              )}
              {busy && (
                <div className="dr-inject">
                  <input
                    className="input"
                    placeholder="執行中注入方向，例如：多比較開源方案…"
                    value={guidance}
                    disabled={guidanceBusy || !runId}
                    onChange={(e) => setGuidance(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void injectGuidance();
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={guidanceBusy || !guidance.trim() || !runId}
                    onClick={() => void injectGuidance()}
                  >
                    注入
                  </button>
                </div>
              )}
              {liveFindings.length > 0 && (
                <div className="dr-live-findings">
                  <h4>即時發現</h4>
                  <ul>
                    {liveFindings.map((f) => (
                      <li key={f.index} className={f.adequate ? "is-ok" : "is-weak"}>
                        <div className="dr-live-head">
                          <strong>
                            {f.index}. {f.question}
                          </strong>
                          <span>{f.adequate ? "足夠" : "偏弱"}</span>
                        </div>
                        <p>{f.summary.slice(0, 280)}{f.summary.length > 280 ? "…" : ""}</p>
                        {f.sources.length > 0 && (
                          <div className="dr-live-srcs">
                            {f.sources.slice(0, 4).map((s, si) => (
                              <a
                                key={`${f.index}-${si}-${s.uri}`}
                                href={s.uri}
                                target={s.kind === "web" ? "_blank" : undefined}
                                rel="noreferrer"
                              >
                                {s.title.slice(0, 28)}
                              </a>
                            ))}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
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
                  {sourceNoteId && (
                    <>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => void insertIntoSource("full")}
                      >
                        寫入來源筆記
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => void insertIntoSource("summary")}
                      >
                        只寫摘要
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => void saveNote(!!sourceNoteId)}
                  >
                    {savedId
                      ? "已存"
                      : sourceNoteId
                        ? "存成子筆記"
                        : "存成筆記"}
                  </button>
                  {!sourceNoteId && (
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => void saveNote(false)}
                    >
                      獨立筆記
                    </button>
                  )}
                  {sourceNoteId && (
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => void saveNote(false)}
                    >
                      存獨立筆記
                    </button>
                  )}
                  {savedId && (
                    <>
                      <Link href={`/notes/${savedId}`} className="btn btn-sm btn-soft">
                        開啟
                      </Link>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => void copyShareLink()}
                      >
                        複製連結
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => setFullscreen(true)}
                  >
                    全螢幕
                  </button>
                  <div className="dr-export-menu" ref={exportMenuRef}>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => setExportOpen((v) => !v)}
                    >
                      匯出 ▾
                    </button>
                    {exportOpen && (
                      <div className="dr-export-pop">
                        <button
                          type="button"
                          onClick={() => {
                            downloadMarkdown(
                              report.title,
                              reportExportBody(report, sourceNoteTitle || undefined)
                            );
                            setExportOpen(false);
                          }}
                        >
                          Markdown
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            downloadPdfViaPrint(
                              report.title,
                              reportExportBody(report, sourceNoteTitle || undefined)
                            );
                            setExportOpen(false);
                          }}
                        >
                          PDF
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void downloadDocx(
                              report.title,
                              reportExportBody(report, sourceNoteTitle || undefined)
                            );
                            setExportOpen(false);
                          }}
                        >
                          DOCX
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            downloadPptOutline(
                              report.title,
                              reportExportBody(report, sourceNoteTitle || undefined)
                            );
                            setExportOpen(false);
                          }}
                        >
                          簡報大綱
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="dr-summary-card">
                <h3>摘要</h3>
                <p>{report.summary}</p>
              </div>

              {toc.length > 0 && (
                <nav className="dr-toc">
                  <h3>目錄</h3>
                  <ul>
                    {toc.map((t) => (
                      <li key={t.id} className={t.level === 3 ? "is-h3" : ""}>
                        <a
                          href={`#${t.id}`}
                          onClick={(e) => {
                            e.preventDefault();
                            scrollToHeading(t.id);
                          }}
                        >
                          {t.text}
                        </a>
                      </li>
                    ))}
                  </ul>
                </nav>
              )}

              {logs.length > 0 && (
                <div className="dr-activity">
                  <button
                    type="button"
                    className="dr-activity-toggle"
                    onClick={() => setShowActivity((v) => !v)}
                  >
                    {showActivity ? "收合研究過程" : "展開研究過程"}
                    <span>{logs.length}</span>
                  </button>
                  {showActivity && (
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
                    </ul>
                  )}
                </div>
              )}

              {(report.findings?.length || 0) > 0 && (
                <div className="dr-findings-panel">
                  <div className="dr-findings-head">
                    <h3>
                      子問題品質（{weakFindings.length} 偏弱 / {report.findings!.length}）
                    </h3>
                    {weakFindings.length > 0 && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={busy}
                        onClick={() => void refineWeak()}
                      >
                        只重跑偏弱題
                      </button>
                    )}
                  </div>
                  <ul>
                    {report.findings!.map((f, i) => (
                      <li key={i} className={f.adequate ? "is-ok" : "is-weak"}>
                        <div>
                          <strong>
                            {i + 1}. {f.question}
                          </strong>
                          <span>
                            {f.adequate ? "足夠" : "偏弱"}
                            {f.retries ? ` · 已修正 ${f.retries}` : ""}
                          </span>
                        </div>
                        {!f.adequate && (
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost"
                            disabled={busy}
                            onClick={() => void refineWeak([f.question])}
                          >
                            重跑
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="dr-source-graph">
                <h3>來源</h3>
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
                    </ul>
                  </div>
                </div>
              </div>

              <article
                className="dr-markdown prose-dr"
                dangerouslySetInnerHTML={{
                  __html: renderedHtml || `<pre>${report.markdown}</pre>`,
                }}
              />

              <div className="dr-transforms">
                <h3>報告轉換</h3>
                <div className="dr-transform-btns">
                  {TRANSFORMS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className="btn btn-sm btn-ghost"
                      disabled={!!transformBusy}
                      onClick={() => void runTransform(t)}
                    >
                      {transformBusy === t.id ? "…" : t.label}
                    </button>
                  ))}
                </div>
                {transformOut && (
                  <div className="dr-transform-out">
                    <pre>{transformOut}</pre>
                    <div className="dr-actions">
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => {
                          const next = {
                            ...report,
                            markdown: `${report.markdown}\n\n## 轉換輸出\n\n${transformOut}\n`,
                          };
                          setReport(next);
                          persistReport(next, topic.trim() || next.title);
                        }}
                      >
                        併入報告
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        onClick={() => void navigator.clipboard.writeText(transformOut)}
                      >
                        複製
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="dr-follow">
                <h3>多輪追問</h3>
                <div className="dr-chat">
                  {chat.map((m) => (
                    <div key={m.id} className={`dr-chat-bubble is-${m.role}`}>
                      <pre>{m.text}</pre>
                      {m.role === "assistant" && (
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          onClick={() => appendChatToReport(m.text)}
                        >
                          套用到報告
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="dr-follow-row">
                  <input
                    className="input"
                    placeholder="針對報告追問…"
                    value={followUp}
                    disabled={followBusy || busy}
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
                  <button
                    type="button"
                    className="btn btn-sm btn-soft"
                    disabled={busy || !followUp.trim()}
                    title="上網搜尋此問題並重寫整份報告"
                    onClick={() => void followUpIntoReport()}
                  >
                    納入報告
                  </button>
                </div>
              </div>

              <p className="dr-queries">
                {modelUsed || report.model ? `模型 ${report.model || modelUsed}` : ""}
              </p>
            </div>
          )}
        </section>
      </div>

      {fullscreen && report && (
        <div className="dr-fs" role="dialog" aria-modal="true" aria-label="全螢幕報告">
          <div className="dr-fs-bar">
            <strong>{report.title}</strong>
            <div className="dr-fs-actions">
              {savedId && (
                <Link href={`/notes/${savedId}`} className="btn btn-sm btn-soft">
                  開啟筆記
                </Link>
              )}
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => setFullscreen(false)}
              >
                關閉 Esc
              </button>
            </div>
          </div>
          <div className="dr-fs-body">
            {toc.length > 0 && (
              <nav className="dr-fs-toc">
                <h3>目錄</h3>
                <ul>
                  {toc.map((t) => (
                    <li key={t.id} className={t.level === 3 ? "is-h3" : ""}>
                      <a
                        href={`#fs-${t.id}`}
                        onClick={(e) => {
                          e.preventDefault();
                          scrollToHeading(`fs-${t.id}`);
                        }}
                      >
                        {t.text}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            )}
            <div className="dr-fs-main">
              <div className="dr-summary-card">
                <h3>摘要</h3>
                <p>{report.summary}</p>
              </div>
              <article
                className="dr-markdown prose-dr"
                dangerouslySetInnerHTML={{
                  __html: (renderedHtml || `<pre>${report.markdown}</pre>`).replace(
                    /id="([^"]+)"/g,
                    'id="fs-$1"'
                  ),
                }}
              />
            </div>
            <aside className="dr-fs-sources">
              <h3>來源</h3>
              <div className="dr-graph-col">
                <h4>網路（{report.webSources?.length || 0}）</h4>
                <ul>
                  {(report.webSources || []).map((s) => (
                    <li key={`fs-w-${s.index}`}>
                      <span className="dr-cite">[{s.index}]</span>{" "}
                      <a href={s.uri} target="_blank" rel="noreferrer">
                        {s.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="dr-graph-col">
                <h4>筆記（{report.noteSources?.length || 0}）</h4>
                <ul>
                  {(report.noteSources || []).map((s) => (
                    <li key={`fs-n-${s.index}`}>
                      <span className="dr-cite">[{s.index}]</span>{" "}
                      <Link href={s.uri}>{s.title}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            </aside>
          </div>
        </div>
      )}
    </div>
  );
}
