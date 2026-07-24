"use client";

import PageLoading from "@/components/motion/PageLoading";

import { askConfirm } from "@/lib/dialogs";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { loginWithGoogle, logout } from "@/lib/firebase";
import { usePrefs } from "@/components/PrefsProvider";
import MenuSelect from "@/components/MenuSelect";
import ScrambleText from "@/components/motion/ScrambleText";
import {
  ACCENTS,
  CAPTURE_LANGS,
  HOME_OPTIONS,
  SETTINGS_SECTIONS,
  SHORTCUT_HELP,
  SettingsSectionId,
  UserPrefs,
  clearLocalWorkspaceCaches,
  exportPrefsJson,
  formatPrefsSummary,
  importPrefsJson,
  resetPrefs,
} from "@/lib/userPrefs";
import {
  DEFAULT_LIVE_HIDE_DOCK_SHORTCUT,
  formatShortcutLabel,
  shortcutFromEvent,
} from "@/lib/shortcutSpec";
import { AI_TEXT_MODELS } from "@/lib/aiPrefs";
import { toast } from "@/lib/toast";
import { isAllowlistedEmail } from "@/lib/accessGate";
import { formatBytes, USER_STORAGE_LIMIT_BYTES } from "@/lib/storageQuota";
import StorageManagerDialog from "@/components/shell/StorageManagerDialog";
import LocalFolderSyncPanel from "@/components/library/LocalFolderSyncPanel";
import WorkspacePropertiesSettings from "@/components/settings/WorkspacePropertiesSettings";
import { useNotesList } from "@/components/notes/NotesListProvider";

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="st-row">
      <div className="st-row-label">
        <strong>{label}</strong>
        {hint ? <span>{hint}</span> : null}
      </div>
      <div className="st-row-ctrl">{children}</div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`st-switch${checked ? " is-on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <i />
    </button>
  );
}

function Seg<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="st-seg">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className={value === o.id ? "is-on" : ""}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function ProfileEditor() {
  const {
    user,
    displayName,
    username,
    photoURL,
    profileLoading,
    saveProfile,
    uploadAvatarFile,
  } = useAuth();
  const [name, setName] = useState(displayName);
  const [handle, setHandle] = useState(username);
  const [preview, setPreview] = useState(photoURL);
  const [photoPath, setPhotoPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setName(displayName);
    setHandle(username);
    setPreview(photoURL);
  }, [displayName, username, photoURL]);

  if (!user) return null;

  const dirty =
    name.trim() !== displayName.trim() ||
    handle.trim().toLowerCase() !== username.trim().toLowerCase() ||
    preview !== photoURL;

  const onPickAvatar = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setUploadPct(0);
    try {
      const { url, path } = await uploadAvatarFile(file, setUploadPct);
      setPreview(url);
      setPhotoPath(path);
      toast("頭像已上傳，記得儲存");
    } catch (e) {
      toast(e instanceof Error ? e.message : "上傳失敗");
    } finally {
      setBusy(false);
      setUploadPct(0);
    }
  };

  const onSave = async () => {
    setBusy(true);
    try {
      await saveProfile({
        displayName: name,
        username: handle,
        photoURL: preview,
        photoPath: photoPath || undefined,
      });
      toast("個人資料已儲存");
    } catch (e) {
      toast(e instanceof Error ? e.message : "儲存失敗");
    } finally {
      setBusy(false);
    }
  };

  const onResetGoogle = async () => {
    setName(user.displayName || user.email?.split("@")[0] || "");
    setPreview(user.photoURL || "");
    setPhotoPath("");
    toast("已還原為 Google 帳號預設（尚未儲存）");
  };

  return (
    <div className="st-profile">
      <div className="st-profile-avatar-row">
        <div className="st-profile-avatar-wrap">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="st-profile-avatar"
              src={preview}
              alt=""
              width={72}
              height={72}
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className="st-profile-avatar-fallback" aria-hidden>
              {(name || "?").slice(0, 1)}
            </span>
          )}
        </div>
        <div className="st-profile-avatar-actions">
          <button
            type="button"
            className="btn btn-soft btn-sm"
            disabled={busy || profileLoading}
            onClick={() => fileRef.current?.click()}
          >
            {uploadPct > 0 && uploadPct < 100 ? `上傳中 ${uploadPct}%` : "更換頭像"}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy}
            onClick={() => void onResetGoogle()}
          >
            還原 Google 預設
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0] || null;
              void onPickAvatar(f);
              e.target.value = "";
            }}
          />
          <p className="st-muted">PNG / JPG / WebP，最大 2MB</p>
        </div>
      </div>

      <Row label="顯示名稱" hint="其他人在筆記、團隊中看到的名字">
        <input
          className="input"
          value={name}
          maxLength={40}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
          placeholder="顯示名稱"
        />
      </Row>
      <Row label="用戶名稱" hint="唯一識別，小寫字母開頭，3–20 字（a-z、0-9、_）">
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
      </Row>
      <Row label="登入信箱" hint="由 Google 帳號提供，無法在此修改">
        <span className="st-email-readonly">{user.email}</span>
      </Row>

      <div className="st-profile-save">
        <button
          type="button"
          className="btn"
          disabled={busy || profileLoading || !dirty}
          onClick={() => void onSave()}
        >
          {busy ? "儲存中…" : "儲存個人資料"}
        </button>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { user, loading } = useAuth();
  const { notes } = useNotesList();
  const { prefs, setPrefs, replacePrefs } = usePrefs();
  const [section, setSection] = useState<SettingsSectionId>("appearance");
  const [importText, setImportText] = useState("");
  const [storageOpen, setStorageOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = document.getElementById(`st-${section}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [section]);

  const patch = (p: Partial<UserPrefs>) => setPrefs(p);

  const doReset = () => {
    void (async () => {
      if (!(await askConfirm({ title: "重設所有偏好？", message: "將恢復為預設值。", danger: true, confirmLabel: "重設" }))) return;
      replacePrefs(resetPrefs());
      toast("已重設偏好");
    })();
  };

  const doExport = () => {
    const blob = new Blob([exportPrefsJson(prefs)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cadence-prefs.json";
    a.click();
    URL.revokeObjectURL(url);
    toast("已匯出偏好");
  };

  const doImportPaste = () => {
    try {
      const next = importPrefsJson(importText);
      replacePrefs(next);
      setImportText("");
      toast("已匯入偏好");
    } catch {
      toast("匯入失敗：JSON 格式不正確");
    }
  };

  const doImportFile = async (file: File) => {
    try {
      const text = await file.text();
      replacePrefs(importPrefsJson(text));
      toast("已從檔案匯入");
    } catch {
      toast("匯入失敗");
    }
  };

  const doClearCaches = () => {
    void (async () => {
      if (!(await askConfirm({ title: "清除本機快取？", message: "清除白板／圖譜位置快取，不會刪除雲端筆記。", confirmLabel: "清除" }))) return;
      const n = clearLocalWorkspaceCaches(user?.uid);
      toast(`已清除 ${n} 筆本機快取`);
    })();
  };

  return (
    <div className="st-page">
      <header className="st-hero">
        <div>
          <ScrambleText words="設定" as="h1" className="page-title font-display" speed={22} />
          <p className="page-sub">{formatPrefsSummary(prefs)}</p>
        </div>
        <div className="st-hero-actions">
          <button type="button" className="btn btn-soft btn-sm" onClick={doExport}>
            匯出偏好
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={doReset}>
            重設預設
          </button>
        </div>
      </header>

      <div className="st-layout">
        <nav className="st-nav" aria-label="設定區塊">
          {SETTINGS_SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className={section === s.id ? "is-on" : ""}
              onClick={() => setSection(s.id)}
            >
              {s.label}
            </button>
          ))}
        </nav>

        <div className="st-main">
          <section id="st-appearance" className="st-card">
            <h2>外觀</h2>
            <Row label="主題" hint="可跟隨系統或固定深淺色">
              <Seg
                value={prefs.theme}
                onChange={(theme) => patch({ theme })}
                options={[
                  { id: "system", label: "系統" },
                  { id: "light", label: "淺色" },
                  { id: "dark", label: "深色" },
                ]}
              />
            </Row>
            <Row label="強調色" hint="影響按鈕與高亮">
              <div className="st-accents">
                {ACCENTS.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className={`st-accent${prefs.accent === a.id ? " is-on" : ""}`}
                    title={`${a.label}（${a.hint}）`}
                    onClick={() => patch({ accent: a.id })}
                  >
                    <i style={{ background: a.light.accent }} />
                    <span>{a.label}</span>
                  </button>
                ))}
              </div>
            </Row>
            <Row label="介面密度">
              <Seg
                value={prefs.density}
                onChange={(density) => patch({ density })}
                options={[
                  { id: "cozy", label: "寬鬆" },
                  { id: "comfortable", label: "適中" },
                  { id: "compact", label: "緊湊" },
                ]}
              />
            </Row>
            <Row label="字級縮放">
              <Seg
                value={prefs.fontScale}
                onChange={(fontScale) => patch({ fontScale })}
                options={[
                  { id: "90", label: "90%" },
                  { id: "100", label: "100%" },
                  { id: "110", label: "110%" },
                  { id: "120", label: "120%" },
                ]}
              />
            </Row>
            <Row label="側欄寬度" hint="也可在側欄右緣拖曳調整；「«」可收合">
              <Seg
                value={prefs.sidebarWidth}
                onChange={(sidebarWidth) => patch({ sidebarWidth })}
                options={[
                  { id: "narrow", label: "窄" },
                  { id: "default", label: "標準" },
                  { id: "wide", label: "寬" },
                ]}
              />
            </Row>
            <Row label="減少動態效果" hint="關閉標題 scramble 等動畫">
              <Toggle
                checked={prefs.reduceMotion}
                onChange={(reduceMotion) => patch({ reduceMotion })}
                label="減少動態"
              />
            </Row>
            <Row label="標題 scramble 動畫">
              <Toggle
                checked={prefs.showScrambleTitles}
                onChange={(showScrambleTitles) => patch({ showScrambleTitles })}
              />
            </Row>
            <Row label="卡片陰影">
              <Toggle
                checked={prefs.cardShadows}
                onChange={(cardShadows) => patch({ cardShadows })}
              />
            </Row>
          </section>

          <section id="st-navigation" className="st-card">
            <h2>導覽</h2>
            <Row label="預設首頁" hint="點側欄 Logo 時前往">
              <MenuSelect
                variant="soft"
                ariaLabel="預設首頁"
                value={prefs.homePage}
                options={HOME_OPTIONS.map((o) => ({ value: o.id, label: o.label }))}
                onChange={(homePage) => patch({ homePage })}
              />
            </Row>
            <Row label="行動版精簡底欄">
              <Toggle
                checked={prefs.compactMobileNav}
                onChange={(compactMobileNav) => patch({ compactMobileNav })}
              />
            </Row>
            <Row label="啟用鍵盤快捷鍵">
              <Toggle
                checked={prefs.enableShortcuts}
                onChange={(enableShortcuts) => patch({ enableShortcuts })}
              />
            </Row>
            <div className="st-shortcuts">
              <h3>快捷鍵一覽</h3>
              <ul>
                {[
                  ...SHORTCUT_HELP.filter((s) => !s.action.includes("隱藏／顯示即時錄製")),
                  {
                    keys: formatShortcutLabel(prefs.liveHideDockShortcut),
                    action: "隱藏／顯示即時錄製面板",
                  },
                ].map((s) => (
                  <li key={`${s.keys}-${s.action}`}>
                    <kbd>{s.keys}</kbd>
                    <span>{s.action}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section id="st-library" className="st-card">
            <h2>知識庫</h2>
            <Row label="預設檢視">
              <Seg
                value={prefs.libraryView}
                onChange={(libraryView) => patch({ libraryView })}
                options={[
                  { id: "list", label: "列表" },
                  { id: "grid", label: "網格" },
                  { id: "compact", label: "緊湊" },
                ]}
              />
            </Row>
            <Row label="預設排序">
              <MenuSelect
                variant="soft"
                ariaLabel="知識庫排序"
                value={prefs.librarySort}
                options={[
                  { value: "updated", label: "最近更新" },
                  { value: "created", label: "最近建立" },
                  { value: "title", label: "標題" },
                  { value: "length", label: "篇幅" },
                ]}
                onChange={(librarySort) => patch({ librarySort })}
              />
            </Row>
            <Row label="顯示轉錄工作">
              <Toggle
                checked={prefs.libraryShowJobs}
                onChange={(libraryShowJobs) => patch({ libraryShowJobs })}
              />
            </Row>
            <Row label="顯示空白筆記">
              <Toggle
                checked={prefs.libraryShowEmpty}
                onChange={(libraryShowEmpty) => patch({ libraryShowEmpty })}
              />
            </Row>
            {user ? (
              <Row label="工作區屬性" hint="筆記、資料庫、看板共用">
                <WorkspacePropertiesSettings userId={user.uid} />
              </Row>
            ) : null}
            {user ? (
              <Row
                label="本機資料夾"
                hint="連結本機 Markdown 資料夾，與知識庫雙向同步（Chrome／Edge）"
              >
                <LocalFolderSyncPanel
                  uid={user.uid}
                  notes={notes}
                  variant="settings"
                />
              </Row>
            ) : null}
          </section>

          <section id="st-board" className="st-card">
            <h2>看板</h2>
            <Row label="預設排序">
              <MenuSelect
                variant="soft"
                ariaLabel="看板排序"
                value={prefs.boardSort}
                options={[
                  { value: "updated", label: "最近更新" },
                  { value: "priority", label: "優先級" },
                  { value: "due", label: "截止日期" },
                  { value: "age", label: "閒置最久" },
                  { value: "title", label: "標題" },
                ]}
                onChange={(boardSort) => patch({ boardSort })}
              />
            </Row>
            <Row label="預設隱藏已完成">
              <Toggle
                checked={prefs.boardHideDone}
                onChange={(boardHideDone) => patch({ boardHideDone })}
              />
            </Row>
            <Row label="預設資料夾泳道">
              <Toggle
                checked={prefs.boardSwimlanes}
                onChange={(boardSwimlanes) => patch({ boardSwimlanes })}
              />
            </Row>
            <Row label="WIP 超限警告">
              <Toggle
                checked={prefs.boardWipWarn}
                onChange={(boardWipWarn) => patch({ boardWipWarn })}
              />
            </Row>
          </section>

          <section id="st-editor" className="st-card">
            <h2>筆記編輯</h2>
            <Row label="新筆記預設資料夾">
              <input
                className="input st-input"
                placeholder="例如：專案／靈感"
                value={prefs.defaultFolder}
                onChange={(e) => patch({ defaultFolder: e.target.value })}
              />
            </Row>
            <Row label="新筆記預設標籤" hint="空白分隔，如 會議 靈感">
              <input
                className="input st-input"
                placeholder="會議 靈感"
                value={prefs.defaultTags}
                onChange={(e) => patch({ defaultTags: e.target.value })}
              />
            </Row>
            <Row label="新筆記預設狀態">
              <Seg
                value={prefs.defaultStatus || "backlog"}
                onChange={(defaultStatus) =>
                  patch({ defaultStatus: defaultStatus as UserPrefs["defaultStatus"] })
                }
                options={[
                  { id: "backlog", label: "待辦" },
                  { id: "doing", label: "進行中" },
                  { id: "done", label: "完成" },
                ]}
              />
            </Row>
            <Row label="編輯區寬度">
              <Seg
                value={prefs.editorWidth}
                onChange={(editorWidth) => patch({ editorWidth })}
                options={[
                  { id: "narrow", label: "窄" },
                  { id: "medium", label: "中" },
                  { id: "wide", label: "寬" },
                  { id: "full", label: "全寬" },
                ]}
              />
            </Row>
            <Row label={`正文大小 ${prefs.editorFontSize}px`}>
              <input
                type="range"
                min={13}
                max={24}
                value={prefs.editorFontSize}
                onChange={(e) => patch({ editorFontSize: Number(e.target.value) })}
              />
            </Row>
            <Row label={`行高 ${prefs.editorLineHeight.toFixed(2)}`}>
              <input
                type="range"
                min={1.3}
                max={2.2}
                step={0.05}
                value={prefs.editorLineHeight}
                onChange={(e) => patch({ editorLineHeight: Number(e.target.value) })}
              />
            </Row>
            <Row
              label={`雲端同步間隔 ${prefs.autosaveSeconds}s`}
              hint="編輯會立刻留在本機；停打後才寫入雲端。較短較即時，較長較省讀寫。"
            >
              <input
                type="range"
                min={2}
                max={15}
                value={prefs.autosaveSeconds}
                onChange={(e) => patch({ autosaveSeconds: Number(e.target.value) })}
              />
            </Row>
            <Row label="預設顯示大綱側欄">
              <Toggle
                checked={prefs.editorShowOutline}
                onChange={(editorShowOutline) => patch({ editorShowOutline })}
              />
            </Row>
            <Row label="拼字檢查">
              <Toggle
                checked={prefs.editorSpellcheck}
                onChange={(editorSpellcheck) => patch({ editorSpellcheck })}
              />
            </Row>
            <Row label="寫作目標" hint="在筆記屬性區顯示字數目標">
              <Toggle
                checked={prefs.editorWritingGoals}
                onChange={(editorWritingGoals) => patch({ editorWritingGoals })}
              />
            </Row>
            <Row label="斜線選單 /">
              <Toggle checked={prefs.slashMenu} onChange={(slashMenu) => patch({ slashMenu })} />
            </Row>
            <Row label="Wiki 連結建議 [[">
              <Toggle
                checked={prefs.wikiSuggest}
                onChange={(wikiSuggest) => patch({ wikiSuggest })}
              />
            </Row>
            <Row label="插入音訊／影片／YouTube 後" hint="可記住選擇，之後不再詢問">
              <MenuSelect
                value={prefs.mediaIngestDefault || "ask"}
                onChange={(mediaIngestDefault) =>
                  patch({
                    mediaIngestDefault: mediaIngestDefault as UserPrefs["mediaIngestDefault"],
                  })
                }
                options={[
                  { value: "ask", label: "每次詢問" },
                  { value: "embed", label: "僅嵌入" },
                  { value: "transcribe", label: "自動轉錄" },
                  { value: "transcribe_summarize", label: "自動轉錄 + 摘要" },
                ]}
              />
            </Row>
          </section>

          <section id="st-ai" className="st-card">
            <h2>Albireus AI</h2>
            <Row label="助手名稱">
              <input
                className="input"
                value={prefs.aiAssistantName}
                onChange={(e) => patch({ aiAssistantName: e.target.value })}
                placeholder="Albireus AI"
                maxLength={40}
              />
            </Row>
            <Row label="回答風格">
              <Seg
                value={prefs.aiStyle}
                onChange={(aiStyle) => patch({ aiStyle })}
                options={[
                  { id: "concise", label: "精簡" },
                  { id: "balanced", label: "平衡" },
                  { id: "detailed", label: "詳細" },
                ]}
              />
            </Row>
            <Row label="Gemini 模型">
              <MenuSelect
                variant="soft"
                ariaLabel="Gemini 模型"
                value={prefs.aiModel}
                options={AI_TEXT_MODELS.map((m) => ({
                  value: m.id,
                  label: m.label,
                  hint: m.hint,
                }))}
                onChange={(aiModel) => patch({ aiModel })}
              />
            </Row>
            <Row label="上網搜尋" hint="Grounding with Google Search；需要時模型會查網並附來源">
              <Toggle
                checked={prefs.aiGrounding}
                onChange={(aiGrounding) => patch({ aiGrounding })}
              />
            </Row>
            <Row
              label="允許 AI 修改筆記"
              hint="右側 AI 欄在你明確要求改寫／整理本篇時，可直接寫入筆記內容"
            >
              <Toggle
                checked={prefs.aiAllowNoteEdit}
                onChange={(aiAllowNoteEdit) => patch({ aiAllowNoteEdit })}
              />
            </Row>
            <Row label="預設脈絡範圍">
              <Seg
                value={prefs.aiDefaultScope}
                onChange={(aiDefaultScope) => patch({ aiDefaultScope })}
                options={[
                  { id: "note", label: "本篇" },
                  { id: "folder", label: "資料夾" },
                  { id: "library", label: "知識庫" },
                ]}
              />
            </Row>
            <p className="st-hint">
              筆記頁 Ctrl+J；全站右下角 AI 或 Ctrl+Shift+A。文字模型預設 Gemini 3.5 Flash；圖片用 gemini-3-pro-image。啟用上網後，對話區也可臨時開關。
            </p>
          </section>

          <section id="st-capture" className="st-card">
            <h2>捕捉</h2>
            <Row label="預設來源">
              <Seg
                value={prefs.captureDefaultSource}
                onChange={(captureDefaultSource) => patch({ captureDefaultSource })}
                options={[
                  { id: "file", label: "檔案" },
                  { id: "youtube", label: "YouTube" },
                  { id: "record", label: "錄音" },
                ]}
              />
            </Row>
            <Row label="轉錄語言偏好">
              <MenuSelect
                variant="soft"
                ariaLabel="轉錄語言"
                value={prefs.captureLanguage}
                options={CAPTURE_LANGS.map((l) => ({ value: l.id, label: l.label }))}
                onChange={(captureLanguage) => patch({ captureLanguage })}
              />
            </Row>
            <p className="st-hint">
              建議用「自動偵測」：英文片維持英文；若內容是中文，簡體會自動轉成繁體。
              「English」可強制英文。「繁體／簡體中文」不會再硬解成中文（避免英文片被整段聽成中文），中文結果仍會轉繁體。
            </p>
            <Row label={`單次最多檔案 ${prefs.captureMaxFiles}`}>
              <input
                type="range"
                min={1}
                max={20}
                value={prefs.captureMaxFiles}
                onChange={(e) => patch({ captureMaxFiles: Number(e.target.value) })}
              />
            </Row>
            <Row label="完成後自動開啟工作">
              <Toggle
                checked={prefs.captureAutoOpenJob}
                onChange={(captureAutoOpenJob) => patch({ captureAutoOpenJob })}
              />
            </Row>
            <Row
              label={`即時錄音最短切段 ${prefs.liveChunkMinSecs}s`}
              hint="切段批次：這段至少錄滿多久，且偵測到停頓後才切（預設 15s，適合 podcast／課程）"
            >
              <input
                type="range"
                min={15}
                max={180}
                step={5}
                value={prefs.liveChunkMinSecs}
                onChange={(e) => patch({ liveChunkMinSecs: Number(e.target.value) })}
              />
            </Row>
            <Row
              label={`即時錄音每 ${prefs.liveOrganizeEveryChunks} 段整理`}
              hint="切段批次：累積此段數後才呼叫 AI 整理；即時串流改為每 5 分鐘整理。手動「AI 整理」不受限"
            >
              <input
                type="range"
                min={1}
                max={30}
                value={prefs.liveOrganizeEveryChunks}
                onChange={(e) => patch({ liveOrganizeEveryChunks: Number(e.target.value) })}
              />
            </Row>
            <Row
              label={`停頓判定 ${prefs.liveSilenceMs}ms`}
              hint="安靜持續多久視為可切段（預設 700ms；愈短愈容易切，愈長愈等完整句）"
            >
              <input
                type="range"
                min={600}
                max={3000}
                step={100}
                value={prefs.liveSilenceMs}
                onChange={(e) => patch({ liveSilenceMs: Number(e.target.value) })}
              />
            </Row>
            <Row
              label="即時串流轉錄"
              hint="預設關閉（切段批次較省）。開啟後邊講邊出字；用完額度會自動改回切段且不中斷錄音。"
            >
              <Toggle
                checked={prefs.liveStreamStt}
                onChange={(liveStreamStt) => patch({ liveStreamStt })}
              />
            </Row>
            <Row
              label={`串流最長偏好 ${prefs.liveStreamMaxMins} 分鐘`}
              hint="單次開啟串流的偏好上限（仍受 5 小時總額度限制）"
            >
              <input
                type="range"
                min={15}
                max={300}
                step={15}
                value={prefs.liveStreamMaxMins}
                disabled={!prefs.liveStreamStt}
                onChange={(e) => patch({ liveStreamMaxMins: Number(e.target.value) })}
              />
            </Row>
            <Row
              label="隱藏錄製面板快捷鍵"
              hint="錄製中可隱藏底部面板，避免旁人注意；再按一次或點角落小點即可顯示。預設 ⌘/Ctrl + Shift + H"
            >
              <div className="st-shortcut-capture">
                <input
                  className="input st-input"
                  readOnly
                  value={formatShortcutLabel(prefs.liveHideDockShortcut)}
                  aria-label="隱藏錄製面板快捷鍵"
                  placeholder="在此按下新的快捷鍵"
                  onKeyDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.key === "Escape" || e.key === "Backspace" || e.key === "Delete") {
                      patch({ liveHideDockShortcut: DEFAULT_LIVE_HIDE_DOCK_SHORTCUT });
                      toast("已重設為預設快捷鍵");
                      return;
                    }
                    const next = shortcutFromEvent(e.nativeEvent);
                    if (!next) return;
                    patch({ liveHideDockShortcut: next });
                    toast(`已設為 ${formatShortcutLabel(next)}`);
                  }}
                />
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => {
                    patch({ liveHideDockShortcut: DEFAULT_LIVE_HIDE_DOCK_SHORTCUT });
                    toast("已重設為預設快捷鍵");
                  }}
                >
                  重設
                </button>
              </div>
            </Row>
          </section>

          <section id="st-journal" className="st-card">
            <h2>日誌</h2>
            <Row label="一週起始">
              <Seg
                value={prefs.journalWeekStart}
                onChange={(journalWeekStart) => patch({ journalWeekStart })}
                options={[
                  { id: "monday", label: "週一" },
                  { id: "sunday", label: "週日" },
                ]}
              />
            </Row>
            <Row label="顯示熱圖">
              <Toggle
                checked={prefs.journalShowHeatmap}
                onChange={(journalShowHeatmap) => patch({ journalShowHeatmap })}
              />
            </Row>
            <Row label="每日寫作提示">
              <Toggle
                checked={prefs.journalPromptDaily}
                onChange={(journalPromptDaily) => patch({ journalPromptDaily })}
              />
            </Row>
            <Row label="日期格式">
              <Seg
                value={prefs.dateFormat}
                onChange={(dateFormat) => patch({ dateFormat })}
                options={[
                  { id: "ymd", label: "年-月-日" },
                  { id: "dmy", label: "日/月/年" },
                  { id: "mdy", label: "月/日/年" },
                ]}
              />
            </Row>
          </section>

          <section id="st-views" className="st-card">
            <h2>白板／圖譜</h2>
            <Row label="圖譜預設佈局">
              <MenuSelect
                variant="soft"
                ariaLabel="圖譜佈局"
                value={prefs.graphDefaultLayout}
                options={[
                  { value: "force", label: "力導向" },
                  { value: "radial", label: "放射" },
                  { value: "cluster", label: "資料夾簇" },
                  { value: "grid", label: "網格" },
                  { value: "timeline", label: "時間線" },
                ]}
                onChange={(graphDefaultLayout) => patch({ graphDefaultLayout })}
              />
            </Row>
            <Row label="圖譜顯示幽靈節點">
              <Toggle
                checked={prefs.graphShowGhosts}
                onChange={(graphShowGhosts) => patch({ graphShowGhosts })}
              />
            </Row>
            <Row label="圖譜預設開啟標籤邊">
              <Toggle
                checked={prefs.graphShowTagEdges}
                onChange={(graphShowTagEdges) => patch({ graphShowTagEdges })}
              />
            </Row>
            <Row label="白板格線">
              <Toggle checked={prefs.canvasGrid} onChange={(canvasGrid) => patch({ canvasGrid })} />
            </Row>
            <Row label="白板吸附">
              <Toggle checked={prefs.canvasSnap} onChange={(canvasSnap) => patch({ canvasSnap })} />
            </Row>
            <Row label="白板預設工具">
              <Seg
                value={prefs.canvasDefaultTool}
                onChange={(canvasDefaultTool) => patch({ canvasDefaultTool })}
                options={[
                  { id: "select", label: "選取" },
                  { id: "pan", label: "平移" },
                  { id: "sticky", label: "便利貼" },
                ]}
              />
            </Row>
          </section>

          <section id="st-privacy" className="st-card">
            <h2>隱私與資料</h2>
            <Row label="刪除前確認">
              <Toggle
                checked={prefs.askBeforeDelete}
                onChange={(askBeforeDelete) => patch({ askBeforeDelete })}
              />
            </Row>
            <Row label="分析資料僅本機" hint="目前不會上傳使用分析">
              <Toggle
                checked={prefs.analyticsLocalOnly}
                onChange={(analyticsLocalOnly) => patch({ analyticsLocalOnly })}
              />
            </Row>
            <Row label="清除本機畫布／圖譜快取">
              <button type="button" className="btn btn-ghost btn-sm" onClick={doClearCaches}>
                清除快取
              </button>
            </Row>
            <Row label="匯入偏好 JSON">
              <div className="st-import">
                <textarea
                  className="input"
                  rows={4}
                  placeholder='貼上 {"version":1,...}'
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                />
                <div className="st-import-actions">
                  <button
                    type="button"
                    className="btn btn-soft btn-sm"
                    disabled={!importText.trim()}
                    onClick={doImportPaste}
                  >
                    從文字匯入
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => fileRef.current?.click()}
                  >
                    從檔案…
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="application/json,.json"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void doImportFile(f);
                      e.target.value = "";
                    }}
                  />
                </div>
              </div>
            </Row>
          </section>

          <section id="st-account" className="st-card">
            <h2>帳號與工具</h2>
            {loading ? (
              <PageLoading fill={false} />
            ) : user ? (
              <>
                <ProfileEditor />
                <div className="st-account-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => logout()}>
                    登出
                  </button>
                </div>
              </>
            ) : (
              <button type="button" className="btn" onClick={() => loginWithGoogle()}>
                使用 Google 登入
              </button>
            )}
            <div className="st-tool-block">
              <h3>儲存空間</h3>
              <p>
                測試期間每位使用者上限約 {formatBytes(USER_STORAGE_LIMIT_BYTES)}。請自行備份重要資料，不要把重要檔案只保存在這裡。
              </p>
              {user ? (
                <button type="button" className="btn btn-soft btn-sm" onClick={() => setStorageOpen(true)}>
                  管理檔案
                </button>
              ) : null}
            </div>
            {user ? (
              <StorageManagerDialog
                uid={user.uid}
                open={storageOpen}
                onClose={() => setStorageOpen(false)}
              />
            ) : null}
            {isAllowlistedEmail(user?.email) ? (
              <div className="st-tool-block">
                <h3>開發者工具</h3>
                <p>審核內測申請，並以 support@albireus.com 寄出核准信。</p>
                <Link className="btn btn-soft btn-sm" href="/admin/access">
                  開啟內測申請核准
                </Link>
              </div>
            ) : null}
          </section>

          <section id="st-about" className="st-card">
            <h2>關於 Albireus</h2>
            <p className="st-about">
              Albireus 是語音驅動的知識工作區：捕捉聲音、校對逐字稿、寫成可連結的筆記。偏好儲存在本機瀏覽器，換裝置需重新匯入。
            </p>
            <p className="st-muted">
              舊版歷史頁：{" "}
              <Link href="/history" className="st-link">
                /history
              </Link>
            </p>
          </section>
        </div>
      </div>

    </div>
  );
}
