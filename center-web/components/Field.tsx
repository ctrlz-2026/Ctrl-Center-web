"use client";

import { useId } from "react";
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import styles from "./Field.module.css";

interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

export function TextField({ label, error, id, ...rest }: TextFieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={fieldId}>
        {label}
      </label>
      <input
        id={fieldId}
        className={`${styles.control} ${styles.input}`}
        aria-invalid={error ? true : undefined}
        {...rest}
      />
      {error ? <p className={styles.error}>{error}</p> : null}
    </div>
  );
}

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  /** 스펙상 요청 사유 96, 반려 사유 80, 특이사항 140. */
  height?: number;
}

export function TextArea({
  label,
  height = 140,
  id,
  style,
  ...rest
}: TextAreaProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;

  return (
    <div className={styles.field}>
      {label ? (
        <label className={styles.label} htmlFor={fieldId}>
          {label}
        </label>
      ) : null}
      <textarea
        id={fieldId}
        className={`${styles.control} ${styles.textarea}`}
        style={{ height, ...style }}
        {...rest}
      />
    </div>
  );
}

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  options: { value: string; label: string }[];
}

/** 입력과 같은 치수(48 / radius 12 / inset 경계선)를 쓰는 선택 필드. */
export function SelectField({
  label,
  options,
  id,
  ...rest
}: SelectFieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;

  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={fieldId}>
        {label}
      </label>
      <select
        id={fieldId}
        className={`${styles.control} ${styles.input} ${styles.select}`}
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** 선택으로 채워지는 읽기 전용 값 자리. */
export function Readout({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className={styles.field}>
      <span className={styles.label}>{label}</span>
      <div className={`${styles.control} ${styles.readout}`}>
        <span>{value}</span>
        {hint ? <span className={styles.readoutHint}>{hint}</span> : null}
      </div>
    </div>
  );
}
