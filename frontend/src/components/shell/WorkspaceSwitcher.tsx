"use client";

import { useState } from "react";
import { askConfirm, askPrompt } from "@/lib/dialogs";

export type WorkspaceItem = { id: string; name: string };

type Props = {
  items: WorkspaceItem[];
  currentId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  label?: string;
};

export default function WorkspaceSwitcher({
  items,
  currentId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  label = "工作區",
}: Props) {
  const [open, setOpen] = useState(false);
  const current = items.find((i) => i.id === currentId);

  return (
    <div className="ws-switch">
      <button type="button" className="ws-switch-btn" onClick={() => setOpen((v) => !v)}>
        <span className="ws-switch-label">{label}</span>
        <strong>{current?.name || "…"}</strong>
        <span aria-hidden>▾</span>
      </button>
      {open && (
        <div className="ws-switch-menu" role="listbox">
          {items.map((i) => (
            <button
              key={i.id}
              type="button"
              className={i.id === currentId ? "is-on" : ""}
              onClick={() => {
                onSelect(i.id);
                setOpen(false);
              }}
            >
              {i.name}
            </button>
          ))}
          <hr />
          <button
            type="button"
            onClick={() => {
              void (async () => {
                const name = await askPrompt({
                  title: "重新命名",
                  message: label,
                  defaultValue: current?.name || "",
                });
                if (name?.trim()) onRename(currentId, name.trim());
                setOpen(false);
              })();
            }}
          >
            重新命名
          </button>
          <button
            type="button"
            onClick={() => {
              onCreate();
              setOpen(false);
            }}
          >
            ＋ 新建
          </button>
          {items.length > 1 && (
            <button
              type="button"
              className="is-danger"
              onClick={() => {
                void (async () => {
                  if (
                    await askConfirm({
                      title: `刪除「${current?.name}」？`,
                      danger: true,
                      confirmLabel: "刪除",
                    })
                  ) {
                    onDelete(currentId);
                  }
                  setOpen(false);
                })();
              }}
            >
              刪除
            </button>
          )}
        </div>
      )}
    </div>
  );
}
