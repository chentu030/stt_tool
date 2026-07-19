/** @-mention helpers: pages, dates, people */

export type AtItem = {
  id: string;
  kind: "page" | "date" | "person";
  label: string;
  hint: string;
  /** Text inserted into the editor */
  insert: string;
};

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Next weekday: 0=Sun … 6=Sat */
function nextWeekday(from: Date, weekday: number) {
  const d = startOfDay(from);
  const diff = (weekday + 7 - d.getDay()) % 7 || 7;
  return addDays(d, diff);
}

export function formatMentionDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const week = ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
  return `${y}-${m}-${day}（週${week}）`;
}

export function buildDateMentions(now = new Date()): AtItem[] {
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const yesterday = addDays(today, -1);
  const nextMon = nextWeekday(today, 1);
  const nextFri = nextWeekday(today, 5);
  return [
    {
      id: "date-today",
      kind: "date",
      label: "今天",
      hint: "@today",
      insert: formatMentionDate(today),
    },
    {
      id: "date-tomorrow",
      kind: "date",
      label: "明天",
      hint: "@tomorrow",
      insert: formatMentionDate(tomorrow),
    },
    {
      id: "date-yesterday",
      kind: "date",
      label: "昨天",
      hint: "@yesterday",
      insert: formatMentionDate(yesterday),
    },
    {
      id: "date-next-mon",
      kind: "date",
      label: "下週一",
      hint: "@next Monday",
      insert: formatMentionDate(nextMon),
    },
    {
      id: "date-next-fri",
      kind: "date",
      label: "下週五",
      hint: "@next Friday",
      insert: formatMentionDate(nextFri),
    },
  ];
}

export function suggestAtMentions(opts: {
  query: string;
  notes: { id: string; title: string }[];
  personName?: string;
  personEmail?: string;
  limit?: number;
}): AtItem[] {
  const q = opts.query.trim().toLowerCase();
  const limit = opts.limit ?? 10;
  const out: AtItem[] = [];

  const personLabel = opts.personName || opts.personEmail?.split("@")[0] || "";
  if (personLabel) {
    const person: AtItem = {
      id: "person-self",
      kind: "person",
      label: personLabel,
      hint: "@人名",
      insert: `@${personLabel}`,
    };
    if (
      !q ||
      personLabel.toLowerCase().includes(q) ||
      "me".startsWith(q) ||
      "我".includes(q) ||
      "person".startsWith(q) ||
      "人".includes(q)
    ) {
      out.push(person);
    }
  }

  for (const d of buildDateMentions()) {
    const hay = `${d.label} ${d.hint} ${d.id}`.toLowerCase();
    if (!q || hay.includes(q) || d.hint.toLowerCase().includes(`@${q}`)) {
      out.push(d);
    }
  }

  for (const n of opts.notes) {
    const title = (n.title || "").trim();
    if (!title) continue;
    if (q && !title.toLowerCase().includes(q)) continue;
    out.push({
      id: `page-${n.id}`,
      kind: "page",
      label: title,
      hint: "@頁面",
      insert: `[[${title}]]`,
    });
    if (out.length >= limit + 8) break;
  }

  return out.slice(0, limit);
}

/** Match trailing @query (not email mid-address) */
export function matchAtQuery(textBeforeCursor: string): string | null {
  const m = textBeforeCursor.match(/(?:^|[\s([{（【「『])@([^\s@]*)$/);
  if (!m) return null;
  return m[1];
}
