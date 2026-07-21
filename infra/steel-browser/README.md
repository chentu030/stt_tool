# 虛擬瀏覽器（簡單版）

用 GCP 抵免額跑一台 Steel Chromium。**有人開虛擬瀏覽器就自動開機；約 20 分鐘沒人用就自動關機。**

## 你平常要做的事

1. 在 **Vercel → Environment Variables** 設好下面變數（設一次即可）
2. Redeploy
3. 在 Albireus 開網頁筆記 → 虛擬瀏覽器

不用再管 Cloudflare Tunnel、不用每次改網址。

## Vercel 環境變數

| 變數 | 值 |
|------|-----|
| `STEEL_BASE_URL` | `https://104.199.186.106.sslip.io` |
| `GCP_PROJECT_ID` | `project-b1f58e7a-b5d4-4f35-972` |
| `GCP_ZONE` | `asia-east1-b` |
| `GCP_STEEL_INSTANCE` | `albireus-steel` |
| `GCP_SERVICE_ACCOUNT_JSON` | 整個 service account JSON（本機 `.secrets/gcp-steel-starter.json`，**勿 commit**） |

可選：`STEEL_MAX_SESSIONS=4`（同時虛擬瀏覽器人數上限，避免當機）

## 行為說明

- **順暢**：固定 HTTPS（靜態 IP + Caddy + sslip.io）；Steel `DOMAIN` 正確，避免「Session not connected」
- **省錢**：VM 閒置自動 `poweroff`；下次有人用時 Albireus 會 `instances.start`（首次約 1–2 分鐘）
- **多人**：同時最多約 4 個虛擬瀏覽器 session（可調）；一般網站頁面不受影響
- 機型：`e2-standard-2`（8GB），吃 GCP 抵免額

## 重裝／維護（很少需要）

```bash
cd infra/steel-browser
./simplify-gce.sh
```

手動 SSH：

```powershell
gcloud compute ssh albireus-steel --zone=asia-east1-b --project=project-b1f58e7a-b5d4-4f35-972
```

## 「Session not connected」是什麼？

Steel 畫面連不到遠端 Chromium（以前是 `DOMAIN` 指到 `0.0.0.0`）。現已用公開 host 修正；若仍出現，多半是 VM 剛開機尚未就緒，等「正在啟動」結束後按 ↻。
