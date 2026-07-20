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
  listenAccessRequest,
  resolveAccess,
  submitAccessApplication,
  type AccessRequest,
} from "@/lib/accessGate";
import { validateDisplayName, validateUsername } from "@/lib/userProfile";

export default function AccessGate({ children }: { children: ReactNode }) {
  const { user, loading, displayName, username, saveProfile } = useAuth();
  const pathname = usePathname();
  const [request, setRequest] = useState<AccessRequest | null>(null);
  const [reqLoading, setReqLoading] = useState(false);

  const bypass = isAccessBypassPath(pathname);

  useEffect(() => {
    if (!user || bypass) {
      setRequest(null);
      setReqLoading(false);
      return;
    }
    let cancelled = false;
    setReqLoading(true);
    void ensureAllowlistAccess(user).catch((e) => console.warn("[ensureAllowlistAccess]", e));
    const unsub = listenAccessRequest(user.uid, (req) => {
      if (cancelled) return;
      setRequest(req);
      setReqLoading(false);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [user, bypass]);

  const status = useMemo(() => resolveAccess(user, request), [user, request]);

  if (bypass || !user) return <>{children}</>;
  if (loading || reqLoading) return <PageLoading label="確認使用權限…" />;
  if (status === "approved") return <>{children}</>;
  if (status === "pending") {
    return <AccessShell><PendingPanel email={user.email || ""} name={request?.display_name || displayName} /></AccessShell>;
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
        {name ? `${name}，` : ""}我們正在控制同時上線人數，避免塞車。審核通過後就能使用 Albireus，結果會以這個帳號通知／開放：
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

function ApplyForm({
  defaultName,
  defaultUsername,
  email,
  onSubmit,
}: {
  defaultName: string;
  defaultUsername: string;
  email: string;
  onSubmit: (payload: {
    displayName: string;
    username: string;
    useCase: string;
    currentWorkflow: string;
    frequency: string;
    wishedFeatures: string;
    referral: string;
  }) => Promise<void>;
}) {
  const [name, setName] = useState(defaultName || "");
  const [handle, setHandle] = useState(defaultUsername || "");
  const [useCase, setUseCase] = useState("");
  const [workflow, setWorkflow] = useState("");
  const [frequency, setFrequency] = useState("");
  const [wished, setWished] = useState("");
  const [referral, setReferral] = useState("");
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
    if (!useCase || !workflow || !frequency || !referral) {
      toast("請完成簡單調查後再送出");
      return;
    }
    if (!wished.trim()) {
      toast("請告訴我們你希望有的功能");
      return;
    }
    setBusy(true);
    try {
      await onSubmit({
        displayName: name.trim(),
        username: handle.trim().toLowerCase(),
        useCase,
        currentWorkflow: workflow,
        frequency,
        wishedFeatures: wished.trim(),
        referral,
      });
    } catch (err) {
      toast(err instanceof Error ? err.message : "送出失敗");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="access-panel access-form" onSubmit={(e) => void submit(e)}>
      <p className="access-kicker">封閉測試中</p>
      <h1>申請使用 Albireus</h1>
      <p className="access-lead">
        目前還在開發、名額有限。登入帳號 <strong>{email}</strong> 需先申請，通過後才能進入產品。
      </p>

      <label className="access-field">
        <span>顯示名稱</span>
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
        <span>用戶名稱</span>
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

      <fieldset className="access-field" disabled={busy}>
        <legend>你主要用什麼場景？</legend>
        <div className="access-choices">
          {USE_CASE_OPTIONS.map((o) => (
            <label key={o.id} className={`access-chip${useCase === o.id ? " is-on" : ""}`}>
              <input
                type="radio"
                name="useCase"
                value={o.id}
                checked={useCase === o.id}
                onChange={() => setUseCase(o.id)}
              />
              {o.label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="access-field" disabled={busy}>
        <legend>目前怎麼整理筆記？</legend>
        <div className="access-choices">
          {WORKFLOW_OPTIONS.map((o) => (
            <label key={o.id} className={`access-chip${workflow === o.id ? " is-on" : ""}`}>
              <input
                type="radio"
                name="workflow"
                value={o.id}
                checked={workflow === o.id}
                onChange={() => setWorkflow(o.id)}
              />
              {o.label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="access-field" disabled={busy}>
        <legend>一週大概會用幾次？</legend>
        <div className="access-choices">
          {FREQUENCY_OPTIONS.map((o) => (
            <label key={o.id} className={`access-chip${frequency === o.id ? " is-on" : ""}`}>
              <input
                type="radio"
                name="frequency"
                value={o.id}
                checked={frequency === o.id}
                onChange={() => setFrequency(o.id)}
              />
              {o.label}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="access-field">
        <span>最希望有的功能</span>
        <textarea
          className="input"
          rows={3}
          value={wished}
          disabled={busy}
          onChange={(e) => setWished(e.target.value)}
          placeholder="例如：上課錄音自動整理成可搜尋筆記、會議待辦抽取…"
          maxLength={500}
          required
        />
      </label>

      <fieldset className="access-field" disabled={busy}>
        <legend>你怎麼知道 Albireus？</legend>
        <div className="access-choices">
          {REFERRAL_OPTIONS.map((o) => (
            <label key={o.id} className={`access-chip${referral === o.id ? " is-on" : ""}`}>
              <input
                type="radio"
                name="referral"
                value={o.id}
                checked={referral === o.id}
                onChange={() => setReferral(o.id)}
              />
              {o.label}
            </label>
          ))}
        </div>
      </fieldset>

      <button type="submit" className="btn access-submit" disabled={busy}>
        {busy ? "送出中…" : "送出申請並等待審核"}
      </button>
    </form>
  );
}
