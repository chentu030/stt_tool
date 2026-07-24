# Albireus Frontend — Vercel Environment Variables

## Required (existing Firebase / API)

See your current Vercel project settings for Firebase `NEXT_PUBLIC_*` and `NEXT_PUBLIC_API_BASE`.

## Vertex AI (Gemini via aiplatform — required for note AI)

| Name | Example | Notes |
|------|---------|--------|
| `VERTEX_API_KEYS` | `AQ.xxx,AQ.yyy,AQ.zzz` | 3 組金鑰，逗號或換行分隔，伺服端輪詢 |
| `VERTEX_MODEL` | `gemini-3-flash-preview` | 預設即此模型 |
| `VERTEX_LOCATION` | `global` | 預設 `global` |
| `VERTEX_PROJECT_ID` | `your-gcp-project` | 可選；有設會走 project-scoped URL |

**規則（平台預設）：** 只呼叫 `aiplatform.googleapis.com`，不要把共用金鑰設成 Gemini Developer API（`generativelanguage.googleapis.com`）。使用者若在背單字擴充「自備 Gemini 金鑰」，才會改走 generativeai。

## Semantic note retrieval（知識庫語意搜尋）

Embeddings + Firestore `findNearest` run on **Cloud Run** (`NEXT_PUBLIC_API_BASE`):

| Name (Cloud Run) | Example | Notes |
|------|---------|--------|
| `VERTEX_API_KEYS` | same as Vercel | Required for `text-multilingual-embedding-002` |
| `VERTEX_EMBEDDING_MODEL` | `text-multilingual-embedding-002` | 768-d；CJK-friendly |
| `VERTEX_PROJECT_ID` / `VERTEX_LOCATION` | optional | Prefer regional `us-central1` if project-scoped predict URL |

**Deploy vector index** (once):

```bash
firebase deploy --only firestore:indexes,firestore:rules
```

Index: collection group `note_embeddings`, field `embedding`, dimension **768**, flat. Build can take minutes; search returns 503 until ready.

**Backfill existing notes:** open Deep Research or AI rail once (auto backfills a slice), or call `POST /api/notes/embeddings/upsert` with note batches. Creates/updates debounce-index via `scheduleNoteEmbedding`.

**Fallback:** If Cloud Run embedding routes are not yet redeployed, the client uses Next.js `/api/ai/embeddings/embed` + local cosine over `users/{uid}/note_embeddings` (same 768-d vectors). Redeploy Cloud Run with `note_embeddings.py` + set `VERTEX_API_KEYS` to enable Admin `findNearest`.

## 背單字擴充（選填）

| Name | Example | Notes |
|------|---------|--------|
| `NEXT_PUBLIC_VOCAB_LISTEN_BACKEND` | 同 `NEXT_PUBLIC_API_BASE` | 聽力 Whisper／詞典 Cloud Run；未設則用 `NEXT_PUBLIC_API_BASE` |
| （沿用）`VERTEX_API_KEYS` | — | 免費額度內的 AI／TTS 走此共用 Vertex 金鑰 |
| （沿用）`NEXT_PUBLIC_API_BASE` | `https://….run.app/api` | Google STT（自備金鑰時）與聽力後端 |

免費點數（每帳號）：整理 50 字／5 段影片／30 次 AI 語音；`lcy101120@gmail.com` 不限。

在 Vercel → Project → Settings → Environment Variables 新增後重新 Deploy。

本地可放在 `frontend/.env.local`（已 gitignore），**不要 commit 金鑰**。
