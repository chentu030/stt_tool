/** Compact line-based diff for note version history (no extra dependency). */

export type LineOp =
  | { op: "keep"; n: number }
  | { op: "add"; lines: string[] }
  | { op: "del"; n: number };

function splitLines(text: string): string[] {
  if (!text) return [];
  return text.split("\n");
}

function pushKeep(ops: LineOp[], n = 1) {
  const last = ops[ops.length - 1];
  if (last?.op === "keep") last.n += n;
  else ops.push({ op: "keep", n });
}

function pushDel(ops: LineOp[], n = 1) {
  const last = ops[ops.length - 1];
  if (last?.op === "del") last.n += n;
  else ops.push({ op: "del", n });
}

function pushAdd(ops: LineOp[], line: string) {
  const last = ops[ops.length - 1];
  if (last?.op === "add") last.lines.push(line);
  else ops.push({ op: "add", lines: [line] });
}

/** Build compact line ops transforming `before` → `after`. */
export function diffLines(before: string, after: string): LineOp[] {
  const a = splitLines(before);
  const b = splitLines(after);
  if (!a.length && !b.length) return [];
  if (!a.length) return [{ op: "add", lines: b }];
  if (!b.length) return [{ op: "del", n: a.length }];

  const n = a.length;
  const m = b.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? ((dp[i - 1][j - 1] + 1) as number)
          : ((Math.max(dp[i - 1][j], dp[i][j - 1]) as number));
    }
  }

  const rev: LineOp[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      pushKeep(rev, 1);
      i -= 1;
      j -= 1;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      // Insert from b — collect in reverse then flip later via reverse of ops+lines
      pushAdd(rev, b[j - 1]);
      j -= 1;
    } else {
      pushDel(rev, 1);
      i -= 1;
    }
  }

  const ops = rev.reverse();
  // Reverse line order inside add ops that were pushed reverse during backtrack
  for (const op of ops) {
    if (op.op === "add") op.lines.reverse();
  }
  return ops;
}

export function applyLineOps(before: string, ops: LineOp[]): string {
  const a = splitLines(before);
  const out: string[] = [];
  let i = 0;
  for (const op of ops) {
    if (op.op === "keep") {
      for (let k = 0; k < op.n; k++) {
        out.push(a[i] ?? "");
        i += 1;
      }
    } else if (op.op === "del") {
      i += op.n;
    } else {
      out.push(...op.lines);
    }
  }
  return out.join("\n");
}

export function summarizeLineOps(ops: LineOp[]): string {
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.op === "add") added += op.lines.length;
    else if (op.op === "del") removed += op.n;
  }
  if (!added && !removed) return "無文字變更";
  if (added && removed) return `改寫約 ${added + removed} 行（+${added}/−${removed}）`;
  if (added) return `新增約 ${added} 行`;
  return `刪除約 ${removed} 行`;
}

export type DiffViewRow = {
  kind: "ctx" | "add" | "del";
  text: string;
};

/** Expand line ops into a short review preview (context + changes). */
export function expandDiffPreview(
  before: string,
  after: string,
  contextLines = 1,
  maxRows = 48
): DiffViewRow[] {
  const a = splitLines(before);
  const ops = diffLines(before, after);
  const rows: DiffViewRow[] = [];
  let i = 0;
  for (const op of ops) {
    if (op.op === "keep") {
      if (op.n <= contextLines * 2) {
        for (let k = 0; k < op.n; k++) rows.push({ kind: "ctx", text: a[i + k] ?? "" });
      } else {
        for (let k = 0; k < contextLines; k++) rows.push({ kind: "ctx", text: a[i + k] ?? "" });
        rows.push({ kind: "ctx", text: "…" });
        for (let k = op.n - contextLines; k < op.n; k++) {
          rows.push({ kind: "ctx", text: a[i + k] ?? "" });
        }
      }
      i += op.n;
    } else if (op.op === "del") {
      for (let k = 0; k < op.n; k++) rows.push({ kind: "del", text: a[i + k] ?? "" });
      i += op.n;
    } else {
      for (const line of op.lines) rows.push({ kind: "add", text: line });
    }
    if (rows.length >= maxRows) {
      rows.push({ kind: "ctx", text: "…" });
      break;
    }
  }
  return rows.slice(0, maxRows);
}

export function approxOpBytes(ops: LineOp[]): number {
  try {
    return JSON.stringify(ops).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** Rough edit distance in characters for throttle decisions. */
export function editCharDelta(before: string, after: string): number {
  return Math.abs((before || "").length - (after || "").length);
}
