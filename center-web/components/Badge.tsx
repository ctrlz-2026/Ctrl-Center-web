import type { ReactNode } from "react";
import type { StatusTone } from "@/lib/types";
import styles from "./Badge.module.css";

interface BadgeProps {
  tone: StatusTone;
  size?: "medium" | "small";
  children: ReactNode;
}

export function Badge({ tone, size = "small", children }: BadgeProps) {
  return (
    <span className={`${styles.badge} ${styles[size]} ${styles[tone]}`}>
      {children}
    </span>
  );
}
