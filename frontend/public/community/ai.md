# Albireus Community Extension Guide (for AI & developers)

> **How to use this file**  
> Paste this entire document into your AI chat (or open `https://YOUR_ALBIREUS_HOST/community/ai.md`) and ask it to build an Albireus extension or template that visually matches the host app.

**Product:** Albireus — Traditional Chinese knowledge workspace (notes, board, canvas, graph, database, voice transcription).  
**Community packages:** declarative JSON only. The host **never executes remote JavaScript**. Extensions render as a **sandboxed iframe** pointing at your HTTPS page.

---

## 0. Non‑negotiable architecture

| Rule | Detail |
|------|--------|
| Manifest file | Must be named `albireus.json` (repo root or zip root). |
| Schema | `"schema": 1` |
| Extension UI | **Only** `pageType.type: "iframe"` + HTTPS `entry` URL. |
| No host plugins | You cannot inject React components, TipTap nodes, or sidebar widgets via JS. |
| Sandbox | iframe uses `sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"`. |
| Language | UI copy for Taiwan users should be **Traditional Chinese** (`zh-TW`). |
| App version | Current `minAppVersion` baseline: `0.1.0` |
| Paid lock | Optional `"paid": true` — store shows under **收費擴充**; install/download blocked until billing exists. Bypass allowlist (host-side): `lcy101120@gmail.com`. |

If the user asks for “a Chrome-style extension API inside Albireus”, redirect them to: **ship a small HTTPS web app + `albireus.json`**.

---

## 1. Package kinds

### A) `extension` (tool / app page)

- Appears in the left **Apps / 頁面** nav after install.
- “+” menu can create a workspace page that opens your iframe.
- Stored under the user’s Firestore library; settings persist per user.

### B) `template` (note pack)

- On apply, creates one or more **notes** in the user’s knowledge base (Markdown bodies).
- Declares permission `notes_write`.
- No iframe.

---

## 2. Minimal extension checklist (ship order)

1. Build a **static or SSR HTTPS** page (Vercel / Cloudflare Pages / GitHub Pages / your API).
2. Style it with the **Albireus design tokens** below (so it blends in the iframe).
3. Read `?note=`, `?settings=`, `s_*` query params (and optional `postMessage`).
4. Write `albireus.json` with a unique `id` (lowercase `a-z0-9_-`, **must not contain** `albireus`).
5. Put `albireus.json` (+ optional `README.md`) in a public GitHub repo root.
6. In Albireus: Community Store → **從 GitHub 安裝** with `owner/repo`, or upload `.zip` / JSON.
7. Validate JSON at `/community/submit` before asking to be featured.

Human docs mirror: `/community/docs`  
Sample manifests: `/samples/albireus-extension-sample.json`, `/samples/albireus-template-sample.json`

---

## 3. `albireus.json` — extension example

```json
{
  "schema": 1,
  "kind": "extension",
  "id": "my-focus-timer",
  "name": "專注計時器",
  "version": "1.0.0",
  "description": "番茄鐘與工作節奏，嵌在知識庫頁面中使用。",
  "author": "YourName",
  "authorUrl": "https://github.com/you",
  "icon": "timer",
  "category": "生產力",
  "cover": "https://example.com/cover.jpg",
  "screenshots": ["https://example.com/shot1.png"],
  "nav": { "label": "計時", "order": 60 },
  "pageType": {
    "type": "iframe",
    "entry": "https://your-tool.example/",
    "createLabel": "新計時頁"
  },
  "settings": [
    {
      "key": "minutes",
      "label": "預設分鐘",
      "type": "number",
      "default": 25,
      "description": "新建頁面時的預設長度"
    },
    {
      "key": "theme",
      "label": "主題",
      "type": "enum",
      "options": ["auto", "light", "dark"],
      "default": "auto"
    }
  ],
  "permissions": ["iframe", "network", "settings", "storage", "clipboard"],
  "minAppVersion": "0.1.0",
  "homepage": "https://your-tool.example/",
  "repository": "https://github.com/you/my-focus-timer",
  "license": "MIT",
  "changelog": [
    { "version": "1.0.0", "date": "2026-07-21", "notes": "初版發佈" }
  ]
}
```

### Field notes (AI must obey)

