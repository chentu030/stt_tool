import { NextRequest, NextResponse } from "next/server";

const ALLOWED_HOSTS = new Set([
  "raw.githubusercontent.com",
  "github.com",
  "codeload.github.com",
  "objects.githubusercontent.com",
  "cdn.jsdelivr.net",
  "gist.githubusercontent.com",
]);

function hostAllowed(hostname: string): boolean {
  if (ALLOWED_HOSTS.has(hostname)) return true;
  if (hostname.endsWith(".github.io")) return true;
  return false;
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url") || "";
  const binary = req.nextUrl.searchParams.get("binary") === "1";
  if (!url) {
    return NextResponse.json({ error: "missing url" }, { status: 400 });
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }
  if (parsed.protocol !== "https:") {
    return NextResponse.json({ error: "only https" }, { status: 400 });
  }
  if (!hostAllowed(parsed.hostname)) {
    return NextResponse.json({ error: "host not allowed" }, { status: 403 });
  }

  try {
    const upstream = await fetch(parsed.toString(), {
      headers: {
        Accept: binary ? "application/octet-stream" : "application/vnd.github.raw, text/plain, */*",
        "User-Agent": "AlbireusCommunityStore/1.0",
      },
      next: { revalidate: 60 },
    });
    if (!upstream.ok) {
      return NextResponse.json(
        { error: `upstream ${upstream.status}` },
        { status: upstream.status }
      );
    }
    if (binary) {
      const buf = await upstream.arrayBuffer();
      return new NextResponse(buf, {
        status: 200,
        headers: {
          "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
          "Cache-Control": "public, max-age=60",
        },
      });
    }
    const text = await upstream.text();
    return new NextResponse(text, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=60",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "fetch failed" },
      { status: 502 }
    );
  }
}
