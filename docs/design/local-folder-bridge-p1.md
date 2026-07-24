# Local folder bridge / knowledge-base sync (P1)

Internal engineering note. Reference product names OK here; never surface in product UI.

## Shipped (2026-07-24)

### MVP choice
**Folder sync companion** via browser **File System Access API** (Chrome / Edge desktop).

Rationale after spike:
- P0 already uses `showDirectoryPicker` + YAML / wikilink fidelity — bridge reuses the same Markdown dialect.
- No separate desktop companion process for MVP; users can click「本機資料夾」in 知識庫.
- Local REST client UI deferred (optional later); not required for usable sync.

### What users get
- **知識庫** →「本機資料夾」panel: 連結 / 從本機拉入 / 匯出到本機 / 重新連結 / 解除.
- **設定 → 知識庫**: same controls.
- Directory handle persisted in IndexedDB (`cadence_local_bridge`); permission re-requested when needed.
- Push writes `.md` with YAML including `cadence_id` for stable rematch.
- Pull matches `cadence_id` → path map → else create; stamps `cadence_id` onto new files when writable.
- Product copy:「本機資料夾」「知識庫同步」only (no competitor / plugin names).

### Explicitly not in this ship
- Always-on filesystem watcher / background daemon
- Local REST server or third-party vault plugin compatibility
- Obsidian-style plugin loader / `main.js` eval
- Attachment binary sync on pull (paths normalized; upload still via P0 import)
- P2 extension notes RPC host

## Key files
- `frontend/src/lib/localFolderBridge.ts`
- `frontend/src/components/library/LocalFolderSyncPanel.tsx`
- `frontend/src/app/library/page.tsx`
- `frontend/src/app/settings/page.tsx`
- Frontmatter: `cadence_id` in `importMarkdownNotes.ts` / export path

## How to use
1. Chrome or Edge (desktop), signed in.
2. Open 知識庫 →「本機資料夾」→「連結本機資料夾」→ grant read/write.
3.「匯出到本機」writes cloud notes as Markdown under the folder.
4. Edit files locally, then「從本機拉入」to update / create Cadence notes.
5. Optional: select notes in 知識庫 first to push only the selection.

## Next — P2 (done) / P3 (media RPC done)

P2 extension notes RPC shipped — see `docs/design/extension-notes-rpc-p2.md`.

P3 first slice (attachment / media bridge) shipped — see `docs/design/extension-media-rpc-p3.md` (`cadence.notes.attach`).

## Priority leftovers
| Phase | Item | Notes |
|-------|------|--------|
| P1.x | Optional Local REST client settings | Base URL + token pull/push if users run a local HTTPS API |
| P1.x | Richer FM types | Nested YAML → DB props |
| P2 | Extension notes RPC | Done — `extension-notes-rpc-p2.md` |
| P3 | Extension media / attach RPC | Done — `extension-media-rpc-p3.md` |
| Stretch | Background folder watch | Needs companion or periodic poll UX |
