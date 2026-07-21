# Virtual browser (temporarily disabled)

The in-note Steel / GCE virtual browser is **off by default**.

Google / Gemini open in the **system browser** instead.

## Re-enable later

1. Start the GCE VM (`albireus-steel`) if needed.
2. On Vercel set:

```bash
VIRTUAL_BROWSER_ENABLED=true
STEEL_BASE_URL=https://104.199.186.106.sslip.io
GCP_PROJECT_ID=project-b1f58e7a-b5d4-4f35-972
GCP_ZONE=asia-east1-b
GCP_STEEL_INSTANCE=albireus-steel
GCP_SERVICE_ACCOUNT_JSON=...full json key body...
```

3. Redeploy.

See [`../infra/steel-browser/README.md`](../infra/steel-browser/README.md).
