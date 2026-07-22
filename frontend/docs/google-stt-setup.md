# Google Speech-to-Text（動態批次／經濟模式）

產品預設走 **V2 Dynamic Batch**（約 **$0.003／分鐘**）。若 Cloud Run 尚未部署 `/api/stt/google`（會回 `404 Not Found`），前端會自動改走既有 **Whisper**（`/api/beidanzi/upload`），避免錄音全部失敗。

## 為什麼會看到「Not Found」？

前端已上線新功能，但 **Cloud Run 後端還是舊映像** 時，呼叫 `POST /api/stt/google` 會得到 FastAPI 的 `{"detail":"Not Found"}`。

請重新部署後端，例如：

```bash
cd backend
gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/whisper-api --project=YOUR_PROJECT_ID
gcloud run deploy whisper-api \
  --image gcr.io/YOUR_PROJECT_ID/whisper-api \
  --region asia-east1 \
  --project=YOUR_PROJECT_ID
```

並設定 `GOOGLE_STT_PROJECT_ID` 為專案 **ID**（例如 `stt-tool-f6e6d`），不要只填 OAuth 的數字 project number。

## 預設路徑：`POST /api/stt/google`

用於筆記切段辨識、快速錄音。流程：音訊上傳 GCS → `BatchRecognize` + `DYNAMIC_BATCHING` → 回傳文字。

### 環境變數

| 變數 | 說明 |
|------|------|
| `GOOGLE_STT_PROJECT_ID` / `GOOGLE_CLOUD_PROJECT` | 專案 **ID**（必填；勿只填數字） |
| `GOOGLE_STT_LOCATION` | 預設 `asia-southeast1` |
| `GOOGLE_STT_MODEL` | 預設 `chirp_2` |
| `GOOGLE_STT_MODE` | 預設 `batch` |
| `GOOGLE_STT_BATCH_TIMEOUT` | 預設 `240` |
| `GOOGLE_STT_ENABLE_STREAM` | 預設關閉（串流約 $0.016／分鐘） |

服務帳號需 `roles/speech.client`，並能讀寫 Storage（`stt-batch/`）。Speech 服務代理也要能讀該 bucket。

### 健康檢查

`GET /api/stt/google/health` — 若回 404，代表後端尚未部署此路由。
