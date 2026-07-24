"""
Semantic note embeddings via Vertex AI + Firestore vector search.

Collection: users/{uid}/note_embeddings/{noteId}
Requires a Firestore vector index on field `embedding` (see firestore.indexes.json).

Env:
  VERTEX_API_KEYS — comma/newline separated (same as frontend)
  VERTEX_EMBEDDING_MODEL — default text-multilingual-embedding-002 (768-d, CJK-friendly)
  VERTEX_LOCATION / VERTEX_PROJECT_ID — optional (mirror generateContent URL style)
"""

from __future__ import annotations

import hashlib
import os
import re
import time
from typing import Any, Dict, List, Optional

import requests

EMBED_DIM = 768
DEFAULT_MODEL = "text-multilingual-embedding-002"
MAX_EMBED_CHARS = 6000
# Cosine distance: 0 = identical, 2 = opposite. Below this ≈ related enough.
DEFAULT_DISTANCE_THRESHOLD = 0.55

_rotate = 0


def _vector_types():
    from google.cloud.firestore_v1.base_vector_query import DistanceMeasure
    from google.cloud.firestore_v1.vector import Vector

    return Vector, DistanceMeasure


def _keys() -> List[str]:
    raw = os.environ.get("VERTEX_API_KEYS") or ""
    return [k.strip() for k in re.split(r"[\n,]+", raw) if k.strip()]


def embedding_model() -> str:
    return (os.environ.get("VERTEX_EMBEDDING_MODEL") or DEFAULT_MODEL).strip()


def _endpoint(model: str) -> str:
    location = (os.environ.get("VERTEX_LOCATION") or "us-central1").strip()
    project = (os.environ.get("VERTEX_PROJECT_ID") or "").strip()
    if project:
        # Embedding predict is regional on Vertex; prefer us-central1 when project-scoped.
        loc = location if location != "global" else "us-central1"
        return (
            f"https://{loc}-aiplatform.googleapis.com/v1/projects/{project}"
            f"/locations/{loc}/publishers/google/models/{model}:predict"
        )
    # Express / API-key publisher path (same host family as generateContent)
    return f"https://aiplatform.googleapis.com/v1/publishers/google/models/{model}:predict"


def content_hash(title: str, body: str) -> str:
    raw = f"{(title or '').strip()}\n{(body or '').strip()}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:40]


def build_embed_text(
    title: str,
    body: str,
    *,
    folder: str = "",
    tags: Optional[List[str]] = None,
) -> str:
    parts = [f"標題：{(title or '未命名').strip()}"]
    if folder and folder.strip():
        parts.append(f"資料夾：{folder.strip()}")
    tag_list = [t for t in (tags or []) if t]
    if tag_list:
        parts.append("標籤：" + " ".join(f"#{t}" for t in tag_list[:24]))
    body_clean = re.sub(r"\s+", " ", (body or "").strip())
    if body_clean:
        parts.append(body_clean[:MAX_EMBED_CHARS])
    return "\n".join(parts).strip() or "（空白筆記）"


def vertex_embed(
    texts: List[str],
    *,
    task_type: str = "RETRIEVAL_DOCUMENT",
) -> List[List[float]]:
    """Embed one or more texts via Vertex `:predict`. Max 5 per request."""
    keys = _keys()
    if not keys:
        raise RuntimeError("VERTEX_API_KEYS 未設定（Cloud Run 環境變數）")
    if not texts:
        return []
    model = embedding_model()
    url = _endpoint(model)
    out: List[List[float]] = []
    global _rotate

    for i in range(0, len(texts), 5):
        batch = texts[i : i + 5]
        instances = [{"content": t[:MAX_EMBED_CHARS], "task_type": task_type} for t in batch]
        body = {
            "instances": instances,
            "parameters": {"outputDimensionality": EMBED_DIM},
        }
        last_err = "unknown"
        start = _rotate
        ok = False
        for attempt in range(len(keys)):
            key_i = (start + attempt) % len(keys)
            api_key = keys[key_i]
            _rotate = (key_i + 1) % len(keys)
            try:
                res = requests.post(
                    url,
                    headers={
                        "Content-Type": "application/json",
                        "x-goog-api-key": api_key,
                    },
                    json=body,
                    timeout=60,
                )
                data = res.json() if res.content else {}
                if not res.ok:
                    last_err = (
                        (data.get("error") or {}).get("message")
                        or f"{res.status_code} {res.reason}"
                    )
                    if res.status_code in (401, 403, 429, 500, 503):
                        continue
                    raise RuntimeError(last_err)
                preds = data.get("predictions") or []
                if len(preds) != len(batch):
                    last_err = f"embedding 回傳筆數不符（{len(preds)}/{len(batch)}）"
                    continue
                for p in preds:
                    emb = p.get("embeddings") or p.get("values")
                    if isinstance(emb, dict):
                        values = emb.get("values") or []
                    elif isinstance(emb, list):
                        values = emb
                    else:
                        values = p.get("values") or []
                    if not values or len(values) != EMBED_DIM:
                        last_err = f"embedding 維度異常（got {len(values) if values else 0}）"
                        raise RuntimeError(last_err)
                    out.append([float(x) for x in values])
                ok = True
                break
            except RuntimeError:
                raise
            except Exception as e:
                last_err = str(e)
        if not ok:
            raise RuntimeError(f"Vertex embedding 失敗：{last_err}")
    return out


