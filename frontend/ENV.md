# Cadence Frontend — Vercel Environment Variables

## Required (existing Firebase / API)

See your current Vercel project settings for Firebase `NEXT_PUBLIC_*` and `NEXT_PUBLIC_API_BASE`.

## Vertex AI (Gemini via aiplatform — required for note AI)

| Name | Example | Notes |
|------|---------|--------|
| `VERTEX_API_KEYS` | `AQ.xxx,AQ.yyy,AQ.zzz` | 3 組金鑰，逗號或換行分隔，伺服端輪詢 |
| `VERTEX_MODEL` | `gemini-3-flash-preview` | 預設即此模型 |
| `VERTEX_LOCATION` | `global` | 預設 `global` |
| `VERTEX_PROJECT_ID` | `your-gcp-project` | 可選；有設會走 project-scoped URL |

**規則：** 只呼叫 `aiplatform.googleapis.com`，不要設 Gemini Developer API（`generativelanguage.googleapis.com`）。

在 Vercel → Project → Settings → Environment Variables 新增後重新 Deploy。

本地可放在 `frontend/.env.local`（已 gitignore），**不要 commit 金鑰**。
