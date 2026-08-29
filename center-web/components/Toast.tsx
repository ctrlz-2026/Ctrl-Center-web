"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./Toast.module.css";

/** 토스트 1개만 띄우는 최소 훅. 3초 후 자동 소멸이 스펙입니다.
 *  같은 문구를 연달아 띄울 때도 타이머가 다시 시작되도록 nonce 를 함께 둡니다
 *  (특이사항 저장은 같은 문구를 반복해서 띄우는 자리라 실제로 필요합니다). */
export function useToast(duration = 3000) {
  const [state, setState] = useState<{ text: string; nonce: number } | null>(
    null,
  );

  useEffect(() => {
    if (state === null) return;
    const timer = window.setTimeout(() => setState(null), duration);
    return () => window.clearTimeout(timer);
  }, [state, duration]);

  const show = useCallback((text: string) => {
    setState({ text, nonce: Date.now() });
  }, []);

  return { message: state?.text ?? null, show };
}

export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className={styles.toast} role="status" aria-live="polite">
      {message}
    </div>
  );
}
