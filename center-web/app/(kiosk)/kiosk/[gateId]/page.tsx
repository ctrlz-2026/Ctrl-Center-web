import Link from "next/link";
import { notFound } from "next/navigation";
import {
  loadKioskGate,
  loadKioskTasks,
  loadKioskWorking,
} from "@/lib/firebase/kiosk";
import { formatHeadcount } from "@/lib/rules";
import styles from "../page.module.css";

/* 작업 선택 화면 — 키오스크의 첫 화면입니다.
 *
 * 위: 지금 이 문 안에서 **작업 중인 것** — 끝내러 나온 사람이 자기 작업을
 *     바로 찾아 「작업 종료」로 갈 수 있게 먼저 보여줍니다.
 * 아래: 오늘 승인된 작업 — 들어갈 작업을 고릅니다.
 *
 * **승인된 작업만 올라옵니다.** 신청만 하고 팀장 결재가 안 난 작업은 여기
 * 아예 뜨지 않습니다. 승인이 곧 게이트 노출 조건이라, 결재 전에는 입장 시도
 * 자체가 불가능해야 하기 때문입니다. */
export const dynamic = "force-dynamic";

export default async function KioskTaskListPage({
  params,
}: {
  params: Promise<{ gateId: string }>;
}) {
  const { gateId } = await params;
  const gate = await loadKioskGate(gateId);
  if (!gate) notFound();

  const [tasks, working] = await Promise.all([
    loadKioskTasks(gate.siteId),
    loadKioskWorking(gate.siteId),
  ]);

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <span className={styles.eyebrow}>작업 선택</span>
        <h1 className={styles.title}>{gate.siteName}</h1>
        <p className={styles.sub}>
          오늘 승인된 작업이에요. 들어갈 작업을 눌러주세요.
        </p>
      </div>

      {working.length > 0 ? (
        <div className={styles.section}>
          <span className={styles.sectionLabel}>지금 작업 중</span>
          <div className={styles.list}>
            {working.map((w) => (
              <Link
                key={w.sessionId}
                // 요청 없이 열린 옛 세션은 진행 화면으로 갈 수 없어 목록에만 둡니다.
                href={w.requestId ? `/kiosk/${gateId}/${w.requestId}/live` : `/kiosk/${gateId}`}
                className={`${styles.card} ${styles.cardWorking}`}
              >
                <span className={`${styles.code} ${styles.codeWorking}`}>{w.code}</span>
                <span className={styles.cardBody}>
                  <span className={styles.cardTitle}>{w.title}</span>
                  <span className={styles.cardMeta}>
                    {w.members.join(", ")} ·{" "}
                    <span className={w.overtime ? styles.overtime : undefined}>
                      {w.elapsed}째
                    </span>
                  </span>
                </span>
                <span className={styles.cardAction}>종료하기</span>
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      {tasks.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyTitle}>들어갈 수 있는 작업이 없어요</span>
          <p className={styles.emptyBody}>
            고장이 아니에요. 작업을 신청하고 <strong>팀장 승인</strong>이 나면
            여기에 바로 올라옵니다.
          </p>
        </div>
      ) : (
        <div className={styles.section}>
          {working.length > 0 ? (
            <span className={styles.sectionLabel}>들어갈 작업</span>
          ) : null}
          <div className={styles.grid}>
            {tasks.map((t) => (
              <Link
                key={t.requestId}
                href={`/kiosk/${gateId}/${t.requestId}`}
                className={styles.tile}
              >
                <span className={styles.tileCode}>{t.code}</span>
                <span className={styles.tileTitle}>{t.title}</span>
                {/* 전달사항이 있다는 사실은 타일에서부터 알립니다 —
                    들어가서야 알면 이미 문 앞입니다. */}
                {t.approveNote ? (
                  <span className={styles.tileFlag}>전달사항 있음</span>
                ) : null}
                <span className={styles.tileMeta}>
                  <span>
                    {t.requesterName} {t.requesterRank} ·{" "}
                    {formatHeadcount(t.headcount)}
                  </span>
                  {/* 오늘이 아닌 작업도 목록에서 빼지 않습니다 — 예정 시각은 진입을
                      막지 않습니다. 대신 날짜를 붙여 다른 날 작업임을 드러냅니다. */}
                  {t.scheduledAt ? (
                    <span className={t.scheduledOtherDay ? styles.otherDay : undefined}>
                      {t.scheduledAt} 예정
                    </span>
                  ) : null}
                </span>
              </Link>
            ))}
          </div>
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
