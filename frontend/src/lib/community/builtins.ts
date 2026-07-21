/** Built-in demo packages (no network) for the community catalog */

import type { ResolvedPackage, StoreCollection } from "@/lib/community/types";
import catalog from "@/lib/community/catalog.json";
import collections from "@/lib/community/collections.json";
import type { CatalogEntry } from "@/lib/community/types";

export function getCatalog(): CatalogEntry[] {
  return catalog as CatalogEntry[];
}

export function getCollections(): StoreCollection[] {
  return collections as StoreCollection[];
}

const BUILTINS: Record<string, () => ResolvedPackage> = {
  "builtin:web-browser-pack": () => ({
    source: "builtin:web-browser-pack",
    sourceKind: "catalog",
    files: {
      "albireus.json": "",
    },
    readme: `# 快速瀏覽頁

示範擴充功能：安裝後側欄「頁面」會多一個入口，建立的頁面以 iframe 開啟 Wikipedia 首頁（可在套件中改成你的 https 入口）。
`,
    manifest: {
      schema: 1,
      kind: "extension",
      id: "web-browser-pack",
      name: "快速瀏覽頁",
      version: "1.1.0",
      description: "示範 iframe 頁面類型，安裝後出現在側欄頁面格線。",
      author: "Albireus",
      authorUrl: "https://github.com/chentu030/stt_tool",
      homepage: "https://github.com/chentu030/stt_tool",
      repository: "https://github.com/chentu030/stt_tool",
      license: "MIT",
      icon: "language",
      category: "生產力",
      cover: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=800&q=60",
      screenshots: [
        "https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=960&q=60",
      ],
      minAppVersion: "0.1.0",
      permissions: ["iframe", "network", "settings", "storage", "clipboard"],
      changelog: [
        { version: "1.1.0", date: "2026-07-18", notes: "新增擴充設定與截圖。" },
        { version: "1.0.0", date: "2026-07-01", notes: "初版示範擴充。" },
      ],
      nav: { label: "瀏覽", order: 80 },
      pageType: {
        type: "iframe",
        entry: "https://zh.wikipedia.org/",
        createLabel: "新瀏覽頁",
      },
      settings: [
        {
          key: "home_hint",
          label: "首頁提示文字",
          type: "string",
          default: "在擴充頁面中瀏覽",
          description: "會以 query 傳給 iframe（示範用）",
        },
        {
          key: "compact",
          label: "精簡模式",
          type: "boolean",
          default: false,
        },
      ],
    },
  }),
  "builtin:meeting-os": () => ({
    source: "builtin:meeting-os",
    sourceKind: "catalog",
    readme: "會議作業系統模板包",
    files: {
      "agenda.md": `## 本次議程
1. 
2. 

## 時間盒
| 主題 | 分鐘 |
| --- | --- |
|  |  |
`,
      "decisions.md": `## 決議
- 

## 反對意見／風險
- 

## 負責人
- 
`,
      "actions.md": `## 待辦
- [ ] 
- [ ] 

## 追蹤
| 項目 | 負責人 | 期限 | 狀態 |
| --- | --- | --- | --- |
|  |  |  |  |
`,
    },
    manifest: {
      schema: 1,
      kind: "template",
      id: "meeting-os",
      name: "會議作業系統",
      version: "1.0.0",
      description: "議程、決議、待辦三頁套件。",
      author: "Albireus",
      icon: "groups",
      license: "MIT",
      permissions: ["notes_write"],
      changelog: [{ version: "1.0.0", notes: "初版：議程／決議／待辦。" }],
      pages: [
        { title: "會議議程", file: "agenda.md", icon: "event_note", tags: ["會議"], folder: "會議" },
        { title: "會議決議", file: "decisions.md", icon: "gavel", tags: ["會議"], folder: "會議" },
        { title: "會議待辦", file: "actions.md", icon: "checklist", tags: ["會議"], folder: "會議" },
      ],
    },
  }),
  "builtin:research-lab": () => ({
    source: "builtin:research-lab",
    sourceKind: "catalog",
    files: {
      "hypothesis.md": `## 研究問題


## 假設


## 成功指標
- 
`,
      "lab-notes.md": `## 實驗日期


## 步驟
1. 

## 觀察
- 

## 下一步
- [ ] 
`,
      "literature.md": `## 文獻清單
- [ ] 

## 重點摘錄
> 
`,
    },
    manifest: {
      schema: 1,
      kind: "template",
      id: "research-lab",
      name: "研究實驗室",
      version: "1.0.0",
      description: "假設、實驗、文獻三頁。",
      author: "Albireus",
      icon: "science",
      permissions: ["notes_write"],
      pages: [
        { title: "研究假設", file: "hypothesis.md", icon: "lightbulb", tags: ["研究"], folder: "研究" },
        { title: "實驗紀錄", file: "lab-notes.md", icon: "biotech", tags: ["研究"], folder: "研究" },
        { title: "文獻筆記", file: "literature.md", icon: "menu_book", tags: ["研究"], folder: "研究" },
      ],
    },
  }),
  "builtin:weekly-review": () => ({
    source: "builtin:weekly-review",
    sourceKind: "catalog",
    files: {
      "weekly.md": `## 本週成就
- 

## 挑戰與學習
- 

## 下週三件事
1. 
2. 
3. 

## 感恩
- 
`,
    },
    manifest: {
      schema: 1,
      kind: "template",
      id: "weekly-review",
      name: "週回顧",
      version: "1.0.0",
      description: "一週回顧單頁模板。",
      author: "Albireus",
      icon: "event_repeat",
      permissions: ["notes_write"],
      pages: [
        { title: "週回顧", file: "weekly.md", icon: "event_repeat", tags: ["日誌"], folder: "日誌" },
      ],
    },
  }),
  "builtin:project-kickoff": () => ({
    source: "builtin:project-kickoff",
    sourceKind: "catalog",
    readme: `# 專案啟動包

包含專案簡報、里程碑與風險三頁。
`,
    files: {
      "brief.md": `## 專案目標


## 成功定義
- 

## 利害關係人
- 
`,
      "milestones.md": `## 里程碑
| 階段 | 日期 | 產出 |
| --- | --- | --- |
|  |  |  |
`,
      "risks.md": `## 風險清單
| 風險 | 影響 | 緩解 |
| --- | --- | --- |
|  |  |  |
`,
    },
    manifest: {
      schema: 1,
      kind: "template",
      id: "project-kickoff",
      name: "專案啟動包",
      version: "1.0.0",
      description: "專案簡報、里程碑與風險清單。",
      author: "Albireus",
      icon: "rocket_launch",
      category: "工作",
      permissions: ["notes_write"],
      changelog: [{ version: "1.0.0", notes: "初版啟動包。" }],
      pages: [
        { title: "專案簡報", file: "brief.md", icon: "flag", tags: ["專案"], folder: "專案" },
        { title: "里程碑", file: "milestones.md", icon: "timeline", tags: ["專案"], folder: "專案" },
        { title: "風險清單", file: "risks.md", icon: "warning", tags: ["專案"], folder: "專案" },
      ],
    },
  }),
  "builtin:yahoo-stocks": () => ({
    source: "builtin:yahoo-stocks",
    sourceKind: "catalog",
    readme: `# 台股／美股看盤

Yahoo 日 K 看盤：約 720 日蠟燭圖、成交量、均線與 KD／MACD／RSI／OBV。

靜態頁：\`/community-apps/stocks/index.html\`  
代理：\`/api/stocks/chart\` · \`/api/stocks/quote\` · \`/api/stocks/search\`
`,
    files: {
      "albireus.json": "",
    },
    manifest: {
      schema: 1,
      kind: "extension",
      id: "yahoo-stocks",
      name: "台股／美股看盤",
      version: "1.0.0",
      description:
        "Yahoo 日 K 看盤：約 720 日蠟燭圖、成交量、均線與 KD／MACD／RSI／OBV，支援搜尋與即時報價輪詢。",
      author: "Albireus",
      authorUrl: "https://github.com/chentu030/stt_tool",
      homepage: "https://albireus.com/community-apps/stocks/",
      repository: "https://github.com/chentu030/stt_tool",
      license: "MIT",
      icon: "candlestick_chart",
      category: "財經",
      cover: "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=800&q=60",
      screenshots: [
        "https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f?w=960&q=60",
      ],
      minAppVersion: "0.1.0",
      permissions: ["iframe", "network", "settings", "storage"],
      changelog: [
        {
          version: "1.0.0",
          date: "2026-07-21",
          notes: "初版：日 K、均線、指標面板與報價輪詢。",
        },
      ],
      nav: { label: "看盤", order: 55 },
      pageType: {
        type: "iframe",
        entry: "/community-apps/stocks/index.html",
        createLabel: "新看盤頁",
      },
      settings: [
        {
          key: "default_symbol",
          label: "預設代號",
          type: "string",
          default: "2330.TW",
          description: "台股可填 2330 或 2330.TW；美股如 AAPL",
        },
        {
          key: "refresh_seconds",
          label: "報價刷新秒數",
          type: "number",
          default: 20,
          description: "頁面開啟時輪詢間隔（約 15–30 秒建議）",
        },
        {
          key: "theme",
          label: "主題",
          type: "enum",
          options: ["auto", "light", "dark"],
          default: "auto",
        },
      ],
    },
  }),
  "builtin:vocab-srs": () => ({
    source: "builtin:vocab-srs",
    sourceKind: "catalog",
    readme: `# 背單字

間隔重複（SRS）背單字：AI 整理詞典、多模式複習、閱讀與聽力。

靜態頁：\`/community-apps/vocab/index.html\`

請在擴充設定填入 Vertex AI Express 金鑰（\`AQ.\` 開頭）；預設空白，不會內建金鑰。
`,
    files: {
      "albireus.json": "",
    },
    manifest: {
      schema: 1,
      kind: "extension",
      id: "vocab-srs",
      name: "背單字",
      version: "1.0.0",
      description:
        "間隔重複背單字：AI 整理詞典內容、多模式複習、閱讀與聽力精讀，嵌在知識庫頁面中使用。",
      author: "Albireus",
      authorUrl: "https://github.com/chentu030/stt_tool",
      homepage: "https://github.com/chentu030/stt_tool",
      repository: "https://github.com/chentu030/stt_tool",
      license: "MIT",
      icon: "menu_book",
      category: "學習",
      cover: "https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=800&q=60",
      screenshots: [
        "https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=960&q=60",
      ],
      minAppVersion: "0.1.0",
      permissions: ["iframe", "network", "settings", "storage", "clipboard"],
      changelog: [
        {
          version: "1.0.0",
          date: "2026-07-21",
          notes: "初版：自背單字移植為 Albireus 社群擴充。",
        },
      ],
      nav: { label: "背單字", order: 52 },
      pageType: {
        type: "iframe",
        entry: "/community-apps/vocab/index.html",
        createLabel: "新背單字頁",
      },
      settings: [
        {
          key: "gemini_api_keys",
          label: "Gemini / Vertex API 金鑰",
          type: "string",
          default: "",
          description: "每行或逗號分隔多組；請填 AQ. 開頭的 Vertex AI Express 金鑰。預設空白。",
        },
        {
          key: "model",
          label: "模型",
          type: "enum",
          options: [
            "gemini-3-flash-preview",
            "gemini-2.5-flash",
            "gemini-2.5-pro",
            "gemini-2.5-flash-lite",
            "gemini-2.0-flash",
          ],
          default: "gemini-3-flash-preview",
        },
        {
          key: "accent",
          label: "發音口音",
          type: "enum",
          options: ["us", "uk"],
          default: "us",
        },
        {
          key: "daily_goal",
          label: "每日複習目標",
          type: "number",
          default: 20,
          description: "達成後會簽到並累計連續天數",
        },
        {
          key: "listen_backend",
          label: "聽力後端網址",
          type: "string",
          default: "https://whisper-api-1016448029865.asia-east1.run.app/api",
          description: "Whisper／詞典抓取雲端後端（可留預設）",
        },
        {
          key: "theme",
          label: "主題",
          type: "enum",
          options: ["light", "dark", "auto"],
          default: "light",
        },
      ],
    },
  }),
};

export function resolveBuiltinSource(source: string): ResolvedPackage | null {
  const factory = BUILTINS[source];
  if (!factory) return null;
  const pack = factory();
  pack.files["albireus.json"] = JSON.stringify(pack.manifest, null, 2);
  return pack;
}
