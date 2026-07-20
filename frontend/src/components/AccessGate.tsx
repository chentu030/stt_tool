"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { useAuth } from "@/components/AuthProvider";
import { logout } from "@/lib/firebase";
import AlbireusLogo from "@/components/AlbireusLogo";
import PageLoading from "@/components/motion/PageLoading";
import ThemeToggle from "@/components/ThemeToggle";
import LineRippleBackground from "@/components/motion/LineRippleBackground";
import ScrambleText from "@/components/motion/ScrambleText";
import TypeWriter from "@/components/motion/TypeWriter";
import ShinyPill from "@/components/motion/ShinyPill";
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

    if (isAllowlistedEmail(user.email)) {
      setReqLoading(false);
      void ensureAllowlistAccess(user).catch((e) => console.warn("[ensureAllowlistAccess]", e));
      return;
    }

    let cancelled = false;
    setReqLoading(true);

    const timeout = window.setTimeout(() => {
      if (cancelled) return;
      console.warn("[AccessGate] access check timed out — showing apply form");
      setReqLoading(false);
    }, 4000);

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
      <ApplyWizard
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
    <div className="access-panel access-panel--status">
      <p className="access-kicker">封閉測試中</p>
      <ScrambleText
        words="申請已送出"
        as="h1"
        className="font-display"
        speed={22}
        color="var(--text-main)"
      />
      <p className="access-lead">
        {name ? `${name}，` : ""}
        我們正在控制同時上線人數。通過後會以這個帳號開放：
      </p>
      <p className="access-email">{email}</p>
      <p className="access-hint">通常幾天內處理。可先登出，之後用同一帳號回來查看。</p>
    </div>
  );
}

function RejectedPanel() {
  return (
    <div className="access-panel access-panel--status">
      <p className="access-kicker">封閉測試中</p>
      <ScrambleText words="這次暫時無法開放" as="h1" className="font-display" speed={22} />
      <p className="access-lead">感謝申請。目前額度已滿或條件不符，之後若再開名額會再公告。</p>
    </div>
  );
}

type StepId = "welcome" | "profile" | "usecase" | "workflow" | "frequency" | "wish" | "referral" | "review";

const STEPS: { id: StepId; title: string; optional?: boolean }[] = [
  { id: "welcome", title: "歡迎" },
  { id: "profile", title: "你的帳號" },
  { id: "usecase", title: "使用場景", optional: true },
  { id: "workflow", title: "整理方式", optional: true },
  { id: "frequency", title: "使用頻率", optional: true },
  { id: "wish", title: "希望功能", optional: true },
  { id: "referral", title: "從哪裡來", optional: true },
  { id: "review", title: "確認送出" },
];

