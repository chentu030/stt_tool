"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { usePrefsOptional } from "@/components/PrefsProvider";

type RadarItem = { keys: string; action: string };

const NOTE_RADAR: RadarItem[] = [
  { keys: "⌘/Ctrl + K", action: "命令列搜尋" },
  { keys: "⌘/Ctrl + S", action: "手動儲存" },
  { keys: "⌘/Ctrl + Shift + F", action: "專注模式" },
  { keys: "⌘/Ctrl + J", action: "開啟 AI 側欄" },
  { keys: "Alt + Shift + E", action: "選取文字問 AI" },
  { keys: "/", action: "斜線選單插入區塊" },
];

const CANVAS_RADAR: RadarItem[] = [
  { keys: "V", action: "選取工具" },
  { keys: "Space + 拖曳", action: "平移畫布" },
  { keys: "⌘/Ctrl + D", action: "複製選取物件" },
  { keys: "Del", action: "刪除選取" },
  { keys: "⌘/Ctrl + Shift + A", action: "全域 AI" },
  { keys: "⌘/Ctrl + K", action: "命令列" },
];

const DEFAULT_RADAR: RadarItem[] = [
  { keys: "⌘/Ctrl + K", action: "命令列" },
  { keys: "⌘/Ctrl + Shift + A", action: "全域 AI 側欄" },
  { keys: "⌘/Ctrl + \\", action: "收合側欄" },
  { keys: "Esc", action: "關閉選單／取消" },
  { keys: "長按 ?", action: "快捷鍵雷達" },
  { keys: "/", action: "筆記內斜線選單" },
];

const HOLD_MS = 420;

function radarForPath(pathname: string | null): { title: string; items: RadarItem[] } {
  if (pathname?.startsWith("/notes/")) {
    return { title: "筆記快捷鍵", items: NOTE_RADAR };
  }
  if (pathname?.startsWith("/canvas")) {
    return { title: "白板快捷鍵", items: CANVAS_RADAR };
  }
  if (pathname?.startsWith("/graph")) {
    return {
      title: "連結圖快捷鍵",
      items: [
        { keys: "拖曳空白處", action: "平移畫面" },
        { keys: "Space + 拖曳", action: "暫時平移" },
        { keys: "滾輪", action: "縮放" },
        { keys: "⌘/Ctrl + K", action: "命令列" },
        { keys: "Esc", action: "取消選取" },
        { keys: "長按 ?", action: "關閉此雷達" },
      ],
    };
  }
  return { title: "快捷鍵雷達", items: DEFAULT_RADAR };
}

export default function KeyboardRadar() {
  const pathname = usePathname();
  const prefsCtx = usePrefsOptional();
  const [open, setOpen] = useState(false);
  const holdTimer = useRef<number | null>(null);
  const holding = useRef(false);

  const pack = useMemo(() => radarForPath(pathname), [pathname]);

  useEffect(() => {
    if (prefsCtx?.prefs.enableShortcuts === false) return;

    const clearHold = () => {
      if (holdTimer.current != null) {
        window.clearTimeout(holdTimer.current);
        holdTimer.current = null;
      }
      holding.current = false;
    };

    const isHelpKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return false;
      // `?` (Shift+/ on most layouts) or bare `/` with Shift
      return e.key === "?" || (e.shiftKey && (e.key === "/" || e.code === "Slash"));
    };

    const inEditable = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      if (!el) return false;
      if (el.isContentEditable) return true;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    };

    const onDown = (e: KeyboardEvent) => {
      if (e.repeat || e.isComposing) return;
      if (!isHelpKey(e)) return;
      if (inEditable(e.target) && !open) return;
      if (holding.current) return;
      holding.current = true;
      holdTimer.current = window.setTimeout(() => {
        setOpen(true);
      }, HOLD_MS);
    };

    const onUp = (e: KeyboardEvent) => {
      if (!isHelpKey(e) && e.key !== "Shift") return;
      const wasOpen = open;
      clearHold();
      if (wasOpen && (e.key === "?" || e.key === "/" || e.key === "Shift")) {
        setOpen(false);
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (!open) return;
      if (e.key === "Escape") {
        e.preventDefault();
        clearHold();
        setOpen(false);
      }
    };

    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", clearHold);
    return () => {
      clearHold();
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", clearHold);
    };
  }, [prefsCtx?.prefs.enableShortcuts, open]);

  if (!open) return null;

  return (
    <div
      className="kbd-radar-backdrop"
      role="dialog"
      aria-label={pack.title}
      onMouseDown={() => setOpen(false)}
    >
      <div className="kbd-radar-panel" onMouseDown={(e) => e.stopPropagation()}>
        <header className="kbd-radar-head">
          <strong>{pack.title}</strong>
          <span>放開 ? 或按 Esc 關閉</span>
        </header>
        <ul className="kbd-radar-list">
          {pack.items.map((item) => (
            <li key={`${item.keys}-${item.action}`}>
              <kbd>{item.keys}</kbd>
              <span>{item.action}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
