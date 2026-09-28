import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { loadKioskGate, loadKioskRequest, loadKioskTask } from "@/lib/firebase/kiosk";
import { formatHeadcount } from "@/lib/rules";
import { StartButton } from "./StartButton";
import styles from "../../page.module.css";

/* 작업 확인 화면 — 고른 작업이 맞는지 보고 입장을 시작하는 자리입니다.
 *
 * 「이 작업으로 입장 시작」을 누르면 서버가 이 게이트의 "지금 검증할 작업"을
 * 적어 두고(젯슨이 이걸 읽습니다) 진행 화면으로 넘어갑니다. 사원증 태그 ·
 * 얼굴 1:1 매칭 · PPE 판정은 젯슨이 하고, 웹은 lib/gate-contract.ts 계약으로
 * 결과만 받습니다. */
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
  if (!task) {
    // 목록에서 빠진 건 이미 문이 열린 작업일 수 있습니다 — 그러면 진행 화면으로.
    const opened = await loadKioskRequest(gate.siteId, requestId);
    if (opened) redirect(`/kiosk/${gateId}/${requestId}/live`);
    notFound();
  }

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

      <StartButton gateId={gateId} requestId={requestId} />

      <div className={styles.actions}>
        <Link href={`/kiosk/${gateId}`} className={styles.back}>
          다른 작업 고르기
        </Link>
      </div>
    </div>
  );
}
