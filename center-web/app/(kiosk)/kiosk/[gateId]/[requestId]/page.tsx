import Link from "next/link";
import { notFound } from "next/navigation";
import { loadKioskGate, loadKioskTask } from "@/lib/firebase/kiosk";
import { formatHeadcount } from "@/lib/rules";
import styles from "../../page.module.css";

/* 작업 확인 화면 — 고른 작업이 맞는지 보고 인증으로 넘어가는 자리입니다.
 *
 * 여기까지가 웹이 만드는 부분입니다. 아래 "다음 단계" 칸부터는 젯슨이
 * 맡습니다 — 사원증 태그, 얼굴 1:1 매칭, PPE 착용 판정이 전부 기기에서
 * 돌아가고, 웹은 lib/gate-contract.ts 계약으로 결과만 받습니다.
 * 그래서 이 화면에는 카메라도 리더기도 붙어 있지 않습니다. */
export const dynamic = "force-dynamic";

export default async function KioskTaskDetailPage({
  params,
}: {
  params: Promise<{ gateId: string; requestId: string }>;
}) {
  const { gateId, requestId } = await params;
  const gate = await loadKioskGate(gateId);
  if (!gate) notFound();

  const task = await loadKioskTask(gate.siteId, requestId);
  // 목록에서 빠진 작업(다른 사람이 먼저 시작했거나 승인이 취소됨)은 없는 페이지입니다.
  if (!task) notFound();

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <span className={styles.eyebrow}>{gate.siteName}</span>
        <h1 className={styles.title}>
          {task.code} {task.title}
        </h1>
      </div>

      <div className={styles.panel}>
        <div className={styles.row}>
          <span className={styles.rowLabel}>신청자</span>
          <span className={styles.rowValue}>
            {task.requesterName} {task.requesterRank}
          </span>
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>필요 인원</span>
          <span className={styles.rowValue}>
            {formatHeadcount(task.headcount)}
          </span>
        </div>
        <div className={styles.row}>
          <span className={styles.rowLabel}>필수 보호구</span>
          <span className={styles.ppeList}>
            {task.requiredPpe.map((p) => (
              <span key={p} className={styles.ppe}>
                {p}
              </span>
            ))}
          </span>
        </div>

        {/* 팀장이 승인하며 남긴 당부. 현장에서 읽으라고 쓴 말이라 가장 크게. */}
        {task.approveNote ? (
          <div className={styles.note}>
            <span className={styles.noteLabel}>
              {task.approverName ?? "팀장"} 전달사항
            </span>
            <span className={styles.noteBody}>{task.approveNote}</span>
          </div>
        ) : null}
      </div>

      <div className={styles.next}>
        <span className={styles.nextIcon} aria-hidden="true">
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none">
            <rect
              x="2.5"
              y="5"
              width="19"
              height="14"
              rx="2.5"
              stroke="#8FB0FF"
              strokeWidth="1.6"
            />
            <path d="M2.5 9.5h19" stroke="#8FB0FF" strokeWidth="1.6" />
            <path
              d="M6 14.5h4"
              stroke="#8FB0FF"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <span className={styles.nextTitle}>사원증을 대주세요</span>
        <p className={styles.nextBody}>
          여기부터는 기기가 확인합니다. 사원증을 읽고, 얼굴을 맞춰보고,
          보호구를 갖췄는지 봅니다. 인원이 다 차면 문이 열려요.
        </p>
        <div className={styles.steps}>
          <span className={styles.step}>1 사원증 태그</span>
          <span className={styles.step}>2 얼굴 확인</span>
          <span className={styles.step}>3 보호구 확인</span>
          <span className={styles.step}>4 문 열림</span>
        </div>
      </div>

      <div className={styles.actions}>
        <Link href={`/kiosk/${gateId}`} className={styles.back}>
          다른 작업 고르기
        </Link>
      </div>
    </div>
  );
}
