# AI 語音轉錄工具 (Whisper Transcription Web App)

這是一個全端網頁應用程式，能夠將使用者上傳的音訊/影片檔案或指定的 YouTube 網址，透過 OpenAI 的 `faster-whisper` 模型轉換為帶有時間戳記的文字逐字稿。

## 架構說明

* **前端 (`/frontend`)**: 使用 Next.js (App Router) 開發，提供現代化且具備玻璃擬物化 (Glassmorphism) 風格的使用者介面。部署建議使用 Vercel。
* **後端 (`/backend`)**: 使用 Python FastAPI 開發，負責處理檔案上傳、透過 `yt-dlp` 下載 YouTube 音訊，並執行 Whisper 模型轉錄。部署建議使用 Google Cloud Run。

## 本地端執行方式

### 1. 啟動後端 (FastAPI)
1. 進入 `backend` 資料夾：`cd backend`
2. 啟動虛擬環境：`.\.venv\Scripts\activate` (Windows)
3. 安裝相依套件：`pip install -r requirements.txt`
   > **注意**：您需要在系統中安裝 `ffmpeg` 才能讓 `yt-dlp` 與 `faster-whisper` 正常運作。
4. 啟動伺服器：`uvicorn main:app --host 0.0.0.0 --port 8000 --reload`
   後端將會運行在 `http://localhost:8000`。

### 2. 啟動前端 (Next.js)
1. 進入 `frontend` 資料夾：`cd frontend`
2. 安裝相依套件：`npm install`
3. 啟動開發伺服器：`npm run dev`
   前端將會運行在 `http://localhost:3000`。
   > **注意**：如需修改串接後端的網址，請在 `frontend/src/app/page.tsx` 中修改 `API_BASE` 變數。

## 部署指南

### 前端部署 (Vercel)
1. 將整個專案上傳至您的 GitHub 儲存庫。
2. 登入 Vercel 並匯入該儲存庫。
3. 將 "Framework Preset" 設為 Next.js，並將 "Root Directory" 設為 `frontend`。
4. 點擊 Deploy 即可完成部署。

### 後端部署 (Google Cloud Run)
由於 `faster-whisper` 需要 Python 環境及 `ffmpeg`，請使用 Docker 來部署。
1. 確保已安裝 Google Cloud SDK 並登入。
2. 在 `backend` 目錄下執行建置與推送：
   ```bash
   gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/whisper-api
   ```
3. 部署至 Cloud Run (指定較大的記憶體，建議至少 2GB 或 4GB)：
   ```bash
   gcloud run deploy whisper-api \
       --image gcr.io/YOUR_PROJECT_ID/whisper-api \
       --platform managed \
       --region asia-east1 \
       --allow-unauthenticated \
       --memory 4Gi \
       --cpu 2
   ```
4. 部署完成後，您會獲得一個 GCP 提供的 HTTPS URL。請將前端程式碼 (`frontend/src/app/page.tsx`) 中的 `API_BASE` 更新為此網址。
