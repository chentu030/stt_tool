# Self-host Steel Browser on GCE (GCP credits)

Project: **`project-b1f58e7a-b5d4-4f35-972`** (“My First Project”)  
Account: **`chenyulin478@gmail.com`**  
VM: **`albireus-steel`** (`e2-medium`, `asia-east1-b`)

> If `gcloud config get-value project` still shows another id (e.g. `fluid-script-480101-v1`) without permission, run:
> `gcloud config set project project-b1f58e7a-b5d4-4f35-972`

Albireus (Vercel) talks to this VM via **`STEEL_BASE_URL`** (HTTPS Cloudflare Tunnel). Port **3000/9223 stay on localhost** on the VM — not opened to the public internet.

## Prerequisites

- [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) (`gcloud`)
- Logged in:

```powershell
gcloud auth login
gcloud config set project project-b1f58e7a-b5d4-4f35-972
gcloud auth list
```

You should see `chenyulin478@gmail.com` and project `project-b1f58e7a-b5d4-4f35-972`.

- Bash (Git Bash / WSL) to run `deploy-gce.sh`

## 1. Deploy VM + Steel Docker

From repo root (Git Bash / WSL):

```bash
cd infra/steel-browser
chmod +x deploy-gce.sh startup.sh
./deploy-gce.sh
```

This will:

1. Enable `compute.googleapis.com`
2. Create (or start) `albireus-steel`
3. Upload `docker-compose.yml` + `startup.sh`
4. Install Docker, pull `ghcr.io/steel-dev/steel-browser:latest`, bind `127.0.0.1:3000`
5. Install `cloudflared`

Health check: `GET http://127.0.0.1:3000/` → `{"message":"Steel Browser API","ui":"/ui"}`.  
Sessions API: `POST /v1/sessions` (Steel SDK `baseURL` = tunnel origin, no `/v1` suffix).

## 2. Cloudflare Tunnel (free HTTPS, no domain)

```powershell
gcloud compute ssh albireus-steel --zone=asia-east1-b --project=project-b1f58e7a-b5d4-4f35-972
```

On the VM:

```bash
sudo apt-get update -y && sudo apt-get install -y tmux
tmux new -s tunnel 'cloudflared tunnel --url http://127.0.0.1:3000'
```

Copy the printed URL, e.g. `https://random-words.trycloudflare.com`.

Detach tmux: `Ctrl-b` then `d`. Reattach: `tmux attach -t tunnel`.

**Note:** Quick tunnels get a **new URL after restart**. After VM reboot / tunnel restart, update `STEEL_BASE_URL` again (or later switch to a named Cloudflare tunnel + fixed hostname).

## 3. Point Albireus at the tunnel

**Vercel** → Project → Settings → Environment Variables:

| Name | Value |
|------|--------|
| `STEEL_BASE_URL` | `https://….trycloudflare.com` |

Do **not** set `STEEL_API_KEY` for self-host (optional). Redeploy the frontend.

**Local Next:**

```powershell
# frontend/.env.local
STEEL_BASE_URL=https://….trycloudflare.com
```

Restart `npm run dev`.

## 4. Verify

1. `GET /api/web/browser/session` → `{ "configured": true }`
2. In Albireus, open a web note → `https://gemini.google.com/` → virtual browser canvas loads
3. On VM: `curl -fsS http://127.0.0.1:3000/` → Steel Browser API JSON
4. Interactive viewer path: `/v1/sessions/debug?interactive=true&showControls=true` (after URL rewrite from `0.0.0.0`)

## Cost tips (credits)

```powershell
# Stop when unused
gcloud compute instances stop albireus-steel --zone=asia-east1-b --project=project-b1f58e7a-b5d4-4f35-972

# Start again
gcloud compute instances start albireus-steel --zone=asia-east1-b --project=project-b1f58e7a-b5d4-4f35-972
# Then SSH and re-run the cloudflared tmux command; update STEEL_BASE_URL if URL changed
```

`e2-medium` is billed while **RUNNING**; stopped disk still costs a little.

## Security

- Firewall tag `albireus-steel`: SSH only (script creates `allow-ssh-albireus-steel`)
- Treat the trycloudflare URL as a **secret** (anyone with it can hit Steel)
- Albireus session create/nav/clip still require Firebase login
- Never open `9223` publicly

## Files

| File | Role |
|------|------|
| `docker-compose.yml` | Steel single image on localhost:3000 |
| `startup.sh` | Docker + compose + cloudflared on the VM |
| `deploy-gce.sh` | gcloud create/upload/run |
| [`../../frontend/VIRTUAL_BROWSER.md`](../../frontend/VIRTUAL_BROWSER.md) | App-side env overview |
