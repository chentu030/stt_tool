#!/usr/bin/env bash
# Run on the GCE VM (as root or with sudo). Installs Docker + Steel + cloudflared.
set -euo pipefail

STEEL_DIR="${STEEL_DIR:-/opt/albireus-steel}"
COMPOSE_FILE="${STEEL_DIR}/docker-compose.yml"

echo "==> Installing Docker if needed"
if ! command -v docker >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  if [[ ! -f /etc/apt/keyrings/docker.gpg ]]; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
  fi
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  systemctl enable --now docker
fi

echo "==> Ensuring Steel directory ${STEEL_DIR}"
mkdir -p "${STEEL_DIR}"
if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "Missing ${COMPOSE_FILE}. Copy docker-compose.yml first (deploy-gce.sh does this)."
  exit 1
fi

echo "==> Pulling and starting Steel"
cd "${STEEL_DIR}"
docker compose pull
docker compose up -d

echo "==> Waiting for health"
for i in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:3000/" >/dev/null 2>&1 \
    || curl -fsS "http://127.0.0.1:3000/documentation/" >/dev/null 2>&1; then
    echo "Steel is up on 127.0.0.1:3000"
    break
  fi
  if [[ "$i" -eq 40 ]]; then
    echo "WARN: health check timed out; check: docker compose -f ${COMPOSE_FILE} logs --tail=80"
  fi
  sleep 3
done

echo "==> Installing cloudflared if needed"
if ! command -v cloudflared >/dev/null 2>&1; then
  curl -fsSL -o /tmp/cloudflared.deb \
    https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
  dpkg -i /tmp/cloudflared.deb || apt-get install -fy
  rm -f /tmp/cloudflared.deb
fi

cat <<'EOF'

Next (HTTPS tunnel — free, no domain):
  cloudflared tunnel --url http://127.0.0.1:3000

Copy the https://*.trycloudflare.com URL, then set on Vercel / local:
  STEEL_BASE_URL=https://xxxx.trycloudflare.com

Tip: keep the tunnel running in a screen/tmux session, e.g.:
  tmux new -s tunnel 'cloudflared tunnel --url http://127.0.0.1:3000'

EOF
