/** Product feedback from the sidebar (optional contact email for replies). */

import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

export type AnonymousFeedbackInput = {
  message: string;
  /** Optional internal uid for spam control — never shown as author */
  uid?: string | null;
  path?: string;
  /** When true, store contact email so the team can reply */
  includeEmail?: boolean;
  email?: string | null;
};

export async function submitAnonymousFeedback(input: AnonymousFeedbackInput): Promise<void> {
  const message = input.message.trim().slice(0, 2000);
  if (message.length < 2) throw new Error("請輸入至少兩個字的意見");

  const includeEmail = Boolean(input.includeEmail);
  const email =
    includeEmail && input.email
      ? String(input.email).trim().slice(0, 200)
      : null;

  await addDoc(collection(db, "anonymous_feedback"), {
    message,
    // Stored only for moderation / rate limits — UI never shows identity
    uid: input.uid || null,
    path: (input.path || "").slice(0, 300),
    include_email: includeEmail,
    email,
    createdAt: serverTimestamp(),
    clientAt: Date.now(),
  });
}
