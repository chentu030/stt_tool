import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Extract readable text from a public PDF URL (heuristic, no heavy deps). */
export async function GET(req: NextRequest) {
  const raw = (req.nextUrl.searchParams.get("url") || "").trim();
  if (!/^https?:\/\//i.test(raw)) {
    return NextResponse.json({ error: "需要 http(s) 網址" }, { status: 400 });
  }
  try {
    const res = await fetch(raw, {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; CadenceBot/1.0)",
        Accept: "application/pdf,*/*",
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `無法下載 PDF（${res.status}）` }, { status: 502 });
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 12_000_000) {
      return NextResponse.json({ error: "PDF 過大" }, { status: 413 });
    }
    const text = extractPdfTextHeuristic(buf).slice(0, 14000);
    if (!text.trim()) {
      return NextResponse.json({
        text: "",
        warning: "無法從 PDF 抽取文字（可能是掃描影像）",
        bytes: buf.length,
      });
    }
    return NextResponse.json({ text, bytes: buf.length });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "抽取失敗" },
      { status: 502 }
    );
  }
}

/** Very light PDF text scrape: pull printable strings between BT/ET and parentheses. */
function extractPdfTextHeuristic(buf: Buffer): string {
  const raw = buf.toString("latin1");
  const chunks: string[] = [];
  // Parenthesized strings (common for simple PDFs)
  const re = /\((?:\\.|[^\\)]){2,}\)(?:\s*Tj|\s*TJ)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) && chunks.length < 4000) {
    let s = m[0].slice(1, m[0].lastIndexOf(")"));
    s = s
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "")
      .replace(/\\t/g, " ")
      .replace(/\\\(/g, "(")
      .replace(/\\\)/g, ")")
      .replace(/\\\\/g, "\\")
      .replace(/\\([0-7]{1,3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8)));
    if (/[\x20-\x7E\u00A0-\u024F]/.test(s) && s.replace(/\s/g, "").length > 1) {
      chunks.push(s);
    }
  }
  // Also grab UTF-16BE hex strings <FEFF...>
  const hexRe = /<([0-9A-Fa-f]{4,})>/g;
  while ((m = hexRe.exec(raw)) && chunks.length < 5000) {
    const hex = m[1];
    if (hex.length % 4 !== 0) continue;
    let out = "";
    for (let i = 0; i < hex.length; i += 4) {
      const code = parseInt(hex.slice(i, i + 4), 16);
      if (code === 0xfeff) continue;
      if (code >= 32 && code < 0xfffe) out += String.fromCharCode(code);
    }
    if (out.trim().length > 1) chunks.push(out);
  }
  return chunks.join(" ").replace(/\s+/g, " ").trim();
}
