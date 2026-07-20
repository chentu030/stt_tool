import { NextRequest, NextResponse } from "next/server";
import { searchSymbols } from "@/lib/stocks/yahoo";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") || "").trim();
  if (!q) {
    return NextResponse.json({ results: [] });
  }
  try {
    const results = await searchSymbols(q);
    return NextResponse.json(
      { results },
      { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60" } }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "搜尋失敗";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
