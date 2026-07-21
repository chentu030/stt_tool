# Albireus experimental embed proxy (Cloudflare Worker)

Optional edge alternative to the Next.js route `/api/web/embed-proxy`.

## Deploy

```bash
npx wrangler deploy
```

Point the app at the worker (optional; default uses same-origin Next route):

```
NEXT_PUBLIC_EMBED_PROXY_BASE=https://albireus-embed-proxy.<you>.workers.dev
```

## Rules

- Allowlist only (TPEx / TWSE public pages, example.com, …)
- Never proxy Google OAuth / bank login hosts
- Strips `X-Frame-Options` / CSP so the page can load in an iframe
- Login flows will still break — use Albireus「獨立視窗」
