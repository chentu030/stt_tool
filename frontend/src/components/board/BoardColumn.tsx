"use client";

import { BoardCard, BoardStatus, BOARD_COLUMNS } from "@/lib/boardMeta";
import BoardCardView from "./BoardCardView";

type Props = {
  status: BoardStatus;
  cards: BoardCard[];
  selectedIds: string[];
  dragOver: boolean;
  onDragOver: () => void;
  onDragLeave: () => void;
  onDrop: () => void;
  onDragStart: (id: string) => void;
  onSelect: (id: string, multi: boolean) => void;
  onMove: (id: string, status: BoardStatus) => void;
  onPriorityCycle: (id: string) => void;
  onAddTag: (id: string) => void;
  onRemoveTag: (id: string, tag: string) => void;
  onQuickAdd: (status: BoardStatus) => void;
};

export default function BoardColumn({
  status,
  cards,
  selectedIds,
  dragOver,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragStart,
  onSelect,
  onMove,
  onPriorityCycle,
  onAddTag,
  onRemoveTag,
  onQuickAdd,
}: Props) {
  const col = BOARD_COLUMNS.find((c) => c.id === status)!;
  const overWip = col.wipLimit != null && cards.length > col.wipLimit;

  return (
    <section
      className={`bd-col${dragOver ? " is-drop" : ""}${overWip ? " is-wip" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver();
      }}
      onDragLeave={onDragLeave}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
    >
      <header className="bd-col-head">
        <div>
          <h2>
            <i style={{ background: col.color }} />
            {col.label}
            <em>{cards.length}</em>
          </h2>
          <p>
            {col.hint}
            {col.wipLimit != null ? ` · WIP ≤ ${col.wipLimit}` : ""}
            {overWip ? " · 已超限" : ""}
          </p>
        </div>
        <button type="button" className="bd-add" onClick={() => onQuickAdd(status)}>
          +
        </button>
      </header>

      <div className="bd-col-body">
        {cards.length === 0 ? (
          <p className="bd-empty">拖曳卡片到這裡，或按 + 新增</p>
        ) : (
          cards.map((c) => (
            <BoardCardView
              key={c.id}
              card={c}
              selected={selectedIds.includes(c.id)}
              onSelect={onSelect}
              onDragStart={onDragStart}
              onMove={onMove}
              onPriorityCycle={onPriorityCycle}
              onAddTag={onAddTag}
              onRemoveTag={onRemoveTag}
            />
          ))
        )}
      </div>
    </section>
  );
}
