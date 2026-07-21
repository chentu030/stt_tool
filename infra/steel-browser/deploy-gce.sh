#!/usr/bin/env bash
# Create / update GCE VM and push Steel compose + startup.
# Requires: gcloud auth as chenyulin478@gmail.com
# Default project is the account's "My First Project" (not fluid-script-*).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ID="${PROJECT_ID:-project-b1f58e7a-b5d4-4f35-972}"
ZONE="${ZONE:-asia-east1-b}"
INSTANCE="${INSTANCE:-albireus-steel}"
MACHINE="${MACHINE:-e2-medium}"
IMAGE_FAMILY="${IMAGE_FAMILY:-ubuntu-2404-lts-amd64}"
IMAGE_PROJECT="${IMAGE_PROJECT:-ubuntu-os-cloud}"
STEEL_REMOTE_DIR="/opt/albireus-steel"

echo "==> Project ${PROJECT_ID}"
gcloud config set project "${PROJECT_ID}"

echo "==> Enable Compute API"
gcloud services enable compute.googleapis.com --project="${PROJECT_ID}"

if gcloud compute instances describe "${INSTANCE}" --zone="${ZONE}" --project="${PROJECT_ID}" >/dev/null 2>&1; then
  echo "==> Instance ${INSTANCE} already exists"
  STATUS="$(gcloud compute instances describe "${INSTANCE}" --zone="${ZONE}" --project="${PROJECT_ID}" --format='get(status)')"
  if [[ "${STATUS}" != "RUNNING" ]]; then
    echo "==> Starting stopped instance"
    gcloud compute instances start "${INSTANCE}" --zone="${ZONE}" --project="${PROJECT_ID}"
  fi
else
  echo "==> Creating ${INSTANCE} (${MACHINE}) in ${ZONE}"
  gcloud compute instances create "${INSTANCE}" \
    --project="${PROJECT_ID}" \
    --zone="${ZONE}" \
    --machine-type="${MACHINE}" \
    --image-family="${IMAGE_FAMILY}" \
    --image-project="${IMAGE_PROJECT}" \
    --boot-disk-size=40GB \
    --boot-disk-type=pd-balanced \
    --tags=albireus-steel \
    --metadata=enable-oslogin=TRUE \
    --scopes=cloud-platform
fi

echo "==> Firewall: allow SSH only (no public 3000/9223)"
if ! gcloud compute firewall-rules describe allow-ssh-albireus-steel --project="${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud compute firewall-rules create allow-ssh-albireus-steel \
    --project="${PROJECT_ID}" \
    --allow=tcp:22 \
    --target-tags=albireus-steel \
    --description="SSH to Albireus Steel VM"
fi

echo "==> Uploading compose + startup to VM home, then installing"
# Windows pscp rejects remote "~/"; use bare filenames in the user's home.
yes | gcloud compute scp \
  "${ROOT}/docker-compose.yml" "${ROOT}/startup.sh" \
  "${INSTANCE}:" \
  --zone="${ZONE}" \
  --project="${PROJECT_ID}" \
  || gcloud compute scp \
    "${ROOT}/docker-compose.yml" "${ROOT}/startup.sh" \
    "${INSTANCE}:" \
    --zone="${ZONE}" \
    --project="${PROJECT_ID}"

echo "==> Running startup on VM"
yes | gcloud compute ssh "${INSTANCE}" \
  --zone="${ZONE}" \
  --project="${PROJECT_ID}" \
  --command="sudo mkdir -p ${STEEL_REMOTE_DIR} && \
    sudo mv -f \$HOME/docker-compose.yml \$HOME/startup.sh ${STEEL_REMOTE_DIR}/ && \
    sudo chmod +x ${STEEL_REMOTE_DIR}/startup.sh && \
    sudo STEEL_DIR=${STEEL_REMOTE_DIR} ${STEEL_REMOTE_DIR}/startup.sh" \
  || gcloud compute ssh "${INSTANCE}" \
    --zone="${ZONE}" \
    --project="${PROJECT_ID}" \
    --command="sudo mkdir -p ${STEEL_REMOTE_DIR} && sudo mv -f \$HOME/docker-compose.yml \$HOME/startup.sh ${STEEL_REMOTE_DIR}/ && sudo chmod +x ${STEEL_REMOTE_DIR}/startup.sh && sudo STEEL_DIR=${STEEL_REMOTE_DIR} ${STEEL_REMOTE_DIR}/startup.sh"

echo ""
echo "Done. Next:"
echo "  gcloud compute ssh ${INSTANCE} --zone=${ZONE} --project=${PROJECT_ID}"
echo "  sudo apt-get install -y tmux   # if needed"
echo "  tmux new -s tunnel 'cloudflared tunnel --url http://127.0.0.1:3000'"
echo "Then set STEEL_BASE_URL on Vercel to the https://*.trycloudflare.com URL."
echo ""
echo "Stop to save credits: gcloud compute instances stop ${INSTANCE} --zone=${ZONE} --project=${PROJECT_ID}"
