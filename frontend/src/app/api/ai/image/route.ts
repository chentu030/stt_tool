import { NextRequest, NextResponse } from "next/server";
import { vertexConfigStatus, vertexGenerateImage } from "@/lib/vertex";

export const runtime = "nodejs";
export const maxDuration = 120;

const ASPECTS = new Set([
  "1:1",
  "3:2",
  "2:3",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
  "21:9",
]);

export async function GET() {
  const s = vertexConfigStatus();
  return NextResponse.json({
    ...s,
    imageReady: s.configured,
  });
}

export async function POST(req: NextRequest) {
  try {
    const data = (await req.json()) as {
      prompt?: string;
      aspectRatio?: string;
    };
    const prompt = (data.prompt || "").trim();
    if (!prompt) {
      return NextResponse.json({ error: "請輸入要生成的圖片描述" }, { status: 400 });
    }
    if (prompt.length > 4000) {
      return NextResponse.json({ error: "描述過長（最多 4000 字）" }, { status: 400 });
    }
    const aspectRatio =
      data.aspectRatio && ASPECTS.has(data.aspectRatio) ? data.aspectRatio : "1:1";

    const result = await vertexGenerateImage(prompt, { aspectRatio });
    return NextResponse.json({
      mimeType: result.mimeType,
      data: result.data,
      caption: result.caption || null,
      model: result.model,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
