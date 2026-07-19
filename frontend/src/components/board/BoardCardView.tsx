"use client";

import Link from "next/link";
import { BoardCard, PRIORITIES, BoardStatus, BOARD_COLUMNS } from "@/lib/boardMeta";

type Props = {
  card: BoardCard;
  selected: boolean;
  onSelect: (id: string, multi: boolean) => void;
  onDragStart: (id: string) => void;
  onMove: (id: string, status: BoardStatus) => void;
  onPriorityCycle: (id: string) => void;
};

export default function BoardCardView({
  card,
  selected,
  onSelect,
  onDragStart,
  onMove,
  onPriorityCycle,
}: Props) {
  const pri = PRIORITIES.find((p) => p.id === card.meta.priority)!;

  return (
    <article
      className={`bd-card${selected ? " is-selected" : ""}${card.overdue ? " is-overdue" : ""}`}
      draggable
      onDragStart={() => onDragStart(card.id)}
      onClick={(e) => onSelect(card.id, e.metaKey || e.ctrlKey)}
    >
      <div className="bd-card-top">
        <button
          type="button"
          className="bd-pri"
          style={{ background: pri.color }}
          title="循環優先級"
          onClick={(e) => {
            e.stopPropagation();
            onPriorityCycle(card.id);
          }}
        >
          {pri.label}
        </button>
        {card.overdue && <span className="bd-badge-warn">逾期</span>}
        {card.ageDays >= 7 && card.statusKey !== "done" && (
          <span className="bd-badge-mute">{card.ageDays}d</span>
        )}
      </div>

      <Link
        href={`/notes/${card.id}`}
        className="bd-card-title"
        onClick={(e) => e.stopPropagation()}
      >
        {card.title || "未命名"}
      </Link>
      <p className="bd-card-snip">{card.snippet}</p>

      <div className="bd-card-meta">
        {card.folder ? <span>{card.folder}</span> : null}
        {(card.tags || []).slice(0, 3).map((t) => (
          <span key={t}>#{t}</span>
        ))}
        {card.meta.due ? <span>截止 {card.meta.due.slice(5)}</span> : null}
      </div>

      <div className="bd-card-moves">
        {BOARD_COLUMNS.filter((c) => c.id !== card.statusKey).map((c) => (
          <button
            key={c.id}
            type="button"
            className="bd-move"
            onClick={(e) => {
              e.stopPropagation();
              onMove(card.id, c.id);
            }}
          >
            → {c.label}
          </button>
        ))}
      </div>
    </article>
  );
}
