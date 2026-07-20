"use client";

import { useRouter } from "next/navigation";

type Props = {
  className?: string;
  /** Smaller ghost buttons for mobile top bar */
  variant?: "icon" | "ghost";
};

/** Browser-like back / forward / reload for in-app navigation. */
export default function NavHistoryControls({ className, variant = "icon" }: Props) {
  const router = useRouter();
  const btnClass = variant === "ghost" ? "btn btn-sm btn-ghost nav-history-btn" : "sidebar-icon-btn nav-history-btn";

  return (
    <div className={`nav-history${className ? ` ${className}` : ""}`} role="group" aria-label="瀏覽紀錄">
      <button
        type="button"
        className={btnClass}
        title="上一頁"
        aria-label="上一頁"
        onClick={() => router.back()}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>
      <button
        type="button"
        className={btnClass}
        title="下一頁"
        aria-label="下一頁"
        onClick={() => window.history.forward()}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M9 18l6-6-6-6" />
        </svg>
      </button>
      <button
        type="button"
        className={btnClass}
        title="重整"
        aria-label="重整頁面"
        onClick={() => window.location.reload()}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <path d="M21 3v6h-6" />
        </svg>
      </button>
    </div>
  );
}
