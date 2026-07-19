"use client";

import MenuSelect from "@/components/MenuSelect";
import {
  GraphFilters,
  LAYOUT_OPTIONS,
  LayoutMode,
} from "@/lib/graphModel";

type Props = {
  filters: GraphFilters;
  onFilters: (patch: Partial<GraphFilters>) => void;
  layout: LayoutMode;
  onLayout: (m: LayoutMode) => void;
  folders: string[];
  tags: string[];
  scale: number;
  onZoom: (delta: number) => void;
  onFit: () => void;
  onRelayout: () => void;
  onClearPositions: () => void;
  onExportMd: () => void;
  onExportJson: () => void;
  pathMode: boolean;
  onTogglePath: () => void;
  edgeCounts: { wiki: number; tag: number; folder: number; visible: number };
};

export default function GraphToolbar({
  filters,
  onFilters,
  layout,
  onLayout,
  folders,
  tags,
  scale,
  onZoom,
  onFit,
  onRelayout,
  onClearPositions,
  onExportMd,
  onExportJson,
  pathMode,
  onTogglePath,
  edgeCounts,
}: Props) {
  return (
    <div className="gp-toolbar">
      <input
        className="input gp-search"
        placeholder="搜尋節點、標籤、資料夾…"
        value={filters.q}
        onChange={(e) => onFilters({ q: e.target.value })}
      />

      <MenuSelect
        value={layout}
        onChange={(v) => onLayout(v as LayoutMode)}
        options={LAYOUT_OPTIONS.map((o) => ({ value: o.id, label: o.label }))}
        ariaLabel="佈局"
      />

      <MenuSelect
        value={filters.folder || ""}
        onChange={(v) => onFilters({ folder: v })}
        options={[
          { value: "", label: "全部資料夾" },
          ...folders.map((f) => ({ value: f, label: f })),
        ]}
        ariaLabel="資料夾"
      />

      <MenuSelect
        value={filters.tag || ""}
        onChange={(v) => onFilters({ tag: v })}
        options={[
          { value: "", label: "全部標籤" },
          ...tags.map((t) => ({ value: t, label: `#${t}` })),
        ]}
        ariaLabel="標籤"
      />

      <MenuSelect
        value={String(filters.minDegree)}
        onChange={(v) => onFilters({ minDegree: Number(v) })}
        options={[
          { value: "0", label: "度數 ≥ 0" },
          { value: "1", label: "度數 ≥ 1" },
          { value: "2", label: "度數 ≥ 2" },
          { value: "3", label: "度數 ≥ 3" },
        ]}
        ariaLabel="最小度數"
      />

      <MenuSelect
        value={String(filters.recentDays)}
        onChange={(v) => onFilters({ recentDays: Number(v) })}
        options={[
          { value: "0", label: "全部時間" },
          { value: "7", label: "近 7 天" },
          { value: "30", label: "近 30 天" },
          { value: "90", label: "近 90 天" },
        ]}
        ariaLabel="時間"
      />

      <label className="gp-check">
        <input
          type="checkbox"
          checked={filters.showGhosts}
          onChange={(e) => onFilters({ showGhosts: e.target.checked })}
        />
        幽靈
      </label>
      <label className="gp-check">
        <input
          type="checkbox"
          checked={filters.showTagEdges}
          onChange={(e) => onFilters({ showTagEdges: e.target.checked })}
        />
        標籤邊
      </label>
      <label className="gp-check">
        <input
          type="checkbox"
          checked={filters.showFolderEdges}
          onChange={(e) => onFilters({ showFolderEdges: e.target.checked })}
        />
        資料夾邊
      </label>
      <label className="gp-check">
        <input
          type="checkbox"
          checked={filters.onlyOrphans}
          onChange={(e) =>
            onFilters({ onlyOrphans: e.target.checked, onlyHubs: e.target.checked ? false : filters.onlyHubs })
          }
        />
        僅孤兒
      </label>
      <label className="gp-check">
        <input
          type="checkbox"
          checked={filters.onlyHubs}
          onChange={(e) =>
            onFilters({ onlyHubs: e.target.checked, onlyOrphans: e.target.checked ? false : filters.onlyOrphans })
          }
        />
        僅樞紐
      </label>

      <div className="gp-zoom">
        <button type="button" className="btn btn-soft btn-sm" onClick={() => onZoom(-0.1)}>−</button>
        <span>{Math.round(scale * 100)}%</span>
        <button type="button" className="btn btn-soft btn-sm" onClick={() => onZoom(0.1)}>+</button>
        <button type="button" className="btn btn-soft btn-sm" onClick={onFit} title="Shift+1">Fit</button>
        <button
          type="button"
          className="btn btn-soft btn-sm"
          onClick={() => onZoom(1 - scale)}
          title="Shift+0 · 100%"
        >
          100%
        </button>
      </div>

      <button type="button" className="btn btn-soft btn-sm" onClick={onRelayout}>重算佈局</button>
      <button type="button" className="btn btn-soft btn-sm" onClick={onClearPositions}>清除位置</button>
      <button
        type="button"
        className={`btn btn-soft btn-sm${pathMode ? " is-on" : ""}`}
        onClick={onTogglePath}
      >
        {pathMode ? "路徑模式中" : "找路徑"}
      </button>
      <button type="button" className="btn btn-soft btn-sm" onClick={onExportMd}>匯出 MD</button>
      <button type="button" className="btn btn-soft btn-sm" onClick={onExportJson}>匯出 JSON</button>

      <span className="gp-edge-meta">
        可見 {edgeCounts.visible} · wiki {edgeCounts.wiki}
        {filters.showTagEdges ? ` · tag ${edgeCounts.tag}` : ""}
        {filters.showFolderEdges ? ` · folder ${edgeCounts.folder}` : ""}
      </span>
    </div>
  );
}