- `id`: stable forever; changing it = new package.
- `version`: semver string (`1.2.3`).
- `icon`: Material Symbols name string (e.g. `extension`, `timer`, `language`, `bolt`). Prefer simple outlined icons.
- `pageType.entry`: **must be `https://`**. HTTP / relative paths are rejected.
- `settings[]`: `type` ∈ `string` | `boolean` | `number` | `enum` (enum needs `options`).
- `permissions`: optional but recommended for trust UI. Allowed values:
  - `iframe` — sandboxed embed (always implied for extensions)
  - `network` — page may call external APIs
  - `clipboard` — clipboard API
  - `storage` — settings saved on user account
  - `settings` — shows settings panel
  - `notes_read` — extension notes RPC: `get` / `list`
  - `notes_write` — templates **or** notes RPC: `create` / `update` / `attach`

### Template example

```json
{
  "schema": 1,
  "kind": "template",
  "id": "my-standup",
  "name": "站立會議包",
  "version": "1.0.0",
  "description": "昨日／今日／阻礙三頁",
  "author": "YourName",
  "icon": "groups",
  "permissions": ["notes_write"],
  "pages": [
    { "title": "昨日", "file": "yesterday.md", "folder": "站會", "tags": ["standup"] },
    { "title": "今日", "body": "## 今日重點\n- \n", "folder": "站會" }
  ]
}
```

Zip / repo may include the Markdown files referenced by `file`.

---

## 4. How the host connects your page

When a user opens an extension workspace page, Albireus loads:

```text
https://your-entry/?note=<NOTE_ID>&albireus=1&settings=<JSON>&s_<key>=<value>&…
```

Implementation reference (`buildExtensionFrameUrl`):

- `note` — workspace note id (string)
- `albireus=1` — marker that the page is hosted inside Albireus
- `settings` — JSON object of merged defaults + user settings
- `s_<key>` — each setting also as a flat query param

Additionally, after iframe load the host may `postMessage`:

```js
{
  type: "albireus:settings",
  noteId: "<NOTE_ID>",
  extensionId: "<manifest.id>",
  settings: { /* merged settings */ }
}
```

Listen with:

```js
window.addEventListener("message", (e) => {
  if (e.data?.type === "albireus:settings") {
    applySettings(e.data.settings);
  }
});
```

**Do not rely on cookies from albireus.app** — treat the iframe as a separate origin. Persist tool state on your backend keyed by `note` id, or use your own auth.

### 4.1 Notes RPC (`cadence.notes.*`)

Sandboxed extensions may call a typed **postMessage** notes API on the host (signed-in user’s notes only). Declare permissions in `albireus.json`:

- `notes_read` → `cadence.notes.get`, `cadence.notes.list`
- `notes_write` → `cadence.notes.update`, `cadence.notes.create`, `cadence.notes.attach`
- `network` → required **in addition** when `attach` uses a remote `url`

Request (iframe → host) — always include `reqId`:

```js
window.parent.postMessage(
  { type: "cadence.notes.list", reqId: crypto.randomUUID(), q: "會議", limit: 20 },
  "*"
);
```

| type | params |
|------|--------|
| `cadence.notes.get` | `noteId` |
| `cadence.notes.list` | optional `q`, `folder`, `limit` (≤100), `includeBody` |
| `cadence.notes.update` | `noteId`, `patch`: `{ title?, body_md?, tags?, folder? }` |
| `cadence.notes.create` | `title`, optional `body_md`, `tags`, `folder` |
| `cadence.notes.attach` | `noteId`; exactly one of `dataBase64` / `dataUrl` / `url`; optional `filename`, `contentType`, `insert` (`append`\|`none`) |

`attach` uploads under the signed-in user’s note storage and (by default) appends a media markdown snippet to the note body. Decoded / fetched size ≤ 8 MiB. Remote `url` must be `https` and needs `network`.

Reply (host → iframe):

```js
{
  type: "cadence.notes.result",
  reqId,
  method: "get" | "list" | "update" | "create" | "attach",
  ok: true | false,
  data?: /* … */,
  error?: { code: string, message: string }
}
```

Minimal helper (same-origin sample on the host): `/samples/notes-rpc-client.js`

```js
// After loading the helper:
const { items } = await CadenceNotes.list({ q: "會議", limit: 20 });
const note = await CadenceNotes.get(items[0].id);
await CadenceNotes.update(note.id, { title: "新標題" });
await CadenceNotes.create({ title: "擴充建立", body_md: "## hi\n", tags: ["rpc"] });

// Attach (current workspace note id is usually ?note=)
const noteId = new URLSearchParams(location.search).get("note");
await CadenceNotes.attach(noteId, {
  filename: "pixel.png",
  dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
});
// or: await CadenceNotes.attachFile(noteId, fileInput.files[0]);
```

