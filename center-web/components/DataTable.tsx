"use client";

import type { ReactNode } from "react";
import styles from "./DataTable.module.css";

export interface Column<T> {
  key: string;
  header: string;
  /** grid-template-columns 에 그대로 들어갑니다 (예: "120px", "1fr"). */
  width: string;
  align?: "left" | "right" | "center";
  render: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  label: string;
  onRowClick?: (row: T) => void;
  isSelected?: (row: T) => boolean;
  isMuted?: (row: T) => boolean;
  emptyText?: string;
  /** 행을 펼쳤을 때 표 아래에 끼워 넣을 내용. `isExpanded` 와 같이 씁니다. */
  renderExpanded?: (row: T) => ReactNode;
  isExpanded?: (row: T) => boolean;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  label,
  onRowClick,
  isSelected,
  isMuted,
  emptyText = "표시할 항목이 없어요.",
  renderExpanded,
  isExpanded,
}: DataTableProps<T>) {
  const template = columns.map((c) => c.width).join(" ");

  return (
    <div className={styles.wrap} role="table" aria-label={label}>
      <div
        className={styles.head}
        role="row"
        style={{ gridTemplateColumns: template }}
      >
        {columns.map((c) => (
          <span
            key={c.key}
            role="columnheader"
            className={cellClass(c.align)}
          >
            {c.header}
          </span>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className={styles.empty} role="row">
          <span role="cell">{emptyText}</span>
        </div>
      ) : (
        rows.map((row) => {
          const selected = isSelected?.(row) ?? false;
          const muted = isMuted?.(row) ?? false;
          const classes = [
            styles.row,
            onRowClick && !muted ? styles.clickable : "",
            selected ? styles.selected : "",
            muted ? styles.muted : "",
          ]
            .filter(Boolean)
            .join(" ");

          const content = columns.map((c) => (
            <span key={c.key} role="cell" className={cellClass(c.align)}>
              {c.render(row)}
            </span>
          ));

          // 행 클릭이 곧 선택인 화면(W2 작업코드, W3 승인함, W5 이력, W4 펼치기)이
          // 있습니다. 행을 button 으로 내면 셀 안의 링크·버튼이 버튼 안에 중첩돼
          // 유효하지 않은 마크업이 되므로, div 에 tabIndex 와 키 핸들러를 달아
          // 키보드 동작만 button 과 맞춥니다.
          const rowEl =
            onRowClick && !muted ? (
              <div
                key={rowKey(row)}
                role="row"
                tabIndex={0}
                aria-selected={selected}
                className={classes}
                style={{ gridTemplateColumns: template }}
                onClick={() => onRowClick(row)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onRowClick(row);
                  }
                }}
              >
                {content}
              </div>
            ) : (
              <div
                key={rowKey(row)}
                role="row"
                className={classes}
                style={{ gridTemplateColumns: template }}
              >
                {content}
              </div>
            );

          const expanded = isExpanded?.(row) ?? false;
          if (!renderExpanded || !expanded) return rowEl;

          return (
            <div key={rowKey(row)} className={styles.expandGroup}>
              {rowEl}
              <div role="row" className={styles.expandedRow}>
                {renderExpanded(row)}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

function cellClass(align: Column<unknown>["align"]) {
  if (align === "right") return `${styles.cell} ${styles.alignRight}`;
  if (align === "center") return `${styles.cell} ${styles.alignCenter}`;
  return styles.cell;
}
