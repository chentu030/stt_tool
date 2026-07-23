/** Client fetch for /api/ai/* — attaches Firebase ID token transparently. */

import { auth } from "@/lib/firebase";

/**
 * Drop-in `fetch` for AI API routes. Existing callers keep the same UX;
 * auth is attached from the current Firebase session.
 */
export async function aiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error("請先登入後再使用 AI");
  }
  const token = await user.getIdToken();
  const headers = new Headers(init?.headers || {});
  if (!headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(input, { ...init, headers });
}
