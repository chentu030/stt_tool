# Extension media / attach RPC (P3 first slice)

Internal engineering note. Reference product names OK here; never surface in product UI.

## Goal

Let **sandboxed community extension iframes** attach / upload a file to a note the signed-in user owns — via the same typed postMessage notes RPC as P2 — without a host plugin loader or remote `main.js` eval.

## Shipped (2026-07-24)

### Message surface

Iframe → host (request):

| `type` | Permission | Params |
|--------|------------|--------|
| `cadence.notes.attach` | `notes_write` (+ `network` if using remote `url`) | see below |

Every request must include a string `reqId` for correlation.

**Params (exactly one payload source):**

| Field | Required | Notes |
|-------|----------|--------|
| `noteId` | yes | Target note; must be owned by signed-in user |
| `filename` | recommended | Sanitized; defaults from URL path / `"attachment"` |
| `contentType` | no | MIME; inferred from data URL / fetch when omitted |
| `dataBase64` | one-of | Raw base64 (no `data:` prefix) |
| `dataUrl` | one-of | `data:<mime>;base64,…` |
| `url` | one-of | Remote **https** only; requires manifest `network` |
| `insert` | no | `"append"` (default) appends media markdown to `body_md`; `"none"` upload-only |

**Limits:** decoded / fetched body ≤ **8 MiB** (`NOTES_RPC_ATTACH_MAX_BYTES`). Remote fetch timeout 30s.

Host → iframe (reply) — same envelope as P2:

```js
{
  type: "cadence.notes.result",
  reqId,
  method: "attach",
  ok: true | false,
  data?: {
    url: string,
    path: string,
    name: string,
    contentType: string,
    markdown: string,       // media snippet (image/audio/video/file/pdf/ppt)
    insert: "append" | "none",
    note: /* full note after write (body may be unchanged if insert=none) */
  },
  error?: { code: string, message: string }
}
```

`error.code` may be `bad_request` | `unauthorized` | `forbidden` | `not_found` | `too_large` | `internal`.

### Security (same model as P2)

- Host only accepts messages whose `event.source` is the extension iframe `contentWindow`.
- Origin must match the extension `pageType.entry` origin.
- `notes_write` required; remote `url` additionally requires `network`.
- Operations limited to notes owned by the signed-in user (`user_id === uid`).
- Upload path reuses `uploadNoteMedia` → `uploads/{uid}/notes/{noteId}/…`.
- Markdown insert reuses `mediaMarkdownForFile` (same as editor / import).
- Host never evaluates remote extension `main.js`; replies go to the **entry origin** (not `*`).

### Key files

- Spec: this doc
- Protocol + dispatcher: `frontend/src/lib/community/notesRpc.ts` (`attach`)
- Host wiring: `frontend/src/components/workspace/NoteAppSurface.tsx` (unchanged listener; method added in dispatcher)
- Sample client: `frontend/public/samples/notes-rpc-client.js` (`CadenceNotes.attach` / `attachFile`)
- Author guide: `frontend/public/community/ai.md` (§4.1)

### Explicitly not in this ship

- Obsidian-style plugin / editor UX ports
- Transcription / media-ingest job pipeline via RPC
- Multi-file batch attach
- Attach to canvas / whiteboard
- Streaming upload progress events
- Cross-user / shared-ACL attach

## How extensions call it

1. Declare `"permissions": ["iframe", "notes_write"]` (add `"network"` for remote `url`).
2. From the iframe (current note id is usually `?note=`):

```js
const noteId = new URLSearchParams(location.search).get("note");
const reqId = crypto.randomUUID();
const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
window.parent.postMessage(
  {
    type: "cadence.notes.attach",
    reqId,
    noteId,
    filename: "pixel.png",
    dataUrl,
    insert: "append",
  },
  "*" // or host origin if known
);
```

Helper: `/samples/notes-rpc-client.js` → `CadenceNotes.attach` / `CadenceNotes.attachFile`.

## Optional P3 follow-ups (not this slice)

From the broader roadmap / 精選 UX track — **not** required for media RPC:

- Richer note props / relations RPC beyond attach
- Attach progress (`cadence.notes.progress`) for large files
- Optional transcription kickoff after attach (reuse note media ingest choices)
- Gallery / attachment list RPC (`cadence.notes.attachments.list`)
- Any third-party editor UX port (explicitly out of scope)

## Next

Ship is complete for **media/attach RPC**. Further P3 UX items above are optional follow-ups.
