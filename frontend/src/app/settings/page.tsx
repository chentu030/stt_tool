"use client";

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

export default function SettingsPage() {
  const { user, loading } = useAuth();
  const { prefs, setPrefs, replacePrefs } = usePrefs();
  const [section, setSection] = useState<SettingsSectionId>("appearance");
  const [toast, setToast] = useState("");
  const [importText, setImportText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = document.getElementById(`st-${section}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [section]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2400);
  };

  const patch = (p: Partial<UserPrefs>) => setPrefs(p);

  const doReset = () => {
    if (!window.confirm("確定重設所有偏好為預設值？")) return;
    replacePrefs(resetPrefs());
    flash("已重設偏好");
  };

  const doExport = () => {
    const blob = new Blob([exportPrefsJson(prefs)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cadence-prefs.json";
    a.click();
    URL.revokeObjectURL(url);
    flash("已匯出偏好");
  };

  const doImportPaste = () => {
    try {
      const next = importPrefsJson(importText);
      replacePrefs(next);
      setImportText("");
      flash("已匯入偏好");
    } catch {
      flash("匯入失敗：JSON 格式不正確");
    }
  };

  const doImportFile = async (file: File) => {
    try {
      const text = await file.text();
      replacePrefs(importPrefsJson(text));
      flash("已從檔案匯入");
    } catch {
      flash("匯入失敗");
    }
  };

  const doClearCaches = () => {
    if (!window.confirm("清除本機白板／圖譜位置快取？（不會刪除雲端筆記）")) return;
    const n = clearLocalWorkspaceCaches(user?.uid);
    flash(`已清除 ${n} 筆本機快取`);
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
            <Row label="側欄寬度">
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
                {SHORTCUT_HELP.map((s) => (
                  <li key={s.keys}>
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
            <Row label={`自動儲存間隔 ${prefs.autosaveSeconds}s`}>
              <input
                type="range"
                min={1}
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
            <Row label="斜線選單 /">
              <Toggle checked={prefs.slashMenu} onChange={(slashMenu) => patch({ slashMenu })} />
            </Row>
            <Row label="Wiki 連結建議 [[">
              <Toggle
                checked={prefs.wikiSuggest}
                onChange={(wikiSuggest) => patch({ wikiSuggest })}
              />
            </Row>
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
            <Row label={`預設能量 ${prefs.journalDefaultEnergy}`}>
              <input
                type="range"
                min={1}
                max={5}
                value={prefs.journalDefaultEnergy}
                onChange={(e) => patch({ journalDefaultEnergy: Number(e.target.value) })}
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
              <p className="st-muted">載入中…</p>
            ) : user ? (
              <div className="st-account">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={user.photoURL || ""} alt="" width={48} height={48} />
                <div>
                  <strong>{user.displayName}</strong>
                  <span>{user.email}</span>
                </div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => logout()}>
                  登出
                </button>
              </div>
            ) : (
              <button type="button" className="btn" onClick={() => loginWithGoogle()}>
                使用 Google 登入
              </button>
            )}
            <div className="st-tool-block">
              <h3>YouTube 本機擷取器</h3>
              <p>用你自己的 IP 下載公開影片音訊，避開伺服器被封鎖。</p>
              <a className="btn btn-soft btn-sm" href="/youtube-extractor.zip" download>
                下載擴充
              </a>
            </div>
          </section>

          <section id="st-about" className="st-card">
            <h2>關於 Cadence</h2>
            <p className="st-about">
              Cadence 是語音驅動的知識工作區：捕捉聲音、校對逐字稿、寫成可連結的筆記。偏好儲存在本機瀏覽器，換裝置需重新匯入。
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

      {toast && <div className="st-toast">{toast}</div>}
    </div>
  );
}
