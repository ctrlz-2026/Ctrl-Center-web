import Link from "next/link";
import { loadKioskGates } from "@/lib/firebase/kiosk";
import styles from "./page.module.css";

/* 키오스크를 어느 문에 붙일지 고르는 화면.
 *
 * 실제 설치된 기기는 이 화면을 한 번만 보고 그 뒤로는 자기 게이트 주소를
 * 그대로 띄웁니다 (`/kiosk/gate-b2`). 시연·개발 중에 게이트를 바꿔가며
 * 보려고 남겨둔 입구입니다. */
export const dynamic = "force-dynamic";

export default async function KioskGatePickerPage() {
  const gates = await loadKioskGates();

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <span className={styles.eyebrow}>CENTER KIOSK</span>
        <h1 className={styles.title}>이 기기를 설치할 게이트</h1>
        <p className={styles.sub}>
          한 번 고르면 그 게이트의 작업 목록이 뜹니다.
        </p>
      </div>

      <div className={styles.list}>
        {gates.map((g) => (
          <Link
            key={g.gateId}
            href={`/kiosk/${g.gateId}`}
            className={styles.card}
          >
            <span className={styles.code}>
              {/* 게이트 식별자의 뒷자리만 크게 (gate-b2 → B2) */}
              {g.gateId.replace(/^gate-/, "").toUpperCase()}
            </span>
            <span className={styles.cardBody}>
              <span className={styles.cardTitle}>{g.siteName}</span>
              <span className={styles.cardMeta}>{g.gateId}</span>
            </span>
            <span className={styles.chev} aria-hidden="true">
              →
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
