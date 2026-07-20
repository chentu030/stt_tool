/** Built-in demo packages (no network) for the community catalog */

import type { ResolvedPackage } from "@/lib/community/types";
import catalog from "@/lib/community/catalog.json";
import type { CatalogEntry } from "@/lib/community/types";

export function getCatalog(): CatalogEntry[] {
  return catalog as CatalogEntry[];
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
      version: "1.0.0",
      description: "示範 iframe 頁面類型，安裝後出現在側欄頁面格線。",
      author: "Albireus",
      icon: "language",
      nav: { label: "瀏覽", order: 80 },
      pageType: {
        type: "iframe",
        entry: "https://zh.wikipedia.org/",
        createLabel: "新瀏覽頁",
      },
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
      pages: [
        { title: "週回顧", file: "weekly.md", icon: "event_repeat", tags: ["日誌"], folder: "日誌" },
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
