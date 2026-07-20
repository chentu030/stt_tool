/** Yahoo Finance public chart / quote helpers (server-side proxy only). */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export function normalizeSymbol(raw: string): string {
  const s = raw.trim().toUpperCase();
  if (!s) return "";
  // Pure digits → assume TWSE
  if (/^\d{4,6}$/.test(s)) return `${s}.TW`;
  return s;
}

export async function yahooFetch(url: string, revalidate = 20): Promise<Response> {
  return fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": UA,
    },
    next: { revalidate },
  });
}

export type QuoteResult = {
  symbol: string;
  shortName?: string;
  longName?: string;
  currency?: string;
  exchange?: string;
  price: number | null;
  previousClose: number | null;
  change: number | null;
  changePercent: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
  marketState?: string;
  regularMarketTime?: number | null;
};

export type Bar = {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type ChartResult = {
  symbol: string;
  currency?: string;
  exchange?: string;
  shortName?: string;
  longName?: string;
  metaPrice?: number | null;
  bars: Bar[];
};

export async function fetchQuote(symbol: string): Promise<QuoteResult> {
  const sym = normalizeSymbol(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=1m`;
  const res = await yahooFetch(url, 15);
  if (!res.ok) throw new Error(`Yahoo quote ${res.status}`);
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error("查無報價");
  const meta = result.meta || {};
  const price = num(meta.regularMarketPrice);
  const previousClose = num(meta.chartPreviousClose ?? meta.previousClose);
  const change =
    price != null && previousClose != null ? price - previousClose : null;
  const changePercent =
    change != null && previousClose ? (change / previousClose) * 100 : null;
  return {
    symbol: meta.symbol || sym,
    shortName: meta.shortName,
    longName: meta.longName,
    currency: meta.currency,
    exchange: meta.fullExchangeName || meta.exchangeName,
    price,
    previousClose,
    change,
    changePercent,
    dayHigh: num(meta.regularMarketDayHigh),
    dayLow: num(meta.regularMarketDayLow),
    volume: num(meta.regularMarketVolume),
    marketState: meta.marketState,
    regularMarketTime: num(meta.regularMarketTime),
  };
}

export async function fetchChart(
  symbol: string,
  range = "2y",
  interval = "1d"
): Promise<ChartResult> {
  const sym = normalizeSymbol(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    sym
  )}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}&includePrePost=false`;
  const res = await yahooFetch(url, 60);
  if (!res.ok) throw new Error(`Yahoo chart ${res.status}`);
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error("查無 K 線資料");
  const meta = result.meta || {};
  const ts: number[] = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const bars: Bar[] = [];
  for (let i = 0; i < ts.length; i++) {
    const open = num(q.open?.[i]);
    const high = num(q.high?.[i]);
    const low = num(q.low?.[i]);
    const close = num(q.close?.[i]);
    const volume = num(q.volume?.[i]) ?? 0;
    if (open == null || high == null || low == null || close == null) continue;
    bars.push({ time: ts[i], open, high, low, close, volume });
  }
  // Cap ~720 trading days
  const trimmed = bars.length > 720 ? bars.slice(-720) : bars;
  return {
    symbol: meta.symbol || sym,
    currency: meta.currency,
    exchange: meta.fullExchangeName || meta.exchangeName,
    shortName: meta.shortName,
    longName: meta.longName,
    metaPrice: num(meta.regularMarketPrice),
    bars: trimmed,
  };
}

export type SearchHit = {
  symbol: string;
  shortname?: string;
  longname?: string;
  exchange?: string;
  quoteType?: string;
  typeDisp?: string;
};

export async function searchSymbols(q: string): Promise<SearchHit[]> {
  const query = q.trim();
  if (!query) return [];
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(
    query
  )}&quotesCount=12&newsCount=0&listsCount=0`;
  const res = await yahooFetch(url, 30);
  if (!res.ok) throw new Error(`Yahoo search ${res.status}`);
  const data = await res.json();
  const quotes = Array.isArray(data?.quotes) ? data.quotes : [];
  return quotes
    .filter((x: { symbol?: string }) => typeof x.symbol === "string")
    .map((x: Record<string, unknown>) => ({
      symbol: String(x.symbol),
      shortname: typeof x.shortname === "string" ? x.shortname : undefined,
      longname: typeof x.longname === "string" ? x.longname : undefined,
      exchange: typeof x.exchange === "string" ? x.exchange : undefined,
      quoteType: typeof x.quoteType === "string" ? x.quoteType : undefined,
      typeDisp: typeof x.typeDisp === "string" ? x.typeDisp : undefined,
    }));
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
