# Extension notes RPC (P2)

Internal engineering note. Reference product names OK here; never surface in product UI.

## Goal

Expose a **typed postMessage notes RPC** from the Cadence host to **sandboxed community extension iframes**, so extensions can read / list / update / create the signed-in user’s notes — without a plugin `main.js` loader or remote JS eval in the host.

## Shipped (2026-07-24)

### Message surface

Iframe → host (request), one of:

| `type` | Permission | Params |
|--------|------------|--------|
| `cadence.notes.get` | `notes_read` | `noteId` |
| `cadence.notes.list` | `notes_read` | optional `q`, `folder`, `limit` (default 50, max 100), `includeBody` |
| `cadence.notes.update` | `notes_write` | `noteId`, `patch` (`title` / `body_md` / `tags` / `folder`) |
| `cadence.notes.create` | `notes_write` | `title`, optional `body_md` / `tags` / `folder` |

Every request must include a string `reqId` for correlation.

Host → iframe (reply):

```js
{
  type: "cadence.notes.result",
  reqId,
  method: "get" | "list" | "update" | "create",
  ok: true | false,
  data?: /* method-specific */,
  error?: { code: string, message: string }
}
```

Naming aligns with existing host↔iframe events (`albireus:auth`, `albireus:settings`); the notes API uses the `cadence.notes.*` prefix so it stays product-stable.

### Security

- Host only accepts messages whose `event.source` is the extension iframe `contentWindow`.
- Origin must match the extension `pageType.entry` origin (derived from frame URL).
- Methods gated by manifest permissions (`notes_read` / `notes_write`), shown in the store trust card.
- Operations limited to notes owned by the signed-in user (`user_id === uid`).
- Host never evaluates remote extension `main.js`; UI remains sandboxed iframe only.
- Replies are `postMessage`’d to the **entry origin** (not `*`).

### Key files

- Spec: this doc
- Protocol + dispatcher: `frontend/src/lib/community/notesRpc.ts`
- Host wiring: `frontend/src/components/workspace/NoteAppSurface.tsx`
- Permissions: `frontend/src/lib/community/types.ts`, `permissions.ts`
- Sample client: `frontend/public/samples/notes-rpc-client.js`
- Author guide: `frontend/public/community/ai.md` (§4.1)

### Explicitly not in this ship

- Obsidian-style plugin loader / eval of remote `main.js`
- Realtime note subscriptions over RPC
- Cross-user / shared-ACL note access via RPC
- Attachment / media upload RPC — done in P3: `docs/design/extension-media-rpc-p3.md`
- Local folder bridge (P1) or local REST companion

## How extensions call it

1. Declare `"permissions": ["iframe", "notes_read"]` (and `notes_write` if mutating).
2. From the iframe page:

```js
const reqId = crypto.randomUUID();
window.parent.postMessage(
  { type: "cadence.notes.list", reqId, q: "會議", limit: 20 },
  "*" // or host origin if known
);
window.addEventListener("message", (e) => {
  if (e.data?.type === "cadence.notes.result" && e.data.reqId === reqId) {
    console.log(e.data);
  }
});
```

Full helper: `/samples/notes-rpc-client.js`.

## Next — P3 first task (done)

**Attachment / media bridge** shipped — see `docs/design/extension-media-rpc-p3.md` (`cadence.notes.attach`).
