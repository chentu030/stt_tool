# Note 屬性／關係 panel polish

Internal engineering note. Reference product names OK here; never surface in product UI.

## Goal
Make Cadence note **屬性** feel like a clear Properties sidebar: header + close, type/status/date pills, relationship chips with empty「新增」slots, and **新增屬性／新增關係** affordances — without changing the `note.props` + frontmatter data model.

## Shipped UX
- `NoteKnowledgePropsPanel` (non-database notes only)
  - Header「屬性」+ collapse / close (sessionStorage per note)
  - Pills: 類型、狀態、日期（FM `date` + 建立／編輯）、custom scalar extras
  - Relationship rows: colored chips → `/notes/:id` when resolvable; missing titles italic; per-row「新增」
  - Footer:「+ 新增屬性」「+ 新增關係」+ 待整理 actions
- Same component in:
  1. Note page editor chrome (inline)
  2. Note aside「資訊」tab (`variant="aside"`)
- Cadence wording only; teal / accent-3 tones via CSS vars (not foreign purple/orange skin)

## Data helpers (`noteKnowledge.ts`)
- `withFmStatus`, `withFrontmatterExtra`, `ensureRelationField`
- `withRelationTitles` / `addRelationTitle` / `removeRelationTitle` (stores `[[Title]]` lists)
- `listPropRelationFields` (includes empty `[]` slots)
- `listScalarProps`, `listNoteDatePills`, `relationToneIndex`
- Export round-trip still via `frontmatterExtrasFromProps`

## How to open
1. Open any note **not** in a Cadence database
2. Above the editor: **屬性** panel
3. Or open aside → **資訊** tab → same panel (denser)

## Files
- `frontend/src/components/notes/NoteKnowledgePropsPanel.tsx`
- `frontend/src/components/notes/NoteAside.tsx`
- `frontend/src/app/notes/[id]/page.tsx`
- `frontend/src/lib/noteKnowledge.ts`
- `frontend/src/app/globals.css` (`.nk-props*` / `.nk-rel*` / `.nk-pill*`)
