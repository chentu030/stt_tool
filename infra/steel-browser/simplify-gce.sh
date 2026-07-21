#!/usr/bin/env bash
# One-shot: static IP, HTTPS firewall, larger VM, service account for auto-start.
# Run from a machine with gcloud (Git Bash): ./simplify-gce.sh
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-project-b1f58e7a-b5d4-4f35-972}"
ZONE="${ZONE:-asia-east1-b}"
REGION="${REGION:-asia-east1}"
INSTANCE="${INSTANCE:-albireus-steel}"
MACHINE="${MACHINE:-e2-standard-2}"
ADDRESS_NAME="${ADDRESS_NAME:-albireus-steel-ip}"
SA_NAME="${SA_NAME:-albireus-steel-starter}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
KEY_OUT="${KEY_OUT:-$ROOT/../../.secrets/gcp-steel-starter.json}"

gcloud config set project "${PROJECT_ID}"
gcloud services enable compute.googleapis.com iam.googleapis.com --project="${PROJECT_ID}"

echo "==> Reserve static IP (keeps STEEL_BASE_URL stable across stop/start)"
if ! gcloud compute addresses describe "${ADDRESS_NAME}" --region="${REGION}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud compute addresses create "${ADDRESS_NAME}" --region="${REGION}" --project="${PROJECT_ID}"
fi
STATIC_IP="$(gcloud compute addresses describe "${ADDRESS_NAME}" --region="${REGION}" --project="${PROJECT_ID}" --format='get(address)')"
echo "Static IP: ${STATIC_IP}"
PUBLIC_HOST="${STATIC_IP}.sslip.io"
echo "Public host: ${PUBLIC_HOST}"

echo "==> Ensure instance running"
STATUS="$(gcloud compute instances describe "${INSTANCE}" --zone="${ZONE}" --project="${PROJECT_ID}" --format='get(status)' 2>/dev/null || true)"
if [[ -z "${STATUS}" ]]; then
  echo "Instance missing — run deploy-gce.sh first"
  exit 1
fi
if [[ "${STATUS}" != "RUNNING" ]]; then
  gcloud compute instances start "${INSTANCE}" --zone="${ZONE}" --project="${PROJECT_ID}"
  sleep 20
fi

echo "==> Attach static IP"
NIC="$(gcloud compute instances describe "${INSTANCE}" --zone="${ZONE}" --project="${PROJECT_ID}" --format='get(networkInterfaces[0].name)')"
ACCESS="$(gcloud compute instances describe "${INSTANCE}" --zone="${ZONE}" --project="${PROJECT_ID}" --format='get(networkInterfaces[0].accessConfigs[0].name)')"
gcloud compute instances delete-access-config "${INSTANCE}" \
  --zone="${ZONE}" --project="${PROJECT_ID}" \
  --access-config-name="${ACCESS}" >/dev/null 2>&1 || true
gcloud compute instances add-access-config "${INSTANCE}" \
  --zone="${ZONE}" --project="${PROJECT_ID}" \
  --access-config-name="external-nat" \
  --address="${STATIC_IP}"

echo "==> Resize to ${MACHINE} (needs stop)"
gcloud compute instances stop "${INSTANCE}" --zone="${ZONE}" --project="${PROJECT_ID}"
gcloud compute instances set-machine-type "${INSTANCE}" \
  --zone="${ZONE}" --project="${PROJECT_ID}" --machine-type="${MACHINE}"
gcloud compute instances start "${INSTANCE}" --zone="${ZONE}" --project="${PROJECT_ID}"
sleep 25

echo "==> Firewall HTTP/HTTPS (Caddy)"
if ! gcloud compute firewall-rules describe allow-https-albireus-steel --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud compute firewall-rules create allow-https-albireus-steel \
    --project="${PROJECT_ID}" \
    --allow=tcp:80,tcp:443 \
    --target-tags=albireus-steel \
    --description="Caddy HTTPS for Albireus Steel"
fi

echo "==> Upload compose + setup-https"
gcloud compute scp \
  "${ROOT}/docker-compose.yml" "${ROOT}/setup-https.sh" "${ROOT}/startup.sh" \
  "${INSTANCE}:" --zone="${ZONE}" --project="${PROJECT_ID}" <<<'y' || \
gcloud compute scp \
  "${ROOT}/docker-compose.yml" "${ROOT}/setup-https.sh" "${ROOT}/startup.sh" \
  "${INSTANCE}:" --zone="${ZONE}" --project="${PROJECT_ID}"

gcloud compute ssh "${INSTANCE}" --zone="${ZONE}" --project="${PROJECT_ID}" --command="
  sudo mkdir -p /opt/albireus-steel &&
  sudo mv -f \$HOME/docker-compose.yml \$HOME/setup-https.sh \$HOME/startup.sh /opt/albireus-steel/ &&
  sudo chmod +x /opt/albireus-steel/*.sh &&
  sudo STEEL_DIR=/opt/albireus-steel /opt/albireus-steel/startup.sh &&
  sudo STEEL_DIR=/opt/albireus-steel STEEL_PUBLIC_HOST=${PUBLIC_HOST} /opt/albireus-steel/setup-https.sh
"

echo "==> Service account for Vercel auto-start"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
if ! gcloud iam service-accounts describe "${SA_EMAIL}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${SA_NAME}" \
    --project="${PROJECT_ID}" \
    --display-name="Albireus Steel VM starter"
fi
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${SA_EMAIL}" \
  --role="roles/compute.instanceAdmin.v1" \
  --condition=None >/dev/null

mkdir -p "$(dirname "${KEY_OUT}")"
if [[ ! -f "${KEY_OUT}" ]]; then
  gcloud iam service-accounts keys create "${KEY_OUT}" \
    --iam-account="${SA_EMAIL}" \
    --project="${PROJECT_ID}"
fi

cat <<EOF

======= DONE — set these on Vercel =======
STEEL_BASE_URL=https://${PUBLIC_HOST}
GCP_PROJECT_ID=${PROJECT_ID}
GCP_ZONE=${ZONE}
GCP_STEEL_INSTANCE=${INSTANCE}
GCP_SERVICE_ACCOUNT_JSON=<paste entire JSON from ${KEY_OUT}>

Idle: VM powers off after ~20 min with no live browser sessions.
Use: Albireus auto-starts the VM when someone opens 虛擬瀏覽器.
==========================================
EOF
