# Google Speech-to-Text

產品有兩種 Google STT 路徑：

| 模式 | 用途 | 約略費用 | 預設 |
|------|------|----------|------|
| **動態批次** `POST /api/stt/google` | 切段後辨識（即時錄音預設、快速錄音） | ~$0.003／分鐘 | **開** |
| **即時串流** `WS /api/stt/google/stream` | 邊講邊出字 | ~$0.016／分鐘 | 伺服器允許，**使用者預設關**；目前先提供 **5 小時（300 分鐘）** 額度，用完自動改切段且不中斷錄音 |

前端設定「即時串流轉錄」或錄音面板切換「即時串流」後才會走 WebSocket。到時長上限會自動結束。

若 Cloud Run 尚未部署 `/api/stt/google`，會回 `404 Not Found`，需重新部署後端後才能使用。

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

## 批次路徑：`POST /api/stt/google`

用於筆記切段辨識、快速錄音。流程：音訊上傳 GCS → `BatchRecognize` + `DYNAMIC_BATCHING` → 回傳文字。

### 環境變數

| 變數 | 說明 |
|------|------|
| `GOOGLE_STT_PROJECT_ID` / `GOOGLE_CLOUD_PROJECT` | 專案 **ID**（必填；勿只填數字） |
| `GOOGLE_STT_LOCATION` | 預設 `asia-southeast1` |
| `GOOGLE_STT_MODEL` | 預設 `chirp_2` |
| `GOOGLE_STT_MODE` | 預設 `batch` |
| `GOOGLE_STT_BATCH_TIMEOUT` | 預設 `240` |
| `GOOGLE_STT_ENABLE_STREAM` | 預設 `1`（允許串流）；設 `0` 可強制關閉 |
| `GOOGLE_STT_STREAM_MAX_SECS` | 單次串流連線上限秒數，預設 `18000`（5 小時） |

服務帳號需 `roles/speech.client`，並能讀寫 Storage（`stt-batch/`）。Speech 服務代理也要能讀該 bucket。

### 健康檢查

`GET /api/stt/google/health` — 若回 404，代表後端尚未部署此路由。