Host checks: message `source` must be the extension iframe, `origin` must match `pageType.entry`, and the method’s permission must be granted. The host **never** evaluates remote `main.js`.

Also available: `albireus:auth` / `albireus:auth-request` (token injection) as used by built-in apps like vocab.

---

## 5. Visual system — make the iframe look native

Albireus uses **teal accent + calm neutrals**, **Outfit** for body, **Space Grotesk** for display titles. Prefer **light** as default (host default theme is light); support dark via `prefers-color-scheme` or a setting.

### Tokens (copy into your extension CSS)

```css
:root {
  /* Light (default — matches host [data-theme="light"]) */
  --bg-primary: #ffffff;
  --bg-elevated: #f7f7f5;
  --bg-card: #ffffff;
  --bg-muted: #f1f1ef;
  --border: rgba(55, 53, 47, 0.09);
  --text-main: #37352f;
  --text-muted: #787774;
  --text-inverse: #ffffff;
  --accent: #0f766e;
  --accent-2: #0d9488;
  --accent-3: #115e59;
  --accent-soft: rgba(15, 118, 110, 0.08);
  --danger: #e03e3e;
  --ok: #0f7b6c;
  --shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
  --radius-sm: 10px;
  --radius-md: 14px;
  --radius-lg: 20px;
  --radius-xl: 28px;
  --font-body: "Outfit", system-ui, sans-serif;
  --font-display: "Space Grotesk", "Outfit", sans-serif;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg-primary: #0b1220;
    --bg-elevated: #111827;
    --bg-card: #151c2c;
    --bg-muted: #1e293b;
    --border: rgba(148, 163, 184, 0.16);
    --text-main: #f8fafc;
    --text-muted: #94a3b8;
    --text-inverse: #0b1220;
    --accent: #0d9488;
    --accent-2: #14b8a6;
    --accent-3: #0369a1;
    --accent-soft: rgba(13, 148, 136, 0.14);
    --danger: #ef4444;
    --ok: #34d399;
    --shadow: 0 8px 30px rgba(0, 0, 0, 0.28);
  }
}

html, body {
  margin: 0;
  min-height: 100%;
  background: var(--bg-primary);
  color: var(--text-main);
  font-family: var(--font-body);
  -webkit-font-smoothing: antialiased;
}

h1, h2, h3, .font-display {
  font-family: var(--font-display);
  font-weight: 700;
  letter-spacing: -0.04em;
}

/* Primary button — mirrors host .btn */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  border: none;
  border-radius: var(--radius-sm);
  padding: 0.55rem 0.95rem;
  font: inherit;
  font-weight: 600;
  cursor: pointer;
  background: var(--accent);
  color: var(--text-inverse);
}
.btn:hover { background: var(--accent-2); }
.btn-ghost {
  background: transparent;
  color: var(--text-main);
  border: 1px solid var(--border);
}
.btn-ghost:hover { background: var(--bg-muted); }
.btn-soft {
  background: var(--accent-soft);
  color: var(--accent-2);
}

.input, input, textarea, select {
  width: 100%;
  border: 1px solid var(--border);
  background: var(--bg-muted);
  color: var(--text-main);
  border-radius: 8px;
  padding: 0.55rem 0.7rem;
  font: inherit;
}

.surface {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow);
  padding: 1rem 1.1rem;
}

.page-sub { color: var(--text-muted); font-size: 0.9rem; }
```

Fonts (optional, for closer match):

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=Space+Grotesk:wght@500;700&display=swap" rel="stylesheet" />
```

### Layout & composition (blend with the shell)

- The iframe sits inside the main workspace column (beside a ~240px sidebar). Design for **narrow widths** first; avoid fixed 1280px layouts.
- Prefer **one primary action** (teal filled button), secondary as ghost/soft.
- Avoid purple/indigo “AI defaults”, neon glow, heavy multi-shadow cards, and emoji-heavy chrome.
- Cards: use subtle border + soft shadow; radius ~14–20px. Do not over-card every section.
- Dense tools (timers, tables): muted backgrounds (`--bg-muted` / `--bg-elevated`), hairline borders.
- Empty states: short Traditional Chinese sentence + one CTA.

### Do / Don’t

| Do | Don’t |
|----|--------|
| Teal accent `#0F766E` / `#0D9488` | Purple-on-white gradient themes |
| Outfit + Space Grotesk | Default Inter/Roboto-only look that clashes |
| Compact toolbar + content | Duplicate a second global sidebar inside the iframe |
| Respect `settings.theme` if you declare it | Force dark mode only |
| Traditional Chinese labels | Mix Simplified Chinese without reason |

