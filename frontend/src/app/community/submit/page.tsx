"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ScrambleText from "@/components/motion/ScrambleText";
import PageLoading from "@/components/motion/PageLoading";
import { useAuth } from "@/components/AuthProvider";
import { loginWithGoogle } from "@/lib/firebase";
import RichNoteEditor from "@/components/RichNoteEditor";
import AiMarkdown from "@/components/AiMarkdown";
import {
  buildDraftManifest,
  publishCommunityPackage,
  sanitizePackageId,
} from "@/lib/community/publish";
import { parseManifestJsonText } from "@/lib/community/parseManifest";
import type { TemplatePageDef } from "@/lib/community/types";
import { buildCoverPrompt } from "@/lib/community/coverPrompts";
import { toast } from "@/lib/toast";

type KindChoice = "extension" | "template";
type Step = 1 | 2 | 3 | 4;

const CATEGORIES = ["生產力", "學習", "研究", "會議", "其他"];

export default function CommunitySubmitPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [kind, setKind] = useState<KindChoice>("extension");
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [version, setVersion] = useState("1.0.0");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("生產力");
  const [tags, setTags] = useState("");
  const [icon, setIcon] = useState("extension");
  const [entry, setEntry] = useState("index.html");
  const [createLabel, setCreateLabel] = useState("新擴充頁");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState("");
  const [shotFiles, setShotFiles] = useState<File[]>([]);
  const [readmeMd, setReadmeMd] = useState(
    "# 說明\n\n在這裡介紹你的套件：功能、使用方式、注意事項。\n\n可用螢光筆、顏色、圖片與清單。\n"
  );
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [tplPages, setTplPages] = useState<TemplatePageDef[]>([
    { title: "首頁", body: "# 新模板\n\n開始編輯…\n", file: "home.md" },
  ]);
  const [advancedJson, setAdvancedJson] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");

  const authorName = user?.displayName || user?.email?.split("@")[0] || "匿名";
  const draftId = useMemo(
    () => `community_draft_${user?.uid || "anon"}`,
    [user?.uid]
  );

  if (loading) return <PageLoading />;
  if (!user) {
    return (
      <div className="community-page">
        <ScrambleText words="上傳並分享" as="h1" className="page-title font-display" />
        <p className="page-sub">登入後即可上傳擴充或模板，發佈後立刻出現在社群商店。</p>
        <button type="button" className="btn" onClick={() => void loginWithGoogle()}>
          登入後開始
        </button>
      </div>
    );
  }

  const onCover = (f: File | null) => {
    setCoverFile(f);
    if (coverPreview) URL.revokeObjectURL(coverPreview);
    setCoverPreview(f ? URL.createObjectURL(f) : "");
  };

  const syncIdFromName = () => {
    if (id.trim()) return;
    const slug = sanitizePackageId(name) || "my-package";
    setId(slug);
  };

  const publish = async () => {
    setError("");
    setBusy(true);
    setProgress("準備中…");
    try {
      if (!coverFile && !coverPreview) throw new Error("請上傳封面");
      if (kind === "extension" && !zipFile && !/^https:\/\//i.test(entry.trim())) {
        throw new Error("擴充請上傳 zip（含靜態頁），或填寫 https 入口網址");
      }
      const tagList = tags
        .split(/[,，\s]+/)
        .map((t) => t.replace(/^#/, "").trim())
        .filter(Boolean)
        .slice(0, 12);

      let manifest = buildDraftManifest({
        kind,
        id: id || name,
        name,
        version,
        description,
        author: authorName,
        category,
        icon: kind === "template" ? icon || "description" : icon || "extension",
        entry,
        createLabel,
        pages: tplPages,
      });

      if (advancedJson.trim()) {
        try {
          const parsed = parseManifestJsonText(advancedJson);
          manifest = {
            ...parsed,
            ...manifest,
            id: sanitizePackageId(manifest.id),
            kind: manifest.kind,
          } as typeof manifest;
        } catch (e) {
          throw new Error(`進階 JSON 無效：${e instanceof Error ? e.message : "錯誤"}`);
        }
      }

      const pub = await publishCommunityPackage({
        uid: user.uid,
        authorName,
        authorPhoto: user.photoURL || undefined,
        manifest,
        readmeMd,
        coverFile,
        screenshotFiles: shotFiles,
        zipFile,
        templateFiles:
          kind === "template"
            ? Object.fromEntries(
                tplPages.map((p) => [p.file || `inline-${p.title}.md`, p.body || ""])
              )
            : undefined,
        tags: tagList,
        onProgress: setProgress,
      });
      toast("已上架到社群商店");
      router.push(`/community/${pub.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "發佈失敗");
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  return (
    <div className="community-page community-submit">
      <nav className="community-crumb">
        <Link href="/community">社群商店</Link>
        <span>/</span>
        <span>上傳並分享</span>
      </nav>
      <ScrambleText words="上傳並分享" as="h1" className="page-title font-display" />
      <p className="page-sub">
        上傳擴充頁面／擴充功能或模板，填寫封面與說明後即可發佈——立刻出現在商店供大家安裝。
      </p>

      <ol className="community-submit-steps" aria-label="步驟">
        {[
          { n: 1 as Step, label: "類型" },
          { n: 2 as Step, label: "基本資料" },
          { n: 3 as Step, label: "封面與說明" },
          { n: 4 as Step, label: "套件與發佈" },
        ].map((s) => (
          <li key={s.n}>
            <button
              type="button"
              className={`community-submit-step${step === s.n ? " is-on" : ""}${step > s.n ? " is-done" : ""}`}
              onClick={() => setStep(s.n)}
            >
              <span>{s.n}</span>
              {s.label}
            </button>
          </li>
        ))}
      </ol>

      {step === 1 && (
        <section className="community-submit-panel">
          <h2>選擇類型</h2>
          <div className="community-submit-kinds">
            <button
              type="button"
              className={kind === "extension" ? "is-on" : ""}
              onClick={() => {
                setKind("extension");
                setIcon("extension");
              }}
            >
              <strong>擴充功能／擴充頁面</strong>
              <span>iframe 沙箱頁面，可上傳 zip 靜態檔由 Albireus 代管</span>
            </button>
            <button
              type="button"
              className={kind === "template" ? "is-on" : ""}
              onClick={() => {
                setKind("template");
                setIcon("description");
              }}
            >
              <strong>模板</strong>
              <span>一組筆記頁面，安裝後套用到知識庫</span>
            </button>
          </div>
          <div className="community-card-actions">
            <button type="button" className="btn" onClick={() => setStep(2)}>
              下一步
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="community-submit-panel">
          <h2>基本資料</h2>
          <div className="community-submit-grid">
            <label>
              名稱
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={syncIdFromName}
                placeholder="例如：背單字助手"
              />
            </label>
            <label>
              套件 id（網址用，唯一）
              <input
                className="input"
                value={id}
                onChange={(e) => setId(sanitizePackageId(e.target.value))}
                placeholder="my-vocab-helper"
              />
            </label>
            <label>
              版本
              <input className="input" value={version} onChange={(e) => setVersion(e.target.value)} />
            </label>
            <label>
              分類
              <select className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label>
              圖示（Material 名稱）
              <input className="input" value={icon} onChange={(e) => setIcon(e.target.value)} />
            </label>
            <label>
              標籤（空白或逗號分隔）
              <input
                className="input"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="學習, 英語"
              />
            </label>
            <label className="community-submit-full">
              簡短描述
              <textarea
                className="input"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="一句話說明這個套件能做什麼"
              />
            </label>
            {kind === "extension" && (
              <>
                <label>
                  入口檔名或 https 網址
                  <input
                    className="input"
                    value={entry}
                    onChange={(e) => setEntry(e.target.value)}
                    placeholder="index.html 或 https://…"
                  />
                </label>
                <label>
                  建立按鈕文案
                  <input
                    className="input"
                    value={createLabel}
                    onChange={(e) => setCreateLabel(e.target.value)}
                  />
                </label>
              </>
            )}
          </div>
          <div className="community-card-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setStep(1)}>
              上一步
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                if (!name.trim()) {
                  toast("請填名稱");
                  return;
                }
                syncIdFromName();
                setStep(3);
              }}
            >
              下一步
            </button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="community-submit-panel">
          <h2>封面與說明</h2>
          <label className="community-submit-file">
            封面（必填）
            <input
              type="file"
              accept="image/*"
              onChange={(e) => onCover(e.target.files?.[0] || null)}
            />
          </label>
          {coverPreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="community-submit-cover-preview" src={coverPreview} alt="" />
          ) : (
            <div className="community-submit-ai-cover">
              <p className="community-submit-hint">
                還沒有封面？用下方提示詞到 AI 繪圖工具生成（扁平海報風，內容對應你的擴充／模板）。
              </p>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={async () => {
                  const prompt = buildCoverPrompt({
                    name: name.trim() || "未命名套件",
                    description,
                    kind,
                    tags: tags
                      .split(/[,，\s]+/)
                      .map((t) => t.replace(/^#/, "").trim())
                      .filter(Boolean),
                  });
                  try {
                    await navigator.clipboard.writeText(prompt);
                    toast("已複製 AI 封面提示詞");
                  } catch {
                    toast("無法複製，請手動選取下方文字");
                  }
                }}
              >
                複製 AI 封面提示詞
              </button>
              <pre className="community-submit-prompt">
                {buildCoverPrompt({
                  name: name.trim() || "未命名套件",
                  description,
                  kind,
                  tags: tags
                    .split(/[,，\s]+/)
                    .map((t) => t.replace(/^#/, "").trim())
                    .filter(Boolean),
                })}
              </pre>
            </div>
          )}
          <label className="community-submit-file">
            截圖（可多選）
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => setShotFiles(Array.from(e.target.files || []))}
            />
          </label>
          <p className="community-submit-hint">說明（README）— 與筆記相同的編輯能力</p>
          <div className="community-submit-readme">
            <div className="doc-ribbon" id="community-readme-ribbon" />
            <RichNoteEditor
              valueMd={readmeMd}
              onChangeMd={setReadmeMd}
              placeholder="撰寫套件說明…"
              userId={user.uid}
              noteId={draftId}
              showEmptyTemplates={false}
            />
          </div>
          <div className="community-card-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setStep(2)}>
              上一步
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                if (!coverFile) {
                  toast("請上傳封面");
                  return;
                }
                setStep(4);
              }}
            >
              下一步
            </button>
          </div>
        </section>
      )}

      {step === 4 && (
        <section className="community-submit-panel">
          <h2>套件內容與發佈</h2>
          {kind === "extension" ? (
            <>
              <label className="community-submit-file">
                上傳 zip（建議：含 albireus.json + index.html + 靜態資源）
                <input
                  type="file"
                  accept=".zip,application/zip"
                  onChange={(e) => setZipFile(e.target.files?.[0] || null)}
                />
              </label>
              {zipFile ? <p className="community-submit-hint">已選：{zipFile.name}</p> : null}
              <p className="community-submit-hint">
                若入口填的是 https:// 外部網址，可不上傳 zip；相對路徑入口則必須上傳 zip。
              </p>
            </>
          ) : (
            <>
              <label className="community-submit-file">
                或上傳模板 zip（可選）
                <input
                  type="file"
                  accept=".zip,application/zip"
                  onChange={(e) => setZipFile(e.target.files?.[0] || null)}
                />
              </label>
              <h3>頁面</h3>
              {tplPages.map((p, i) => (
                <div key={i} className="community-submit-tpl-page">
                  <input
                    className="input"
                    value={p.title}
                    onChange={(e) => {
                      const next = [...tplPages];
                      next[i] = { ...p, title: e.target.value };
                      setTplPages(next);
                    }}
                    placeholder="頁面標題"
                  />
                  <textarea
                    className="input"
                    rows={6}
                    value={p.body || ""}
                    onChange={(e) => {
                      const next = [...tplPages];
                      next[i] = { ...p, body: e.target.value };
                      setTplPages(next);
                    }}
                    placeholder="Markdown 內容"
                  />
                </div>
              ))}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() =>
                  setTplPages((prev) => [
                    ...prev,
                    {
                      title: `頁面 ${prev.length + 1}`,
                      body: "",
                      file: `page-${prev.length + 1}.md`,
                    },
                  ])
                }
              >
                ＋ 新增頁面
              </button>
            </>
          )}

          <details className="community-submit-advanced">
            <summary>進階：貼上／驗證 albireus.json</summary>
            <textarea
              className="community-submit-ta"
              value={advancedJson}
              onChange={(e) => setAdvancedJson(e.target.value)}
              placeholder='{ "schema": 1, "kind": "extension", ... }'
              rows={10}
              spellCheck={false}
            />
          </details>

          <div className="community-submit-preview">
            <h3>預覽說明</h3>
            <AiMarkdown text={readmeMd} />
          </div>

          {error ? <p className="community-empty" style={{ color: "var(--danger)" }}>{error}</p> : null}
          {progress ? <p className="community-submit-hint">{progress}</p> : null}

          <div className="community-card-actions">
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setStep(3)}>
              上一步
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => void publish()}>
              {busy ? "發佈中…" : "發佈到商店"}
            </button>
            <Link className="btn btn-ghost" href="/community/docs">
              開發文件
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
