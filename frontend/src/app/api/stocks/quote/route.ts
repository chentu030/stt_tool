import { NextRequest, NextResponse } from "next/server";
import { fetchQuote, normalizeSymbol } from "@/lib/stocks/yahoo";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const symbol = normalizeSymbol(req.nextUrl.searchParams.get("symbol") || "");
  if (!symbol) {
    return NextResponse.json({ error: "缺少 symbol" }, { status: 400 });
  }
  try {
    const quote = await fetchQuote(symbol);
    return NextResponse.json(quote, {
      headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=30" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "報價失敗";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
