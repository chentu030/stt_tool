# Frontmatter conventions, relations, 待整理, AI write review

Internal engineering note. Reference product names OK here; never surface in product UI.

## Shipped (2026-07-24)

### 1. Frontmatter conventions (on P0)
- YAML `type` / `note_type` → `note.props.type`
- Status-like `status` / `state` / `progress` → kanban `note.status` when recognized; else `props.fm_status`
- Fields with `[[wikilinks]]` (or known relation keys) promoted to first-class `note.props` keys
- Leftover unknown keys still in `props.frontmatter`
- UI: `NoteKnowledgePropsPanel` on non-database notes (類型、關係、標為已整理)
- Export / local-folder push round-trip via `frontmatterExtrasFromProps`

### 2. Structured relationships
- Prop `[[wikilinks]]` treated as graph edges (`kind: relation`, weight 2.2)
- Reverse relations in note aside (body backlinks + prop reverse with via label)
- `findBacklinks` also scans prop wiki fields

### 3. 待整理 queue
- Heuristic: not `props.organized`, no parent; lacking folder/type/tags/links (or voice-capture without folder/type)
- 知識庫 rail「待整理」→ `?queue=inbox`
- Bulk / note actions:「標為已整理」

### 4. Local folder bridge
- **Not in this ship** — see `local-folder-bridge-p1.md` (separate agent / commit). This ship only reuses the same FM helpers when pull/pushing.

### 5. AI write review
- Global AI rail no longer auto-applies note edits
- Shows line diff preview +「套用到筆記」
- Read-only path: dock toggle「禁改筆記」keeps `allowNoteEdit: false` (no edit fence path)

## Key files
- `frontend/src/lib/noteKnowledge.ts`
- `frontend/src/lib/importMarkdownNotes.ts`
- `frontend/src/lib/wiki.ts` / `graphModel.ts` / `textDiff.ts` / `noteAiEdit.ts`
- `frontend/src/components/notes/NoteKnowledgePropsPanel.tsx`
- `frontend/src/components/notes/NoteAside.tsx`
- `frontend/src/components/shell/GlobalAiDock.tsx`
- `frontend/src/app/library/page.tsx`

## How to use
1. Import MD with `type: 專案` and `related: ["[[其他筆記]]"]` — see 屬性 panel + aside 關係.
2. 知識庫 → 待整理 → triage → 標為已整理 / 設類型 / 移動資料夾.
3. On a note page, open AI with「可改筆記」, ask to rewrite; review diff then 套用.
