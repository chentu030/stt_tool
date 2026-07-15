import { initializeApp } from "firebase/app";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut as fbSignOut,
  onAuthStateChanged, User
} from "firebase/auth";
import {
  getFirestore, collection, doc, setDoc,
  query, where, onSnapshot, updateDoc, deleteDoc,
  Timestamp, Unsubscribe
} from "firebase/firestore";
import {
  getStorage, ref, uploadBytesResumable, getDownloadURL, getBytes, deleteObject,
  UploadTaskSnapshot
} from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyCPbw1q2LBbbEsYq1rvvRP7k7Rhwf064kk",
  authDomain: "stt-tool-f6e6d.firebaseapp.com",
  projectId: "stt-tool-f6e6d",
  storageBucket: "stt-tool-f6e6d.firebasestorage.app",
  messagingSenderId: "709725695008",
  appId: "1:709725695008:web:4ffb404811019b00846045",
  measurementId: "G-5B2WVTE54M",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

const googleProvider = new GoogleAuthProvider();

// ─── Auth ────────────────────────────────────────────────────
export const loginWithGoogle = async () => {
  try {
    return await signInWithPopup(auth, googleProvider);
  } catch {
    // Popup failed (domain not authorized, popup blocked, etc.) — use redirect
    return signInWithRedirect(auth, googleProvider);
  }
};
export const logout = () => fbSignOut(auth);
export { onAuthStateChanged };
export type { User, Unsubscribe };

// ─── Job types ───────────────────────────────────────────────
export interface Job {
  id: string;
  user_id: string;
  created_at: Date;
  status: "uploading" | "queued" | "processing" | "done" | "error";
  progress: number;
  current_file: number;
  total_files: number;
  source_type: "upload" | "youtube";
  filenames: string[];
  youtube_url: string;
  storage_paths: string[];
  result_paths: string[];
  transcripts: { filename: string; text: string }[];
  error_message: string;
  position_label?: string;
  queue_ahead?: number;
}

// ─── Firestore helpers ───────────────────────────────────────
export async function createJob(
  uid: string,
  sourceType: "upload" | "youtube",
  filenames: string[],
  youtubeUrl: string = ""
): Promise<string> {
  const jobId = `${uid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const jobRef = doc(db, "jobs", jobId);
  await setDoc(jobRef, {
    user_id: uid,
    created_at: Timestamp.now(),
    status: "uploading",
    progress: 0,
    current_file: 0,
    total_files: filenames.length,
    source_type: sourceType,
    filenames,
    youtube_url: youtubeUrl,
    storage_paths: [],
    result_paths: [],
    transcripts: [],
    error_message: "",
  });
  return jobId;
}

export async function updateJobStatus(
  jobId: string,
  updates: Partial<Omit<Job, "id">>
) {
  const jobRef = doc(db, "jobs", jobId);
  await updateDoc(jobRef, updates as Record<string, unknown>);
}

export function listenToJob(
  jobId: string,
  callback: (job: Job) => void
): Unsubscribe {
  const jobRef = doc(db, "jobs", jobId);
  return onSnapshot(jobRef, (snap) => {
    if (snap.exists()) {
      const data = snap.data();
      callback({
        id: snap.id,
        ...data,
        created_at: data.created_at?.toDate?.() || new Date(),
      } as Job);
    }
  });
}

export function listenToUserJobs(
  uid: string,
  callback: (jobs: Job[]) => void
): Unsubscribe {
  // No orderBy here: combining where(==) + orderBy(other field) requires a
  // Firestore composite index, which silently breaks the query if not created.
  // We sort client-side by created_at desc instead — no index needed.
  const q = query(collection(db, "jobs"), where("user_id", "==", uid));
  return onSnapshot(
    q,
    (snap) => {
      const jobs = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          created_at: data.created_at?.toDate?.() || new Date(),
        } as Job;
      });
      jobs.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
      callback(jobs);
    },
    (err) => {
      console.error("[listenToUserJobs] snapshot error:", err);
    }
  );
}

export async function deleteJob(jobId: string, storagePaths: string[], resultPaths: string[]) {
  // Delete files from storage
  const allPaths = [...storagePaths, ...resultPaths];
  for (const p of allPaths) {
    try { await deleteObject(ref(storage, p)); } catch { /* ignore */ }
  }
  // Delete Firestore document
  await deleteDoc(doc(db, "jobs", jobId));
}

// ─── Storage helpers ─────────────────────────────────────────
export function uploadFile(
  path: string,
  file: File,
  onProgress?: (pct: number) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const storageRef = ref(storage, path);
    const task = uploadBytesResumable(storageRef, file);
    task.on(
      "state_changed",
      (snap: UploadTaskSnapshot) => {
        const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
        onProgress?.(pct);
      },
      reject,
      async () => {
        const url = await getDownloadURL(task.snapshot.ref);
        resolve(url);
      }
    );
  });
}

export async function getFileUrl(path: string): Promise<string> {
  return getDownloadURL(ref(storage, path));
}

// Fetch a stored .txt transcript's text content directly.
export async function getResultText(path: string): Promise<string> {
  const bytes = await getBytes(ref(storage, path));
  return new TextDecoder("utf-8").decode(bytes);
}
