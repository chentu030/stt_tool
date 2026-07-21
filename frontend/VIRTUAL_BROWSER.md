# Virtual browser

Preferred: **self-host Steel on GCE** (GCP credits). See [`../infra/steel-browser/README.md`](../infra/steel-browser/README.md).

## Vercel env (once)

```bash
STEEL_BASE_URL=https://104.199.186.106.sslip.io
GCP_PROJECT_ID=project-b1f58e7a-b5d4-4f35-972
GCP_ZONE=asia-east1-b
GCP_STEEL_INSTANCE=albireus-steel
GCP_SERVICE_ACCOUNT_JSON=...json...
```

- Auto-start VM when a signed-in user opens 虛擬瀏覽器
- Auto-poweroff after ~20 minutes with no live sessions
- Concurrent soft cap: `STEEL_MAX_SESSIONS` (default 4)

Optional fallback: `STEEL_API_KEY` for Steel Cloud (leave `STEEL_BASE_URL` empty).