def upsert_note_embedding(
    fstore,
    uid: str,
    note: Dict[str, Any],
    *,
    force: bool = False,
) -> Dict[str, Any]:
    note_id = str(note.get("id") or "").strip()
    if not note_id:
        raise ValueError("缺少 note id")
    title = str(note.get("title") or "")
    body = str(note.get("body_md") or note.get("body") or "")
    folder = str(note.get("folder") or "")
    tags = list(note.get("tags") or [])
    database_id = str(note.get("database_id") or "")
    ch = content_hash(title, body)
    ref = fstore.collection("users").document(uid).collection("note_embeddings").document(note_id)
    snap = ref.get()
    if snap.exists and not force:
        prev = snap.to_dict() or {}
        if prev.get("content_hash") == ch and prev.get("model") == embedding_model():
            return {"id": note_id, "skipped": True, "reason": "unchanged"}

    text = build_embed_text(title, body, folder=folder, tags=tags)
    vectors = vertex_embed([text], task_type="RETRIEVAL_DOCUMENT")
    Vector, _ = _vector_types()
    payload = {
        "note_id": note_id,
        "user_id": uid,
        "title": (title or "未命名")[:200],
        "folder": folder[:200],
        "tags": tags[:40],
        "database_id": database_id[:120],
        "content_hash": ch,
        "model": embedding_model(),
        "dim": EMBED_DIM,
        "embedding": Vector(vectors[0]),
        "updated_at": time.time(),
    }
    ref.set(payload, merge=True)
    return {"id": note_id, "skipped": False}


def delete_note_embedding(fstore, uid: str, note_id: str) -> bool:
    ref = fstore.collection("users").document(uid).collection("note_embeddings").document(note_id)
    if not ref.get().exists:
        return False
    ref.delete()
    return True


def search_note_embeddings(
    fstore,
    uid: str,
    query: str,
    *,
    limit: int = 12,
    distance_threshold: float = DEFAULT_DISTANCE_THRESHOLD,
    folder: Optional[str] = None,
    database_id: Optional[str] = None,
    scope_ids: Optional[List[str]] = None,
    tags: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    q = (query or "").strip()
    if not q:
        return []
    limit = max(1, min(int(limit or 12), 40))
    threshold = float(distance_threshold if distance_threshold is not None else DEFAULT_DISTANCE_THRESHOLD)
    # Over-fetch when metadata filters are applied (post-filter).
    fetch_n = min(40, max(limit * 3, limit + 8)) if (folder or database_id or scope_ids or tags) else limit

    q_vec = vertex_embed([q[:MAX_EMBED_CHARS]], task_type="RETRIEVAL_QUERY")[0]
    Vector, DistanceMeasure = _vector_types()
    coll = fstore.collection("users").document(uid).collection("note_embeddings")
    vector_query = coll.find_nearest(
        vector_field="embedding",
        query_vector=Vector(q_vec),
        distance_measure=DistanceMeasure.COSINE,
        limit=fetch_n,
        distance_result_field="vector_distance",
        distance_threshold=threshold,
    )
    hits: List[Dict[str, Any]] = []
    scope = set(scope_ids or [])
    tag_set = {t for t in (tags or []) if t}
    folder_f = (folder or "").strip().replace("\\", "/")
    db_f = (database_id or "").strip()

    for doc in vector_query.stream():
        data = doc.to_dict() or {}
        note_id = str(data.get("note_id") or doc.id)
        if scope and note_id not in scope:
            continue
        if db_f and str(data.get("database_id") or "") != db_f:
            continue
        if folder_f:
            nf = str(data.get("folder") or "").strip().replace("\\", "/")
            if nf != folder_f and not nf.startswith(f"{folder_f}/"):
                continue
        if tag_set:
            note_tags = set(data.get("tags") or [])
            if not (note_tags & tag_set):
                continue
        dist = data.get("vector_distance")
        try:
            distance = float(dist) if dist is not None else 1.0
        except (TypeError, ValueError):
            distance = 1.0
        if distance > threshold:
            continue
        # Convert cosine distance → similarity score in (0, 1]
        score = max(0.0, 1.0 - distance / 2.0)
        hits.append(
            {
                "id": note_id,
                "title": data.get("title") or "",
                "folder": data.get("folder") or "",
                "tags": data.get("tags") or [],
                "database_id": data.get("database_id") or "",
                "distance": round(distance, 4),
                "score": round(score, 4),
            }
        )
        if len(hits) >= limit:
            break

    # Boost same database_id when filter not forced (already sorted by distance).
    if not db_f and hits:
        # stable: keep distance order; optional soft boost already via filters
        pass
    return hits


def embedding_status(fstore, uid: str) -> Dict[str, Any]:
    coll = fstore.collection("users").document(uid).collection("note_embeddings")
    # Avoid full scan cost: count up to a soft cap.
    count = 0
    for _ in coll.limit(500).stream():
        count += 1
    return {
        "count": count,
        "capped": count >= 500,
        "model": embedding_model(),
        "dim": EMBED_DIM,
        "threshold": DEFAULT_DISTANCE_THRESHOLD,
        "vertex_keys": len(_keys()),
    }
