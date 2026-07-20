"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { logout } from "@/lib/firebase";
import AlbireusLogo from "@/components/AlbireusLogo";
import PageLoading from "@/components/motion/PageLoading";
import ThemeToggle from "@/components/ThemeToggle";
import { toast } from "@/lib/toast";
import {
  FREQUENCY_OPTIONS,
  REFERRAL_OPTIONS,
  USE_CASE_OPTIONS,
  WORKFLOW_OPTIONS,
  ensureAllowlistAccess,
  isAccessBypassPath,
  isAllowlistedEmail,
  listenAccessRequest,
  fetchAccessRequest,
  resolveAccess,
  submitAccessApplication,
  type AccessApplicationInput,
  type AccessRequest,
} from "@/lib/accessGate";
import { validateDisplayName, validateUsername } from "@/lib/userProfile";

export default function AccessGate({ children }: { children: ReactNode }) {
  const { user, loading, displayName, username, saveProfile } = useAuth();
  const pathname = usePathname();
  const [request, setRequest] = useState<AccessRequest | null>(null);
  const [reqLoading, setReqLoading] = useState(false);

  const bypass = isAccessBypassPath(pathname);
  const allowlisted = isAllowlistedEmail(user?.email);

  useEffect(() => {
    if (!user || bypass) {
      setRequest(null);
      setReqLoading(false);
      return;
    }

    // Allowlist: never block the UI on Firestore; seed approved doc in background.
    if (isAllowlistedEmail(user.email)) {
      setReqLoading(false);
      void ensureAllowlistAccess(user).catch((e) => console.warn("[ensureAllowlistAccess]", e));
      return;
    }

    let cancelled = false;
    setReqLoading(true);

    // Hard timeout so a hung listener can't spin forever for new users.
    const timeout = window.setTimeout(() => {
      if (cancelled) return;
      console.warn("[AccessGate] access check timed out — showing apply form");
      setReqLoading(false);
    }, 4000);

    // Prefer a quick getDoc so we don't depend solely on the first snapshot.
    void fetchAccessRequest(user.uid).then((req) => {
      if (cancelled) return;
      window.clearTimeout(timeout);
      setRequest(req);
      setReqLoading(false);
    });

    const unsub = listenAccessRequest(user.uid, (req) => {
      if (cancelled) return;
      window.clearTimeout(timeout);
      setRequest(req);
      setReqLoading(false);
    });

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      unsub();
    };
  }, [user, bypass]);

  const status = useMemo(() => resolveAccess(user, request), [user, request]);

  if (bypass || !user) return <>{children}</>;
  // Allowlisted users skip the waitlist UI entirely (don't wait on Firestore).
  if (allowlisted) return <>{children}</>;
  if (loading || reqLoading) return <PageLoading label="確認使用權限…" />;
  if (status === "approved") return <>{children}</>;
  if (status === "pending") {
    return (
      <AccessShell>
        <PendingPanel email={user.email || ""} name={request?.display_name || displayName} />
      </AccessShell>
    );
  }
  if (status === "rejected") {
    return (
      <AccessShell>
        <RejectedPanel />
      </AccessShell>
    );
  }

  return (
    <AccessShell>
      <ApplyForm
        defaultName={displayName}
        defaultUsername={username}
        email={user.email || ""}
        onSubmit={async (payload) => {
          await saveProfile({
            displayName: payload.displayName,
            username: payload.username,
          });
          await submitAccessApplication(user, payload);
          toast("申請已送出，我們會盡快審核");
        }}
      />
    </AccessShell>
  );
}

function AccessShell({ children }: { children: ReactNode }) {
  return (
    <div className="access-gate">
      <header className="access-gate-top">
        <AlbireusLogo height={28} />
        <div className="access-gate-top-actions">
          <ThemeToggle />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => logout()}>
            登出
          </button>
        </div>
      </header>
      <main className="access-gate-main">{children}</main>
    </div>
  );
}

function PendingPanel({ email, name }: { email: string; name: string }) {
  return (
    <div className="access-panel">
      <p className="access-kicker">封閉測試中</p>
      <h1>申請已送出，請稍候</h1>
      <p className="access-lead">
        {name ? `${name}，` : ""}
        我們正在控制同時上線人數，避免塞車。審核通過後就能使用 Albireus，結果會以這個帳號通知／開放：
      </p>
      <p className="access-email">{email}</p>
      <p className="access-hint">通常會在幾天內處理。你隨時可以登出，之後再用同一帳號回來查看狀態。</p>
    </div>
  );
}

function RejectedPanel() {
  return (
    <div className="access-panel">
      <p className="access-kicker">封閉測試中</p>
      <h1>這次暫時無法開放</h1>
      <p className="access-lead">感謝你的申請。目前額度已滿或條件不符，之後若再開名額會再公告。</p>
    </div>
  );
}

