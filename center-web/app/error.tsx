"use client";

import { useEffect } from "react";

/** 화면에서 예외가 터졌을 때. 스펙 문안 규칙대로 무엇이 고장났는지가 아니라
 *  무엇을 하라고 씁니다. 원인은 콘솔로 넘깁니다. */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 24,
      }}
    >
      <div style={{ textAlign: "center", display: "grid", gap: 12 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.023em" }}>
          화면을 불러오지 못했어요
        </h1>
        <p
          style={{
            fontSize: 15,
            fontWeight: 500,
            color: "var(--label-alternative)",
          }}
        >
          잠시 후 다시 시도해 주세요. 계속 같으면 안전관리팀 내선 2114로 알려주세요.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            justifySelf: "center",
            marginTop: 8,
            height: 40,
            padding: "0 20px",
            borderRadius: 10,
            background: "var(--primary-normal)",
            color: "var(--static-white)",
            fontSize: 15,
            fontWeight: 600,
          }}
        >
          다시 시도
        </button>
      </div>
    </main>
  );
}