function toggleId(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function ChoiceGrid({
  options,
  value,
  onChange,
  disabled,
  otherText,
  onOtherText,
}: {
  options: readonly { id: string; label: string }[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  otherText?: string;
  onOtherText?: (v: string) => void;
}) {
  const showOther = value.includes("other") && onOtherText;
  return (
    <div className="access-choices">
      {options.map((o, i) => {
        const on = value.includes(o.id);
        return (
          <motion.label
            key={o.id}
            className={`access-chip${on ? " is-on" : ""}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.04 * i, duration: 0.28 }}
            whileTap={{ scale: 0.97 }}
          >
            <input
              type="checkbox"
              checked={on}
              disabled={disabled}
              onChange={() => onChange(toggleId(value, o.id))}
            />
            {o.label}
          </motion.label>
        );
      })}
      {showOther ? (
        <motion.input
          className="input access-other-input"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          value={otherText || ""}
          disabled={disabled}
          onChange={(e) => onOtherText?.(e.target.value)}
          placeholder="若選「其他」，可補充說明（可不填）"
          maxLength={120}
        />
      ) : null}
    </div>
  );
}

function ApplyWizard({
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
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
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

  const current = STEPS[step];
  const progress = step / (STEPS.length - 1);

  const go = (next: number) => {
    setDir(next > step ? 1 : -1);
    setStep(next);
  };

  const next = () => {
    if (current.id === "profile") {
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
    }
    if (step < STEPS.length - 1) go(step + 1);
  };

  const back = () => {
    if (step > 0) go(step - 1);
  };

  const skip = () => {
    if (current.optional && step < STEPS.length - 1) go(step + 1);
  };

  const submit = async () => {
    const nameErr = validateDisplayName(name);
    if (nameErr) {
      toast(nameErr);
      go(1);
      return;
    }
    const userErr = validateUsername(handle);
    if (userErr) {
      toast(userErr);
      go(1);
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

  const labelOf = (opts: readonly { id: string; label: string }[], ids: string[]) =>
    ids.map((id) => opts.find((o) => o.id === id)?.label || id).join("、") || "（略過）";

  return (
    <div className="access-panel access-wizard">
      {current.id !== "welcome" ? (
        <div className="access-wizard-progress" aria-hidden>
          <div className="access-wizard-progress-bar" style={{ width: `${progress * 100}%` }} />
        </div>
      ) : null}

      <AnimatePresence mode="wait" custom={dir}>
        <motion.div
          key={current.id}
          className="access-wizard-step"
          custom={dir}
          initial={{ opacity: 0, x: dir * 28, filter: "blur(4px)" }}
          animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, x: dir * -22, filter: "blur(4px)" }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
        >
          {current.id === "welcome" ? (
            <div className="access-welcome">
              <LineRippleBackground
                count={40}
                movement={16}
                strokeColor="rgba(13, 148, 136, 0.22)"
                force={3}
              />
              <div className="access-welcome-inner">
                <p className="access-kicker">封閉測試中</p>
                <ScrambleText
                  words="申請使用 Albireus"
                  as="h1"
                  className="font-display"
                  speed={20}
                  color="var(--text-main)"
                />
                <p className="access-lead access-welcome-lead">
                  無論上課、開會或工作整理都歡迎申請。
                  <br />
                  目前登入：<strong>{email}</strong>
                </p>
                <p className="access-welcome-type">
                  <TypeWriter
                    texts={[
                      "語音／影片一鍵轉文字",
                      "筆記可編輯、可搜尋",
                      "寫作與簡報同一頁切換",
                      "雙向連結串起知識",
                      "AI 幫你摘要與整理",
                    ]}
                    typedColor="var(--accent-2)"
                    cursorColor="var(--accent-2)"
                    typeMs={40}
                    holdMs={1800}
                  />
                </p>
                <ShinyPill onClick={() => go(1)}>開始申請</ShinyPill>
              </div>
            </div>
          ) : null}

          {current.id === "profile" ? (
            <>
              <StepHead title="先設定你的身分" hint="這兩項必填，之後可在設定裡改" required />
              <label className="access-field">
                <span>顯示名稱</span>
                <input
                  className="input"
                  value={name}
                  maxLength={40}
                  disabled={busy}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="其他人會看到的名字"
                  autoFocus
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
                  />
                </div>
                <em>小寫字母開頭，3–20 字（a-z、0-9、_）</em>
              </label>
            </>
          ) : null}

          {current.id === "usecase" ? (
            <>
              <StepHead title="你主要用什麼場景？" hint="可多選，也可直接略過" optional />
              <ChoiceGrid
                options={USE_CASE_OPTIONS}
                value={useCases}
                onChange={setUseCases}
                disabled={busy}
                otherText={useCaseOther}
                onOtherText={setUseCaseOther}
              />
            </>
          ) : null}

          {current.id === "workflow" ? (
            <>
              <StepHead title="目前怎麼整理筆記？" hint="可多選，也可略過" optional />
              <ChoiceGrid
                options={WORKFLOW_OPTIONS}
                value={workflows}
                onChange={setWorkflows}
                disabled={busy}
                otherText={workflowOther}
                onOtherText={setWorkflowOther}
              />
            </>
          ) : null}

          {current.id === "frequency" ? (
            <>
              <StepHead title="一週大概會用幾次？" hint="選一個或幾個都行" optional />
              <ChoiceGrid
                options={FREQUENCY_OPTIONS}
                value={frequencies}
                onChange={setFrequencies}
                disabled={busy}
              />
            </>
          ) : null}

          {current.id === "wish" ? (
            <>
              <StepHead title="最希望有的功能？" hint="一句話就好，可不填" optional />
              <label className="access-field">
                <textarea
                  className="input"
                  rows={5}
                  value={wished}
                  disabled={busy}
                  onChange={(e) => setWished(e.target.value)}
                  placeholder="例如：會議自動整理成待辦、訪談逐字稿可搜尋…"
                  maxLength={500}
                  autoFocus
                />
              </label>
            </>
          ) : null}

          {current.id === "referral" ? (
            <>
              <StepHead title="你怎麼知道 Albireus？" hint="可多選，也可略過" optional />
              <ChoiceGrid
                options={REFERRAL_OPTIONS}
                value={referrals}
                onChange={setReferrals}
                disabled={busy}
                otherText={referralOther}
                onOtherText={setReferralOther}
              />
            </>
          ) : null}

          {current.id === "review" ? (
            <>
              <StepHead title="確認並送出" hint="通過後會用這個 Google 帳號開放" />
              <ul className="access-review">
                <li>
                  <span>顯示名稱</span>
                  <strong>{name.trim() || "—"}</strong>
                </li>
                <li>
                  <span>用戶名稱</span>
                  <strong>@{handle.trim().toLowerCase() || "—"}</strong>
                </li>
                <li>
                  <span>帳號</span>
                  <strong className="access-review-email">{email}</strong>
                </li>
                <li>
                  <span>場景</span>
                  <strong>{labelOf(USE_CASE_OPTIONS, useCases)}</strong>
                </li>
                <li>
                  <span>整理方式</span>
                  <strong>{labelOf(WORKFLOW_OPTIONS, workflows)}</strong>
                </li>
                <li>
                  <span>頻率</span>
                  <strong>{labelOf(FREQUENCY_OPTIONS, frequencies)}</strong>
                </li>
                <li>
                  <span>希望功能</span>
                  <strong>{wished.trim() || "（略過）"}</strong>
                </li>
                <li>
                  <span>來源</span>
                  <strong>{labelOf(REFERRAL_OPTIONS, referrals)}</strong>
                </li>
              </ul>
            </>
          ) : null}
        </motion.div>
      </AnimatePresence>

      {current.id !== "welcome" ? (
        <div className="access-wizard-nav">
          <button type="button" className="btn btn-ghost btn-sm" onClick={back} disabled={busy || step === 0}>
            上一步
          </button>
          <div className="access-wizard-nav-right">
            {current.optional ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={skip} disabled={busy}>
                略過
              </button>
            ) : null}
            {current.id === "review" ? (
              <button type="button" className="btn access-submit" onClick={() => void submit()} disabled={busy}>
                {busy ? "送出中…" : "送出申請"}
              </button>
            ) : (
              <button type="button" className="btn access-submit" onClick={next} disabled={busy}>
                下一步
              </button>
            )}
          </div>
        </div>
      ) : null}

      {current.id !== "welcome" ? (
        <p className="access-step-meta">
          {step}/{STEPS.length - 1} · {current.title}
        </p>
      ) : null}
    </div>
  );
}

function StepHead({
  title,
  hint,
  required,
  optional,
}: {
  title: string;
  hint?: string;
  required?: boolean;
  optional?: boolean;
}) {
  return (
    <div className="access-step-head">
      <ScrambleText words={title} as="h1" className="font-display" speed={18} color="var(--text-main)" />
      {hint ? (
        <p className="access-hint">
          {hint}
          {required ? <span className="access-required"> 必填</span> : null}
          {optional ? <span className="access-optional"> 選填</span> : null}
        </p>
      ) : null}
    </div>
  );
}
