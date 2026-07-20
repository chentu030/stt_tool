import { NextRequest, NextResponse } from "next/server";
import { fetchChart, normalizeSymbol } from "@/lib/stocks/yahoo";

export const runtime = "nodejs";

const ALLOWED_RANGES = new Set(["1mo", "3mo", "6mo", "1y", "2y", "5y", "max"]);
const ALLOWED_INTERVALS = new Set(["1d", "1wk", "1mo"]);

export async function GET(req: NextRequest) {
  const symbol = normalizeSymbol(req.nextUrl.searchParams.get("symbol") || "");
  if (!symbol) {
    return NextResponse.json({ error: "缺少 symbol" }, { status: 400 });
  }
  const rangeRaw = (req.nextUrl.searchParams.get("range") || "2y").toLowerCase();
  const intervalRaw = (req.nextUrl.searchParams.get("interval") || "1d").toLowerCase();
  const range = ALLOWED_RANGES.has(rangeRaw) ? rangeRaw : "2y";
  const interval = ALLOWED_INTERVALS.has(intervalRaw) ? intervalRaw : "1d";

  try {
    const chart = await fetchChart(symbol, range, interval);
    return NextResponse.json(chart, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "K 線失敗";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
