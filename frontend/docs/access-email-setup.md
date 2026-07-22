# 寄送核准信：support@albireus.com

建議組合：**Cloudflare（網域 DNS + 收信）+ Resend（寄信）**。

## 為什麼不是只用 Cloudflare？

| 服務 | 能做什麼 |
|------|----------|
| Cloudflare Email Routing | 把 `support@albireus.com` **轉寄到你的 Gmail**（收信） |
| Resend / SES / SendGrid | 用程式 **自動寄出** 核准通知信 |

Cloudflare 本身不適合當「應用程式 SMTP 寄信」主方案；內測核准自動寄信請用 Resend。

## 設定步驟

1. 到 [Resend](https://resend.com) 註冊，新增網域 `albireus.com`。
2. 依 Resend 指示，在 **Cloudflare DNS** 加上 SPF / DKIM（以及建議的 DMARC）紀錄。
3. 在 Resend 建立 API Key。
4. 在部署環境（Vercel / Cloudflare Pages 等）設定環境變數：
   ```
   RESEND_API_KEY=re_xxxxxxxx
   ```
5. 重新部署後，到 `/admin/access` 點「核准並寄信」。

若尚未設定 `RESEND_API_KEY`，按鈕會改為「複製信件內容」，你可手動用 Gmail 從 support@ 寄出。

## 收信（可選）

在 Cloudflare → Email Routing 將 `support@albireus.com` 轉到你的個人信箱，方便收到使用者回報。
