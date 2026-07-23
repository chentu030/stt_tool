import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UnfurlResult = {
  url: string;
  title: string;
  description: string;
  image: string;
  favicon: string;
  siteName: string;
};

function absUrl(base: string, maybe: string | undefined): string {
  if (!maybe?.trim()) return "";
  try {
    return new URL(maybe.trim(), base).toString();
  } catch {
    return "";
  }
}

function metaContent(html: string, keys: string[]): string {
  for (const key of keys) {
    const reProp = new RegExp(
      `<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["']`,
      "i"
    );
    const reProp2 = new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["']`,
      "i"
    );
    const m = html.match(reProp) || html.match(reProp2);
    if (m?.[1]) return m[1].trim();
  }
  return "";
}

function parseUnfurl(url: string, html: string): UnfurlResult {
  const title =
    metaContent(html, ["og:title", "twitter:title"]) ||
    html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ||
    "";
  const description =
    metaContent(html, ["og:description", "twitter:description", "description"]) || "";
  const image = absUrl(url, metaContent(html, ["og:image", "twitter:image"]));
  const siteName = metaContent(html, ["og:site_name"]) || "";
  let favicon = absUrl(url, html.match(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)["']/i)?.[1]);
  if (!favicon) {
    try {
      favicon = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(new URL(url).hostname)}&sz=64`;
    } catch {
      favicon = "";
    }
  }
  return {
    url,
    title: title.replace(/\s+/g, " ").slice(0, 200),
    description: description.replace(/\s+/g, " ").slice(0, 400),
    image,
    favicon,
    siteName: siteName.slice(0, 80),
  };
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export async function GET(req: NextRequest) {
  const raw = (req.nextUrl.searchParams.get("url") || "").trim();
  if (!/^https?:\/\//i.test(raw)) {
    return NextResponse.json({ error: "需要 http(s) 網址" }, { status: 400 });
  }
  try {
    const res = await fetch(raw, {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; CadenceBot/1.0; +https://albireus.app)",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(12000),
    });
    const ct = res.headers.get("content-type") || "";
    if (!res.ok) {
      return NextResponse.json({ error: `無法讀取（${res.status}）` }, { status: 502 });
    }
    if (!/text\/html|application\/xhtml/i.test(ct) && !ct.includes("text/plain")) {
      // Still try og for some servers
    }
    const html = (await res.text()).slice(0, 500_000);
    const data = parseUnfurl(raw, html);
    const extractedText = stripTags(html).slice(0, 12000);
    return NextResponse.json({ ...data, extractedText });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "擷取失敗" },
      { status: 502 }
    );
  }
}
