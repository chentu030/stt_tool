#!/usr/bin/env bash
# Install Caddy HTTPS + Steel DOMAIN + idle auto-poweroff.
# On VM: sudo STEEL_PUBLIC_HOST=34.80.195.1.sslip.io ./setup-https.sh
set -euo pipefail

STEEL_DIR="${STEEL_DIR:-/opt/albireus-steel}"
STEEL_PUBLIC_HOST="${STEEL_PUBLIC_HOST:?Set STEEL_PUBLIC_HOST e.g. 34.80.195.1.sslip.io}"
IDLE_MINUTES="${IDLE_MINUTES:-20}"

mkdir -p "${STEEL_DIR}"
cd "${STEEL_DIR}"
echo "STEEL_PUBLIC_HOST=${STEEL_PUBLIC_HOST}" > "${STEEL_DIR}/.env"

if [[ ! -f "${STEEL_DIR}/docker-compose.yml" ]]; then
  echo "Missing ${STEEL_DIR}/docker-compose.yml"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker missing; run startup.sh first"
  exit 1
fi

echo "==> Steel with DOMAIN=${STEEL_PUBLIC_HOST}"
docker compose --env-file "${STEEL_DIR}/.env" pull
docker compose --env-file "${STEEL_DIR}/.env" up -d

echo "==> Caddy HTTPS"
if ! command -v caddy >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

cat > /etc/caddy/Caddyfile <<EOF
${STEEL_PUBLIC_HOST} {
  encode gzip
  reverse_proxy 127.0.0.1:3000 {
    header_up X-Forwarded-Proto https
    header_up X-Forwarded-Host {host}
    header_up Host {host}
  }
}
EOF
systemctl enable --now caddy
systemctl reload caddy || systemctl restart caddy

echo "==> Idle auto-poweroff (${IDLE_MINUTES} min, no live sessions)"
cat > /usr/local/bin/albireus-steel-idle-stop.sh <<EOF
#!/usr/bin/env bash
set -euo pipefail
IDLE_NEED=$((IDLE_MINUTES * 60))
UPTIME_SEC=\$(awk '{print int(\$1)}' /proc/uptime)
# Grace period after boot (docker/caddy warm-up)
if [[ "\${UPTIME_SEC}" -lt 900 ]]; then
  exit 0
fi
COUNT=\$(python3 -c '
import json,urllib.request
try:
  raw=urllib.request.urlopen("http://127.0.0.1:3000/v1/sessions", timeout=5).read().decode()
  data=json.loads(raw)
  if isinstance(data, list):
    print(len(data))
  elif isinstance(data, dict):
    sessions=data.get("sessions") or data.get("data") or data.get("items") or []
    print(len(sessions) if isinstance(sessions, list) else 0)
  else:
    print(0)
except Exception:
  print(-1)
')
MARKER=/var/run/albireus-steel-idle
if [[ "\${COUNT}" == "-1" ]]; then
  exit 0
fi
if [[ "\${COUNT}" -gt 0 ]]; then
  rm -f "\${MARKER}"
  exit 0
fi
NOW=\$(date +%s)
if [[ ! -f "\${MARKER}" ]]; then
  echo "\${NOW}" > "\${MARKER}"
  exit 0
fi
SINCE=\$(cat "\${MARKER}")
if [[ \$((NOW - SINCE)) -ge \${IDLE_NEED} ]]; then
  logger -t albireus-steel "idle — poweroff to save GCP credits"
  /sbin/poweroff
fi
EOF
chmod +x /usr/local/bin/albireus-steel-idle-stop.sh
echo "*/5 * * * * root /usr/local/bin/albireus-steel-idle-stop.sh" > /etc/cron.d/albireus-steel-idle

echo ""
echo "OK https://${STEEL_PUBLIC_HOST}"
echo "Vercel: STEEL_BASE_URL=https://${STEEL_PUBLIC_HOST}"
