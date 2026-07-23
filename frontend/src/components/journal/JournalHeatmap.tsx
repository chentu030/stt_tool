"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  heatAvailableYears,
  heatYearGraph,
  type JournalStats,
} from "@/lib/journalMeta";

type Props = {
  stats: JournalStats;
  wordsByDate?: Map<string, number> | Record<string, number>;
  onSelectDay?: (dateKey: string) => void;
};

const WEEKDAY_MARKS = [
  { row: 0, label: "一" },
  { row: 2, label: "三" },
  { row: 4, label: "五" },
];

export default function JournalHeatmap({ stats, wordsByDate, onSelectDay }: Props) {
  const years = useMemo(
    () => heatAvailableYears(stats.filledDays),
    [stats.filledDays]
  );
  const [year, setYear] = useState(years[0] || new Date().getFullYear());
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollMax, setScrollMax] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);

  useEffect(() => {
    if (!years.includes(year) && years[0]) setYear(years[0]);
  }, [years, year]);

  const graph = useMemo(
    () =>
      heatYearGraph(stats.filledDays, {
        year,
        wordsByDate,
      }),
    [stats.filledDays, wordsByDate, year]
  );

  const syncScrollMetrics = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const max = Math.max(0, el.scrollWidth - el.clientWidth);
    setScrollMax(max);
    setScrollLeft(Math.min(el.scrollLeft, max));
  }, []);

  // Keep the latest months in view by default (scroll right).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollLeft = el.scrollWidth;
    syncScrollMetrics();
  }, [graph.year, graph.weeks.length, syncScrollMetrics]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      setScrollLeft(el.scrollLeft);
      setScrollMax(Math.max(0, el.scrollWidth - el.clientWidth));
    };
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => syncScrollMetrics())
        : null;
    ro?.observe(el);
    el.addEventListener("scroll", onScroll, { passive: true });
    syncScrollMetrics();
    return () => {
      ro?.disconnect();
      el.removeEventListener("scroll", onScroll);
    };
  }, [syncScrollMetrics, graph.weeks.length]);

  return (
    <div className="jn-heat-year">
      <div className="jn-heat-year-top">
        <p className="jn-heat-year-summary">
          {graph.year} 年寫了 <strong>{graph.filledCount}</strong> 天
        </p>
        {years.length > 1 && (
          <div className="jn-heat-year-years" role="tablist" aria-label="選擇年份">
            {years.map((y) => (
              <button
                key={y}
                type="button"
                role="tab"
                aria-selected={y === year}
                className={`jn-heat-year-year${y === year ? " is-on" : ""}`}
                onClick={() => setYear(y)}
              >
                {y}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="jn-heat-year-frame">
        <div className="jn-heat-year-scroll" ref={scrollRef}>
          <div
            className="jn-heat-year-inner"
            style={{
              // 11px gutter + weeks * (10 cell + 3 gap)
              minWidth: `${28 + graph.weeks.length * 13}px`,
            }}
          >
            <div className="jn-heat-year-months" aria-hidden>
              <span className="jn-heat-year-corner" />
              <div className="jn-heat-year-month-track">
                {graph.monthLabels.map((m) => (
                  <span
                    key={`${m.label}-${m.weekIndex}`}
                    className="jn-heat-year-month"
                    style={{
                      left: `${m.weekIndex * 13}px`,
                    }}
                  >
                    {m.label}
                  </span>
                ))}
              </div>
            </div>

            <div className="jn-heat-year-body">
              <div className="jn-heat-year-wdays" aria-hidden>
                {Array.from({ length: 7 }, (_, row) => {
                  const mark = WEEKDAY_MARKS.find((m) => m.row === row);
                  return (
                    <span key={row} className="jn-heat-year-wday">
                      {mark?.label || ""}
                    </span>
                  );
                })}
              </div>
              <div className="jn-heat-year-grid">
                {graph.weeks.map((col, wi) => (
                  <div key={wi} className="jn-heat-col">
                    {col.map((c) => (
                      <button
                        key={c.dateKey}
                        type="button"
                        className={`jn-heat-cell level-${c.level}${c.inYear ? "" : " is-out"}`}
                        title={
                          c.inYear
                            ? `${c.dateKey}${c.level ? ` · ${c.words || "有寫"}` : " · 未寫"}`
                            : c.dateKey
                        }
                        disabled={!c.inYear}
                        onClick={() => {
                          if (c.inYear) onSelectDay?.(c.dateKey);
                        }}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {scrollMax > 0 && (
          <input
            type="range"
            className="jn-heat-year-slider"
            min={0}
            max={scrollMax}
            step={1}
            value={scrollLeft}
            aria-label="左右移動熱力圖"
            onChange={(e) => {
              const next = Number(e.target.value);
              const el = scrollRef.current;
              if (el) el.scrollLeft = next;
              setScrollLeft(next);
            }}
          />
        )}

        <div className="jn-heat-year-foot">
          <span className="jn-muted">
            {scrollMax > 0 ? "拖曳滑桿或左右滑動查看整年" : "整年已完整顯示"}
          </span>
          <div className="jn-heat-year-legend" aria-label="熱力圖例">
            <span>少</span>
            {[0, 1, 2, 3, 4].map((lv) => (
              <i key={lv} className={`jn-heat-cell level-${lv}`} />
            ))}
            <span>多</span>
          </div>
        </div>
      </div>
    </div>
  );
}
