import { aiFetch } from "@/lib/aiFetch";
/** Shared AI image generation → File for upload. */

export type AiImageAspect =
  | "1:1"
  | "3:2"
  | "2:3"
  | "3:4"
  | "4:3"
  | "4:5"
  | "5:4"
  | "9:16"
  | "16:9"
  | "21:9";

export async function generateAiImageFile(opts: {
  prompt: string;
  aspectRatio?: AiImageAspect | string;
}): Promise<{ file: File; caption?: string; model?: string }> {
  const prompt = opts.prompt.trim();
  if (!prompt) throw new Error("請輸入要生成的圖片描述");

  const res = await aiFetch("/api/ai/image", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      aspectRatio: opts.aspectRatio || "1:1",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "生圖失敗");

  const mime = String(data.mimeType || "image/png");
  const b64 = String(data.data || "");
  if (!b64) throw new Error("生圖無資料");

  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = mime.includes("jpeg") || mime.includes("jpg") ? "jpg" : "png";
  const file = new File([bytes], `ai-image-${Date.now()}.${ext}`, { type: mime });
  return {
    file,
    caption: data.caption ? String(data.caption) : undefined,
    model: data.model ? String(data.model) : undefined,
  };
}