function toggleId(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function MultiChoice({
  legend,
  hint,
  options,
  value,
  onChange,
  disabled,
  otherText,
  onOtherText,
}: {
  legend: string;
  hint?: string;
  options: readonly { id: string; label: string }[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  otherText?: string;
  onOtherText?: (v: string) => void;
}) {
  const showOther = value.includes("other") && onOtherText;
  return (
    <fieldset className="access-field" disabled={disabled}>
      <legend>
        {legend}
        <span className="access-optional">選填 · 可多選</span>
      </legend>
      {hint ? <em>{hint}</em> : null}
      <div className="access-choices">
        {options.map((o) => {
          const on = value.includes(o.id);
          return (
            <label key={o.id} className={`access-chip${on ? " is-on" : ""}`}>
              <input
                type="checkbox"
                checked={on}
                onChange={() => onChange(toggleId(value, o.id))}
              />
              {o.label}
            </label>
          );
        })}
      </div>
      {showOther ? (
        <input
          className="input access-other-input"
          value={otherText || ""}
          disabled={disabled}
          onChange={(e) => onOtherText?.(e.target.value)}
          placeholder="若選「其他」，可補充說明（可不填）"
          maxLength={120}
        />
      ) : null}
    </fieldset>
  );
}

function ApplyForm({
  defaultName,
  defaultUsername,
  email,
  onSubmit,
}: {
  defaultName: string;
  defaultUsername: string;
  email: string;
  onSubmit: (payload: AccessApplicationInput) => Promise<void>;
}) {
  const [name, setName] = useState(defaultName || "");
  const [handle, setHandle] = useState(defaultUsername || "");
  const [useCases, setUseCases] = useState<string[]>([]);
  const [workflows, setWorkflows] = useState<string[]>([]);
  const [frequencies, setFrequencies] = useState<string[]>([]);
  const [referrals, setReferrals] = useState<string[]>([]);
  const [useCaseOther, setUseCaseOther] = useState("");
  const [workflowOther, setWorkflowOther] = useState("");
  const [referralOther, setReferralOther] = useState("");
  const [wished, setWished] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (defaultName) setName(defaultName);
    if (defaultUsername) setHandle(defaultUsername);
  }, [defaultName, defaultUsername]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const nameErr = validateDisplayName(name);
    if (nameErr) {
      toast(nameErr);
      return;
    }
    const userErr = validateUsername(handle);
    if (userErr) {
      toast(userErr);
      return;
    }
    setBusy(true);
    try {
      await onSubmit({
        displayName: name.trim(),
        username: handle.trim().toLowerCase(),
        useCases,
        currentWorkflows: workflows,
        frequencies,
        referrals,
        useCaseOther,
        workflowOther,
        referralOther,
        wishedFeatures: wished.trim(),
      });
    } catch (err) {
      toast(err instanceof Error ? err.message : "送出失敗");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="access-panel access-form" onSubmit={(e) => void submit(e)}>
      <div className="access-form-intro">
        <p className="access-kicker">封閉測試中</p>
        <h1>申請使用 Albireus</h1>
        <p className="access-lead">
          目前還在開發、名額有限，無論上課、開會或工作整理都歡迎申請。
          你現在登入的是 <strong>{email}</strong>；送出申請並通過審核後，才能用這個帳號進入 Albireus。
        </p>
        <p className="access-hint">下方調查皆可略過；有填會幫助我們排優先功能。</p>
      </div>

      <label className="access-field">
        <span>
          顯示名稱 <span className="access-required">必填</span>
        </span>
        <input
          className="input"
          value={name}
          maxLength={40}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
          placeholder="其他人會看到的名字"
          required
        />
      </label>

      <label className="access-field">
        <span>
          用戶名稱 <span className="access-required">必填</span>
        </span>
        <div className="st-username-field">
          <span className="st-username-at">@</span>
          <input
            className="input"
            value={handle}
            maxLength={20}
            disabled={busy}
            onChange={(e) => setHandle(e.target.value.toLowerCase())}
            placeholder="your_name"
            autoComplete="username"
            spellCheck={false}
            required
          />
        </div>
        <em>小寫字母開頭，3–20 字（a-z、0-9、_）</em>
      </label>

      <MultiChoice
        legend="你主要用什麼場景？"
        options={USE_CASE_OPTIONS}
        value={useCases}
        onChange={setUseCases}
        disabled={busy}
        otherText={useCaseOther}
        onOtherText={setUseCaseOther}
      />

      <MultiChoice
        legend="目前怎麼整理筆記？"
        options={WORKFLOW_OPTIONS}
        value={workflows}
        onChange={setWorkflows}
        disabled={busy}
        otherText={workflowOther}
        onOtherText={setWorkflowOther}
      />

      <MultiChoice
        legend="一週大概會用幾次？"
        options={FREQUENCY_OPTIONS}
        value={frequencies}
        onChange={setFrequencies}
        disabled={busy}
      />

      <label className="access-field">
        <span>
          最希望有的功能 <span className="access-optional">選填</span>
        </span>
        <textarea
          className="input"
          rows={4}
          value={wished}
          disabled={busy}
          onChange={(e) => setWished(e.target.value)}
          placeholder="例如：會議自動整理成待辦、訪談逐字稿可搜尋、專案進度一鍵摘要…"
          maxLength={500}
        />
      </label>

      <MultiChoice
        legend="你怎麼知道 Albireus？"
        options={REFERRAL_OPTIONS}
        value={referrals}
        onChange={setReferrals}
        disabled={busy}
        otherText={referralOther}
        onOtherText={setReferralOther}
      />

      <div className="access-submit-row">
        <button type="submit" className="btn access-submit" disabled={busy}>
          {busy ? "送出中…" : "送出申請並等待審核"}
        </button>
      </div>
    </form>
  );
}
