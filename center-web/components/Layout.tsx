import type { CSSProperties, ReactNode } from "react";
import styles from "./Layout.module.css";

export function Split({ children }: { children: ReactNode }) {
  return <div className={styles.split}>{children}</div>;
}

export function Primary({ children }: { children: ReactNode }) {
  return <div className={styles.primary}>{children}</div>;
}

export function Side({
  gap = 24,
  children,
}: {
  gap?: 16 | 24;
  children: ReactNode;
}) {
  return (
    <aside
      className={`${styles.side} ${gap === 16 ? styles.sideTight : ""}`.trim()}
    >
      {children}
    </aside>
  );
}

/** 폭이 고정된 열 (W5 좌 300 / 우 340). */
export function FixedColumn({
  width,
  as = "div",
  children,
}: {
  width: number;
  as?: "div" | "aside";
  children: ReactNode;
}) {
  const Tag = as;
  return (
    <Tag
      className={styles.fixed}
      style={{ "--col-width": `${width}px` } as CSSProperties}
    >
      {children}
    </Tag>
  );
}

export function Stack({ children }: { children: ReactNode }) {
  return <div className={styles.stack}>{children}</div>;
}

export function PageTitle({ children }: { children: ReactNode }) {
  return <h1 className={styles.pageTitle}>{children}</h1>;
}
