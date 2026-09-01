import Link from "next/link";
import { notFound } from "next/navigation";
import { loadKioskGate, loadKioskTasks } from "@/lib/firebase/kiosk";
import { formatHeadcount } from "@/lib/rules";
import styles from "../page.module.css";

/* 작업 선택 화면 — 키오스크의 첫 화면입니다.
 *
 * **승인된 작업만 올라옵니다.** 신청만 하고 팀장 결재가 안 난 작업은 여기
 * 아예 뜨지 않습니다. 승인이 곧 게이트 노출 조건이라, 결재 전에는 입장 시도
 * 자체가 불가능해야 하기 때문입니다.
 *
 * 세션이 이미 시작된 작업도 빠집니다 — 남아 있으면 같은 작업으로 두 번
 * 들어가게 됩니다. */
export const dynamic = "force-dynamic";

export default async function KioskTaskListPage({
  params,
}: {
  params: Promise<{ gateId: string }>;
}) {
  const { gateId } = await params;
  const gate = await loadKioskGate(gateId);
  if (!gate) notFound();

  const tasks = await loadKioskTasks(gate.siteId);

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <span className={styles.eyebrow}>작업 선택</span>
        <h1 className={styles.title}>{gate.siteName}</h1>
        <p className={styles.sub}>
          오늘 승인된 작업이에요. 들어갈 작업을 눌러주세요.
        </p>
      </div>

      {tasks.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyTitle}>승인된 작업이 없어요</span>
          <p className={styles.emptyBody}>
            고장이 아니에요. 작업을 신청하고 <strong>팀장 승인</strong>이 나면
            여기에 바로 올라옵니다.
          </p>
        </div>
      ) : (
        <div className={styles.list}>
          {tasks.map((t) => (
            <Link
              key={t.requestId}
              href={`/kiosk/${gateId}/${t.requestId}`}
              className={styles.card}
            >
              <span className={styles.code}>{t.code}</span>
              <span className={styles.cardBody}>
                <span className={styles.cardTitle}>{t.title}</span>
                <span className={styles.cardMeta}>
                  {t.requesterName} {t.requesterRank} ·{" "}
                  {formatHeadcount(t.headcount)}
                  {t.scheduledAt ? ` · ${t.scheduledAt} 예정` : ""}
                </span>
              </span>
              <span className={styles.chev} aria-hidden="true">
                →
              </span>
            </Link>
          ))}
        </div>
      )}

      <div className={styles.actions}>
        <Link href="/kiosk" className={styles.back}>
          게이트 바꾸기
        </Link>
      </div>
    </div>
  );
}
