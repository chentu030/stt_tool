/** Shared templates + helpers for workspace hub pages (board / canvas / graph). */

import type { BoardStatus } from "@/lib/boardMeta";
import type { GraphFilters, LayoutMode } from "@/lib/graphModel";
import { DEFAULT_FILTERS } from "@/lib/graphModel";

export type HubKind = "board" | "canvas" | "graph";

export type HubTemplate = {
  id: string;
  name: string;
  description: string;
  icon: string;
  defaultName: string;
  chips: string[];
  /** Decorative preview variant */
  preview: "board" | "canvas" | "graph";
};

export const BOARD_TEMPLATES: HubTemplate[] = [
  {
    id: "tasks",
    name: "任務看板",
    description: "待辦 → 進行中 → 完成，適合日常工作流。",
    icon: "view_kanban",
    defaultName: "任務看板",
    chips: ["待辦", "進行中", "完成"],
    preview: "board",
  },
  {
    id: "content",
    name: "內容管道",
    description: "靈感、草稿、發布三欄，追蹤寫作與產出。",
    icon: "dashboard",
    defaultName: "內容管道",
    chips: ["靈感", "草稿", "發布"],
    preview: "board",
  },
  {
    id: "blank",
    name: "空白看板",
    description: "不預設篩選，之後再依資料夾或標籤收窄。",
    icon: "grid_view",
    defaultName: "未命名看板",
    chips: ["全部狀態"],
    preview: "board",
  },
];

export const CANVAS_TEMPLATES: HubTemplate[] = [
  {
    id: "brainstorm",
    name: "腦力激盪",
    description: "自由擺放卡片與連線，抓靈感與關聯。",
    icon: "bubble_chart",
    defaultName: "腦力激盪",
    chips: ["便利貼", "連線"],
    preview: "canvas",
  },
  {
    id: "map",
    name: "專案地圖",
    description: "用空間佈局拆解專案區塊與里程碑。",
    icon: "map",
    defaultName: "專案地圖",
    chips: ["分區", "標註"],
    preview: "canvas",
  },
  {
    id: "blank",
    name: "空白白板",
    description: "從乾淨畫布開始，之後插入筆記或手繪。",
    icon: "palette",
    defaultName: "未命名白板",
    chips: ["無限畫布"],
    preview: "canvas",
  },
];

export const GRAPH_TEMPLATES: HubTemplate[] = [
  {
    id: "overview",
    name: "知識總覽",
    description: "Wiki、標籤、資料夾邊一併顯示，看全局連結。",
    icon: "hub",
    defaultName: "知識總覽",
    chips: ["Wiki", "標籤", "資料夾"],
    preview: "graph",
  },
  {
    id: "wiki",
    name: "僅 Wiki 連線",
    description: "專注 [[雙向連結]]，隱藏標籤與資料夾邊。",
    icon: "share",
    defaultName: "Wiki 圖譜",
    chips: ["Wiki"],
    preview: "graph",
  },
  {
    id: "blank",
    name: "空白圖譜",
    description: "預設篩選，之後在工具列自行調整。",
    icon: "account_tree",
    defaultName: "未命名圖譜",
    chips: ["力導向"],
    preview: "graph",
  },
];

export function boardStatusesForTemplate(id: string): BoardStatus[] {
  if (id === "blank") return [];
  return ["backlog", "doing", "done"];
}

export function graphPresetForTemplate(id: string): {
  filters: GraphFilters;
  layout: LayoutMode;
} {
  if (id === "overview") {
    return {
      filters: {
        ...DEFAULT_FILTERS,
        showTagEdges: true,
        showFolderEdges: true,
      },
      layout: "force",
    };
  }
  if (id === "wiki") {
    return {
      filters: {
        ...DEFAULT_FILTERS,
        showTagEdges: false,
        showFolderEdges: false,
      },
      layout: "force",
    };
  }
  return { filters: { ...DEFAULT_FILTERS }, layout: "force" };
}

export function formatHubRelTime(d: Date): string {
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "剛剛";
  if (m < 60) return `${m} 分鐘前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小時前`;
  const day = Math.floor(h / 24);
  if (day < 14) return `${day} 天前`;
  return d.toLocaleDateString("zh-TW", { month: "short", day: "numeric" });
}