---

## 6. Starter HTML page (drop on any static host)

```html
<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Albireus Extension</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700&family=Space+Grotesk:wght@700&display=swap" rel="stylesheet" />
  <style>
    /* paste tokens from §5 */
    :root {
      --bg-primary: #fff; --bg-muted: #f1f1ef; --border: rgba(55,53,47,.09);
      --text-main: #37352f; --text-muted: #787774; --accent: #0f766e; --accent-2: #0d9488;
      --radius-sm: 10px; --font-body: Outfit, system-ui, sans-serif;
      --font-display: "Space Grotesk", Outfit, sans-serif;
    }
    body { margin: 0; font-family: var(--font-body); background: var(--bg-primary); color: var(--text-main); }
    main { padding: 1rem 1.15rem; max-width: 720px; }
    h1 { font-family: var(--font-display); letter-spacing: -0.04em; font-size: 1.35rem; }
    .muted { color: var(--text-muted); font-size: 0.88rem; }
    .btn { border: 0; border-radius: var(--radius-sm); padding: .55rem .95rem; font-weight: 600; background: var(--accent); color: #fff; cursor: pointer; }
  </style>
</head>
<body>
  <main>
    <h1>我的擴充工具</h1>
    <p class="muted" id="meta">載入中…</p>
    <button class="btn" type="button" id="go">開始</button>
  </main>
  <script>
    const qs = new URLSearchParams(location.search);
    const note = qs.get("note") || "";
    let settings = {};
    try { settings = JSON.parse(qs.get("settings") || "{}"); } catch {}
    document.getElementById("meta").textContent =
      note ? `筆記 ${note} · Albireus 嵌入` : "請從 Albireus 社群安裝後開啟";
    window.addEventListener("message", (e) => {
      if (e.data?.type === "albireus:settings") settings = e.data.settings || settings;
    });
  </script>
</body>
</html>
```

---

## 7. Validation rules the parser enforces

Failures that block install (fix these before asking the user to upload):

- Missing `schema: 1`, `kind`, `id`, `name`, `version`, `description`, `author`
- `id` contains `albireus` or invalid characters
- Extension without `pageType.type === "iframe"` or non-HTTPS `entry`
- Template without `pages[]`
- `minAppVersion` newer than host app → install rejected
- Safe mode ON in the store → blocks extensions / network / notes_read / notes_write installs

---

## 8. Publishing & distribution

1. **Sideload:** Community → 匯入檔案 (`.json` / `.zip`) or 從 GitHub 安裝 (`owner/repo`).
2. **Featured catalog:** maintainers merge into the app’s curated `catalog.json` (PR to the Albireus repo). Use `/community/submit` to normalize JSON first.
3. Ship `README.md` next to the manifest (shown in store detail when resolvable).
4. Prefer MIT/Apache-2.0 `license` field for trust.

---

## 9. Prompt snippet (user → AI)

Copy-paste:

```text
請依 Albireus /community/ai.md 幫我做一個社群擴充功能：
- 產出完整 albireus.json
- 產出可部署的靜態頁（HTML/CSS/JS 或 Next.js）
- 視覺必須使用文件中的 teal token、Outfit / Space Grotesk、繁體中文
- entry 必須是 https，並正確讀取 note / settings query 與 albireus:settings postMessage
功能需求：【在此描述你的工具】
```

---

## 10. Quick reference links (in-app)

| Path | Purpose |
|------|---------|
| `/community` | Store UI |
| `/community/docs` | Human developer docs |
| `/community/ai.md` | **This file** (AI-oriented) |
| `/community/submit` | Manifest validator |
| `/samples/albireus-extension-sample.json` | Extension sample |
| `/samples/albireus-template-sample.json` | Template sample |
| `/samples/notes-rpc-client.js` | Notes RPC helper for iframes |

---

## 11. Extension classes: page vs utility (host)

Community packages today only install **page extensions** (`kind: "extension"` + iframe). The host also ships a second class of assistive tools:

