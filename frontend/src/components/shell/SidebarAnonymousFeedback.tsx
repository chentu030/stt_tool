"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { submitAnonymousFeedback } from "@/lib/anonymousFeedback";
import { toast } from "@/lib/toast";

function IncludeEmailToggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="sidebar-anon-email">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label="附帶 Gmail"
        className={`sidebar-anon-email-row${checked ? " is-on" : ""}`}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <span className="sidebar-anon-email-label">附帶 Gmail</span>
        <span className={`st-switch sidebar-anon-switch${checked ? " is-on" : ""}`} aria-hidden>
          <i />
        </span>
      </button>
      <p className="sidebar-anon-email-note">方便之後進行回覆</p>
    </div>
  );
}

export default function SidebarAnonymousFeedback({
  collapsed = false,
}: {
  collapsed?: boolean;
}) {
  const { user } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [includeEmail, setIncludeEmail] = useState(true);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (busy) return;
    if (!user) {
      toast("請先登入再送出意見");
      return;
    }
    setBusy(true);
    try {
      await submitAnonymousFeedback({
        message: text,
        uid: user.uid,
        path: pathname || "",
        includeEmail,
        email: includeEmail ? user.email || null : null,
      });
      setText("");
      setIncludeEmail(true);
      setOpen(false);
      toast(includeEmail ? "已送出意見（已附帶聯絡信箱）" : "已送出匿名意見，謝謝");
    } catch (e) {
      toast(e instanceof Error ? e.message : "送出失敗");
    } finally {
      setBusy(false);
    }
  };

  if (collapsed) {
    return (
      <div className="sidebar-anon">
        <button
          type="button"
          className="sidebar-anon-icon"
          title="匿名意見區"
          aria-label="匿名意見區"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
          </svg>
        </button>
        {open ? (
          <div className="sidebar-anon-pop" role="dialog" aria-label="匿名意見區">
            <p className="sidebar-anon-hint">不會公開顯示你的名字或帳號</p>
            <textarea
              className="sidebar-anon-ta"
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="想改進的地方、問題、想法…"
              maxLength={2000}
              autoFocus
            />
            <IncludeEmailToggle
              checked={includeEmail}
              onChange={setIncludeEmail}
              disabled={!user}
            />
            <div className="sidebar-anon-actions">
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>
                取消
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy || text.trim().length < 2}
                onClick={() => void send()}
              >
                {busy ? "送出中…" : "送出"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`sidebar-anon${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="sidebar-anon-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="sidebar-anon-toggle-label">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
          </svg>
          匿名意見區
        </span>
        <span className="sidebar-anon-caret" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open ? (
        <div className="sidebar-anon-body">
          <p className="sidebar-anon-hint">
            {user
              ? "不會公開顯示你的名字或帳號，直接告訴我們想改進的地方。"
              : "登入後即可送出意見（不會公開顯示帳號）。"}
          </p>
          <textarea
            className="sidebar-anon-ta"
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="功能建議、問題回報、使用心得…"
            maxLength={2000}
            disabled={!user}
          />
          <IncludeEmailToggle
            checked={includeEmail}
            onChange={setIncludeEmail}
            disabled={!user}
          />
          <div className="sidebar-anon-actions">
            <span className="sidebar-anon-count">{text.trim().length}/2000</span>
            <button
              type="button"
              className="btn btn-sm"
              disabled={!user || busy || text.trim().length < 2}
              onClick={() => void send()}
            >
              {busy ? "送出中…" : "匿名送出"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
