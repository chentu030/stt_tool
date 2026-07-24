# Markdown import / export fidelity (P0)

Internal engineering note. Reference product names OK here; never surface in product UI.

## Shipped (2026-07-24)

### 1. Folder Markdown import
- UI: 知識庫「匯入資料夾」「匯入 Markdown」; sidebar 右鍵「匯入資料夾… / 匯入 Markdown…」; drag-drop of folders/files.
- Uses `showDirectoryPicker` when available, else `webkitdirectory`.
- Preserves nested paths via `webkitRelativePath` → Cadence `folder` (strips the selected root folder name).
- Sibling media under the tree can be uploaded and local `![](…)` / `[](…)` rewritten to Firebase URLs.

### 2. Frontmatter round-trip
- Import parses YAML: `title`, `tags`/`tag`, `aliases`/`alias`, `date`/`journal_date` → `journal_date`, `created`/`updated`, `folder`, plus unknown keys → `props.frontmatter`.
- Aliases → `props.aliases` (also used by wiki resolve / suggest / backlinks).
- Export Markdown writes YAML frontmatter again (note menu「匯出 Markdown（含 YAML）」; library bulk MD export).

### 3. Wikilink / attachment path fidelity
- Body keeps `[[wikilinks]]`; import normalizes `[[path/Note.md]]` → `[[Note]]` for title-based resolve.
- Relative attachment paths: `\`→`/`, strip `./`, resolve `..` against note dir; upload when file present in import set.

## Explicitly not in this ship
- Desktop Local REST / folder sync companion (P1 bridge) — **done in P1**, see `docs/design/local-folder-bridge-p1.md`
- Dataview-like query language
- Obsidian plugin loader / TipTap plugin host
- Full vault bidirectional sync (background watcher)

## Next from priority list
| Phase | Item | Notes |
|-------|------|--------|
| P1 | Local REST / desktop companion bridge | **Shipped** as FS Access folder sync — `local-folder-bridge-p1.md` |
| P1 | Richer FM types | **Shipped** type / status / relation props — `frontmatter-relations-inbox-ai-review.md` |
| P2 | Extension host RPC expansion | Beyond current iframe utilities — first task in P1 handoff |
| Stretch | Template / journal polish | Tied to `NOTE_TEMPLATES` / community templates — light only |

## Key files
- `frontend/src/lib/importMarkdownNotes.ts`
- `frontend/src/lib/exportNote.ts`
- `frontend/src/lib/wiki.ts`
- `frontend/src/lib/libraryIndex.ts` (`exportNotesMarkdown`)
- `frontend/src/components/shell/SidebarNotesTree.tsx`
- `frontend/src/app/library/page.tsx`
- `frontend/src/app/notes/[id]/page.tsx`
