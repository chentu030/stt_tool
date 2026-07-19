/** Built-in Cadence note templates */

export type NoteTemplate = {
  id: string;
  label: string;
  hint: string;
  title: string;
  body: string;
  tags: string[];
};

export const NOTE_TEMPLATES: NoteTemplate[] = [
  {
    id: "blank",
    label: "空白筆記",
    hint: "從零開始",
    title: "新筆記",
    body: "",
    tags: [],
  },
  {
    id: "meeting",
    label: "會議紀錄",
    hint: "議程、決議、待辦",
    title: "會議 — ",
    body: `## 出席
- 

## 議程
1. 

## 討論重點
- 

## 決議
- 

## 待辦
- [ ] 

## 相關
- [[]]
`,
    tags: ["會議"],
  },
  {
    id: "lecture",
    label: "課堂筆記",
    hint: "重點、名詞、作業",
    title: "課堂 — ",
    body: `## 主題


## 重點
- 

## 名詞解釋
- 

## 作業 / 複習
- [ ] 

## 連結
- [[]]
`,
    tags: ["課堂"],
  },
  {
    id: "interview",
    label: "訪談筆記",
    hint: "逐字稿整理",
    title: "訪談 — ",
    body: `## 受訪者


## 背景


## 金句
> 

## 重點摘要
- 

## 後續
- [ ] 
`,
    tags: ["訪談"],
  },
  {
    id: "daily",
    label: "每日日誌",
    hint: "Journal",
    title: "", // filled with date
    body: `## 今日重點
- 

## 靈感
- 

## 感恩
- 

## 明日
- [ ] 
`,
    tags: ["journal"],
  },
  {
    id: "ppt",
    label: "簡報大綱",
    hint: "用 ## 當投影片",
    title: "簡報 — ",
    body: `# 簡報標題

## 開場


## 問題


## 解法


## 證據


## 下一步

`,
    tags: ["簡報"],
  },
];

export function journalTitle(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function journalDateKey(d = new Date()) {
  return journalTitle(d);
}
