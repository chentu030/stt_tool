/** Host-side eyedropper / color sample helpers (一般擴充功能 prototype). */

export type Rgb = { r: number; g: number; b: number };

export type SampledColor = {
  hex: string;
  rgb: Rgb;
  rgbCss: string;
};

type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> };

export function isEyeDropperSupported(): boolean {
  return typeof window !== "undefined" && "EyeDropper" in window;
}

export function normalizeHexColor(c: string): string | null {
  const s = c.trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(s)) {
    const r = s[1];
    const g = s[2];
    const b = s[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  if (/^[0-9a-f]{6}$/i.test(s)) return `#${s.toLowerCase()}`;
  return null;
}

export function hexToRgb(hex: string): Rgb {
  const n = normalizeHexColor(hex) || "#64748b";
  return {
    r: parseInt(n.slice(1, 3), 16),
    g: parseInt(n.slice(3, 5), 16),
    b: parseInt(n.slice(5, 7), 16),
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) =>
    Math.min(255, Math.max(0, n | 0)).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function formatRgbCss(rgb: Rgb): string {
  return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
}

export function toSampledColor(hexOrRgb: string | Rgb): SampledColor | null {
  if (typeof hexOrRgb === "string") {
    const hex = normalizeHexColor(hexOrRgb);
    if (!hex) return null;
    const rgb = hexToRgb(hex);
    return { hex, rgb, rgbCss: formatRgbCss(rgb) };
  }
  const hex = rgbToHex(hexOrRgb.r, hexOrRgb.g, hexOrRgb.b);
  return { hex, rgb: hexOrRgb, rgbCss: formatRgbCss(hexOrRgb) };
}

export type PickColorResult =
  | { ok: true; color: SampledColor }
  | { ok: false; reason: "unsupported" | "aborted" | "failed"; message: string };

/**
 * Sample a screen pixel via the EyeDropper API (Chrome / Edge / Opera).
 * Returns a clear zh-TW message when the API is missing or the user cancels.
 */
export async function pickScreenColor(): Promise<PickColorResult> {
  if (!isEyeDropperSupported()) {
    return {
      ok: false,
      reason: "unsupported",
      message:
        "此瀏覽器不支援吸取顏色（需 Chrome／Edge 等支援 EyeDropper 的瀏覽器）",
    };
  }
  try {
    const EyeDropper = (window as unknown as { EyeDropper: EyeDropperCtor }).EyeDropper;
    const dropper = new EyeDropper();
    const result = await dropper.open();
    const color = toSampledColor(result.sRGBHex);
    if (!color) {
      return { ok: false, reason: "failed", message: "無法解析吸取到的顏色" };
    }
    return { ok: true, color };
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    if (name === "AbortError") {
      return { ok: false, reason: "aborted", message: "已取消吸取" };
    }
    return {
      ok: false,
      reason: "failed",
      message: "吸取顏色失敗，請再試一次",
    };
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}
