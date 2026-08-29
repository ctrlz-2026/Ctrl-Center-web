import type { ButtonHTMLAttributes } from "react";
import styles from "./Button.module.css";

export type ButtonSize = "large" | "medium" | "small";
export type ButtonVariant = "solid" | "outlined";
export type ButtonColor = "primary" | "assistive";

const SURFACE: Record<`${ButtonVariant}-${ButtonColor}`, string> = {
  "solid-primary": styles.solidPrimary,
  "solid-assistive": styles.solidAssistive,
  "outlined-primary": styles.outlinedPrimary,
  "outlined-assistive": styles.outlinedAssistive,
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: ButtonSize;
  variant?: ButtonVariant;
  color?: ButtonColor;
  fullWidth?: boolean;
}

export function Button({
  size = "large",
  variant = "solid",
  color = "primary",
  fullWidth = false,
  className,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  const classes = [
    styles.btn,
    styles[size],
    SURFACE[`${variant}-${color}`],
    fullWidth ? styles.fullWidth : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  );
}
