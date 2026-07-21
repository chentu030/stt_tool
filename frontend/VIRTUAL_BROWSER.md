# Virtual browser (Steel)

Albireus can open **any** website (including Google / Gemini login) inside notes via a real Chromium session.

**Preferred:** self-host open-source [Steel Browser](https://github.com/steel-dev/steel-browser) on **GCE** (GCP credits).  
**Fallback:** Steel Cloud API key.

## Setup (self-host — recommended)

See full steps: [`../infra/steel-browser/README.md`](../infra/steel-browser/README.md)

1. Deploy Steel on GCE (`project-b1f58e7a-b5d4-4f35-972`) with the scripts in `infra/steel-browser/`.
2. Expose HTTPS via Cloudflare Tunnel (free; no domain required).
3. Set on Vercel / local Next server:

```bash
STEEL_BASE_URL=https://xxxx.trycloudflare.com
```

`STEEL_API_KEY` is optional for self-host.

## Setup (Steel Cloud — optional)

```bash
STEEL_API_KEY=your_steel_cloud_api_key
# leave STEEL_BASE_URL empty
```

Without either env, the UI falls back to system browser for Google sites and shows a clear “not configured” message.

## Behaviour

| Site type | Mode |
|-----------|------|
| Frameable public pages | Direct iframe |
| Frame-blocked but proxyable | HTML embed-proxy |
| Google / Gemini / hard login walls | Steel virtual browser (`?interactive=true&showControls=true`) |

- One live session per signed-in user (new create replaces the previous).
- Session `timeout` 15m; client idle release ~10m.
- **擷取** copies bookmark + selection + screenshot into the open note (`cadence-insert-md`).
- Self-host: localhost URLs from Steel are rewritten to `STEEL_BASE_URL` for the iframe / CDP.

## Security notes

- `STEEL_API_KEY` / tunnel URL stay server-side (or treat tunnel URL as a secret).
- Session APIs require a Firebase ID token (`Authorization: Bearer …`).
- Do not expose GCE port 9223 to the public internet; only SSH + Cloudflare Tunnel to port 3000.
