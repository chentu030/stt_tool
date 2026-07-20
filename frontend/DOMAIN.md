# Albireus domain — albireus.com

## 1. Vercel：加上自訂網域

1. 打開 [Vercel Dashboard](https://vercel.com/dashboard) → 這個前端專案  
2. **Settings → Domains → Add**  
3. 加入：
   - `albireus.com`
   - `www.albireus.com`（建議，可轉到 apex）
4. 依 Vercel 顯示的指示完成驗證

## 2. DNS（在網域註冊商）

Vercel 通常會要求：

| Type | Name | Value |
|------|------|--------|
| **A** | `@` | `76.76.21.21` |
| **CNAME** | `www` | `cname.vercel-dns.com` |

（以 Vercel Domains 頁面當下顯示為準；若有專案專屬 CNAME 請用那個。）

DNS 生效後，Vercel 會自動簽發 HTTPS 憑證。

## 3. Firebase Auth 授權網域

Google 登入必須把網域加進 Firebase：

1. [Firebase Console](https://console.firebase.google.com/) → 專案 `stt-tool-f6e6d`（或你實際用的專案）  
2. **Authentication → Settings → Authorized domains**  
3. 新增：`albireus.com`、`www.albireus.com`

## 4. （可選）Cloud Run / API CORS

若後端有限制 CORS / 允許來源，把 `https://albireus.com` 與 `https://www.albireus.com` 加進去。

## 驗收

- 開 `https://albireus.com` 應看到 Albireus 前端  
- Google 登入可完成  
- 舊的 `*.vercel.app` 網址仍可保留或之後關掉
