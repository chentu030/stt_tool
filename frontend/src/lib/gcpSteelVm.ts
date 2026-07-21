/**
 * Start/stop the Albireus Steel GCE VM so browser hours only burn while in use.
 * Uses a GCP service account JSON in env (never commit the key).
 */
import { GoogleAuth } from "google-auth-library";

const PROJECT = (process.env.GCP_PROJECT_ID || "").trim();
const ZONE = (process.env.GCP_ZONE || "asia-east1-b").trim();
const INSTANCE = (process.env.GCP_STEEL_INSTANCE || "albireus-steel").trim();
const SA_JSON = (process.env.GCP_SERVICE_ACCOUNT_JSON || "").trim();

export function isGcpVmControlConfigured(): boolean {
  return Boolean(PROJECT && ZONE && INSTANCE && SA_JSON);
}

function computeUrl(path: string) {
  return `https://compute.googleapis.com/compute/v1/projects/${PROJECT}/zones/${ZONE}/instances/${INSTANCE}${path}`;
}

async function getAccessToken(): Promise<string> {
  const credentials = JSON.parse(SA_JSON) as Record<string, unknown>;
  const auth = new GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/compute"],
  });
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  if (!token.token) throw new Error("無法取得 GCP access token");
  return token.token;
}

export async function getSteelVmStatus(): Promise<"RUNNING" | "TERMINATED" | "STOPPING" | "STAGING" | string> {
  if (!isGcpVmControlConfigured()) return "UNKNOWN";
  const token = await getAccessToken();
  const res = await fetch(computeUrl(""), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`讀取 VM 狀態失敗: ${res.status} ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as { status?: string };
  return data.status || "UNKNOWN";
}

export async function startSteelVm(): Promise<void> {
  if (!isGcpVmControlConfigured()) return;
  const status = await getSteelVmStatus();
  if (status === "RUNNING") return;
  if (status === "STAGING" || status === "PROVISIONING") return;
  const token = await getAccessToken();
  const res = await fetch(computeUrl("/start"), {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 400) {
    const t = await res.text();
    throw new Error(`啟動 VM 失敗: ${res.status} ${t.slice(0, 200)}`);
  }
}

/** Poll until Steel HTTPS answers or timeout. */
export async function waitForSteelReady(baseUrl: string, timeoutMs = 180_000): Promise<void> {
  const start = Date.now();
  let lastErr = "";
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(baseUrl.replace(/\/$/, "") + "/", {
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok || res.status === 404) return;
      lastErr = `HTTP ${res.status}`;
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error(`虛擬瀏覽器主機啟動逾時（${lastErr || "無回應"}）。請稍候再試。`);
}

/** Ensure VM is up and Steel responds before creating a session. */
export async function ensureSteelVmReady(baseUrl: string): Promise<{ started: boolean }> {
  if (!isGcpVmControlConfigured()) {
    // Self-host URL only — assume always on
    await waitForSteelReady(baseUrl, 45_000);
    return { started: false };
  }
  const before = await getSteelVmStatus();
  const started = before !== "RUNNING";
  if (started) {
    await startSteelVm();
  }
  await waitForSteelReady(baseUrl, started ? 200_000 : 60_000);
  return { started };
}
