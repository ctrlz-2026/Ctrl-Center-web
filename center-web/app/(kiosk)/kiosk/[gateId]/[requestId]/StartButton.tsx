"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "../../page.module.css";

/** 「이 작업으로 입장 시작」. 서버에 선택을 적고 진행 화면으로 넘어갑니다. */
export function StartButton({
  gateId,
  requestId,
}: {
  gateId: string;
  requestId: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/kiosk/${gateId}/select`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestId }),
    });
    if (res.ok) {
      router.push(`/kiosk/${gateId}/${requestId}/live`);
      return;
    }
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    setError(body?.error ?? "시작하지 못했어요. 잠시 후 다시 눌러주세요.");
    setBusy(false);
  }

  return (
    <div className={styles.startWrap}>
      <button type="button" className={styles.primary} onClick={start} disabled={busy}>
        {busy ? "준비 중…" : "이 작업으로 입장 시작"}
      </button>
      {error ? <p className={styles.error}>{error}</p> : null}
    </div>
  );
}
