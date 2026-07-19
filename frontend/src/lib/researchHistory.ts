/** Local history of Deep Research reports (per user) */

export type ResearchFindingSnap = {
  question: string;
  summary: string;
  adequate: boolean;
  retries: number;
  searchQueries: string[];
  noteHits: { id: string; title: string; excerpt?: string }[];
  sources: Array<{
    index: number;
    kind: "web" | "note";
    title: string;
    uri: string;
    noteId?: string;
  }>;
};

export type ResearchHistoryItem = {
  id: string;
  topic: string;
  title: string;
  summary: string;
  at: number;
  depth?: string;
  model?: string;
  webCount?: number;
  noteCount?: number;
  report: {
    title: string;
    summary: string;
    markdown: string;
    plan: {
      title: string;
      angle: string;
      questions: string[];
      keywords: string[];
    };
    findings?: ResearchFindingSnap[];
    sources: Array<{
      index: number;
      kind: "web" | "note";
      title: string;
      uri: string;
      noteId?: string;
    }>;
    webSources: Array<{
      index: number;
      kind: "web" | "note";
      title: string;
      uri: string;
      noteId?: string;
    }>;
    noteSources: Array<{
      index: number;
      kind: "web" | "note";
      title: string;
      uri: string;
      noteId?: string;
    }>;
    searchQueries: string[];
    model?: string;
  };
};

const MAX = 12;

function key(uid: string) {
  return `cadence_research_history_v2_${uid}`;
}

export function loadResearchHistory(uid: string): ResearchHistoryItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw =
      localStorage.getItem(key(uid)) ||
      localStorage.getItem(`cadence_research_history_v1_${uid}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ResearchHistoryItem[];
    return Array.isArray(parsed) ? parsed.slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function saveResearchHistoryItem(
  uid: string,
  item: Omit<ResearchHistoryItem, "id" | "at"> & { id?: string; at?: number }
): ResearchHistoryItem[] {
  const next: ResearchHistoryItem = {
    ...item,
    id: item.id || `rh_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    at: item.at || Date.now(),
  };
  const prev = loadResearchHistory(uid).filter((x) => x.id !== next.id);
  const list = [next, ...prev].slice(0, MAX);
  try {
    localStorage.setItem(key(uid), JSON.stringify(list));
  } catch {
    /* quota — drop findings excerpts */
    try {
      const slim = {
        ...next,
        report: {
          ...next.report,
          findings: (next.report.findings || []).map((f) => ({
            ...f,
            summary: f.summary.slice(0, 600),
          })),
        },
      };
      localStorage.setItem(key(uid), JSON.stringify([slim, ...prev].slice(0, MAX)));
    } catch {
      /* ignore */
    }
  }
  return list;
}

export function deleteResearchHistoryItem(uid: string, id: string): ResearchHistoryItem[] {
  const list = loadResearchHistory(uid).filter((x) => x.id !== id);
  try {
    localStorage.setItem(key(uid), JSON.stringify(list));
  } catch {
    /* ignore */
  }
  return list;
}

export const RESEARCH_STARTERS = [
  "2026 生成式 AI 企業導入趨勢，對知識工作／筆記產品的啟示",
  "遠端與混合辦公團隊協作工具比較：功能、定價、採用障礙",
  "語音轉文字（STT）市場現況：準確率、語言支援與開源／商業路線",
  "個人知識管理（PKM）方法論演進：從 Zettelkasten 到 AI 原生筆記",
  "會議紀錄自動化最佳實務：摘要、待辦抽取與隱私合規",
];
