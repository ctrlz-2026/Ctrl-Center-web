import type { ReactNode } from "react";
import styles from "./Chip.module.css";

export function ChipGroup({ children }: { children: ReactNode }) {
  return (
    <div className={styles.group} role="group">
      {children}
    </div>
  );
}

export function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`${styles.chip} ${active ? styles.on : styles.off}`}
    >
      {children}
    </button>
  );
}
