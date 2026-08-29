import type { CSSProperties, ReactNode } from "react";
import styles from "./Card.module.css";

interface CardProps {
  /** 데스크톱 카드 내부 여백 기본 20, 폼 카드는 24, 표를 담을 땐 0. */
  padding?: 0 | 20 | 24;
  gap?: 12 | 16 | 24;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

export function Card({
  padding = 20,
  gap,
  className,
  style,
  children,
}: CardProps) {
  const classes = [
    styles.card,
    styles[`pad${padding}` as keyof typeof styles],
    gap ? styles[`gap${gap}` as keyof typeof styles] : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={classes} style={style}>
      {children}
    </section>
  );
}

export function CardHeader({ children }: { children: ReactNode }) {
  return <header className={styles.header}>{children}</header>;
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <h2 className={styles.title}>{children}</h2>;
}

export function InfoRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.infoRow}>
      <span className={styles.infoLabel}>{label}</span>
      <span className={styles.infoValue}>{children}</span>
    </div>
  );
}

export function Divider() {
  return <div className={styles.divider} role="separator" />;
}