| Class | Product name | How it runs | Workspace page? |
|-------|--------------|-------------|-----------------|
| **擴充頁面** | Page extension | Sandboxed **iframe** (`pageType.type: "iframe"`) | Yes — full-screen like board/canvas, or embedded as a note frame |
| **一般擴充功能** | Utility tool | **Host React UI** (no remote JS) | No — assists notes / chrome (e.g. color pickers) |

### Built-in prototype: 色票工具 (`color-eyedropper`)

- Lives in the host (`frontend/src/lib/colorPick.ts`, `ColorEyedropperTools`, note floating「色票」).
- Uses the browser `EyeDropper` API when available; otherwise shows paste-Hex fallback (no empty iframe install required).
- Surfaces: `IconColorPicker` (page/folder icon color — sampled color syncs Hex **and** RGB inputs), note font/highlight color panels, optional floating panel on note pages.
- Floating chip: dismiss / hide remembers preference in `localStorage` (`albireus_utility_color_swatch_open`, `albireus_utility_color_swatch_hidden`).
- Metadata registry: `frontend/src/lib/hostUtilities.ts` (`kind: "utility"`). Community schema does **not** yet accept `kind: "tool"` / `"utility"` — do not put utilities in `albireus.json` until the parser supports them.

**AI guidance:** If the user asks for an on-screen eyedropper / color sampler, implement or extend the **host utility**, not a new iframe extension page.

---

## 12. Reference implementations (shipped in-repo)

Use these as production-quality patterns when building new packages. Paths are relative to the Albireus monorepo root.

### A) 背單字 — page extension (`builtin:vocab-srs`)

| Item | Location |
|------|----------|
| Manifest | `frontend/public/community-apps/vocab/albireus.json` |
| UI | `frontend/public/community-apps/vocab/` (`index.html`, `app.js`, `styles.css`, `db.js`) |
| Host id | Often registered as builtin `vocab-srs` |

**Patterns to copy**

- Read `?note=`, `?albireus=1`, `?settings=` / `s_*`, and `albireus:settings` postMessage.
- Soft login gate when `albireus=1`: offer「先用本機資料繼續」so the iframe is not blocked awkwardly; denser `.topbar` under `.albireus-embed`.
- Host `settings.theme` (`light` / `dark` / `auto`) wired into the page theme; never bake Gemini / Vertex API secrets into the repo — blank defaults + settings UI / host settings only.
- Teal tokens + Outfit / Space Grotesk; Traditional Chinese UI.

### B) 台股／美股看盤 — page extension (`builtin:yahoo-stocks`)

| Item | Location |
|------|----------|
| Manifest | `frontend/public/community-apps/stocks/albireus.json` |
| UI | `frontend/public/community-apps/stocks/` |
| API proxy | `frontend/src/app/api/stocks/{search,quote,chart}/route.ts` + `frontend/src/lib/stocks/yahoo.ts` |
| Host id | Often registered as builtin `yahoo-stocks` |

**Patterns to copy**

- Same-origin `/api/stocks/*` proxy (never call Yahoo from the browser with secrets; this proxy is public-data only).
- Loading skeleton, empty / error states, `/` keyboard focus on search.
- Multi-pane charts: sync **time scale** and **crosshair** across panes; watchlist soft-poll with LIVE indicator.
- Settings: `default_symbol`, `refresh_seconds`, `theme`.

### C) 色票工具 — host utility (not an iframe package)

| Item | Location |
|------|----------|
| Helpers | `frontend/src/lib/colorPick.ts` |
| UI | `ColorEyedropperTools.tsx`, `ColorSwatchUtility.tsx`, `IconColorPicker.tsx` |
| Registry | `frontend/src/lib/hostUtilities.ts` (`id: color-eyedropper`) |

**Patterns to copy**

- Host React only — no `albireus.json` until `kind: "utility"` exists.
- EyeDropper when supported; paste Hex when not; apply sample into both Hex and RGB fields in pickers.
- Floating chip dismiss / hide preference via `localStorage`.

### Prompt hint

```text
請參考 /community/ai.md §12 的三個實作（vocab iframe、stocks iframe + /api/stocks、色票 host utility），
依同樣架構與視覺 token 做【你的工具】。
```

---

*Generated for Albireus community packaging. Keep in sync with `frontend/src/lib/community/types.ts`, `extensionSettings.ts`, `hostUtilities.ts`, and `globals.css` theme tokens.*
