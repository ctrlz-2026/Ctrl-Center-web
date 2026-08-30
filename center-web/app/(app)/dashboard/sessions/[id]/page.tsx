"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge } from "@/components/Badge";
import { Card, CardHeader, CardTitle, InfoRow } from "@/components/Card";
import { PageTitle, Stack } from "@/components/Layout";
import { useRequests } from "@/lib/store";
import { SITE_STATUS_LABEL, SITE_STATUS_TONE } from "@/lib/types";
import styles from "./page.module.css";

/* 작업장별 현황(W4)에서 작업 제목을 눌러 들어오는 상세 페이지.
 *
 * 지금은 세션 정보(작업장·인원·시작/예정종료 시각)만 보여주는 **틀**입니다.
 * 젯슨에서 실제로 문이 열렸다는 신호가 오면 작업자가 들어가 작업하는
 * 시뮬레이션을 붙이기로 했는데(천호 담당), 그 부분은 아래 "placeholder"
 * 자리에 나중에 끼워 넣으면 됩니다 — 이 페이지의 라우팅·데이터 연결만
 * 미리 만들어 둔 상태입니다. */

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { dashboard, loading } = useRequests();

  const session = dashboard?.siteStatuses.find((s) => s.sessionId === id);

  if (!session) {
    return (
      <Stack>
        <div className={styles.empty}>
          <PageTitle>세션 상세</PageTitle>
          <p>
            {loading
              ? "불러오는 중이에요."
              : "이 세션을 찾을 수 없어요 — 이미 종료됐거나 주소가 잘못됐을 수 있어요."}
          </p>
          <Link href="/dashboard" className={styles.back}>
            ← 작업장별 현황으로
          </Link>
        </div>
      </Stack>
    );
  }

  return (
    <Stack>
      <Link href="/dashboard" className={styles.back}>
        ← 작업장별 현황으로
      </Link>

      <div className={styles.headRow}>
        <PageTitle>{session.work}</PageTitle>
        <Badge tone={SITE_STATUS_TONE[session.state]}>
          {SITE_STATUS_LABEL[session.state]}
        </Badge>
      </div>
      <span className={styles.site}>{session.site}</span>

      <Card padding={24} gap={16}>
        <CardHeader>
          <CardTitle>세션 정보</CardTitle>
        </CardHeader>
        <div className={styles.infoGrid}>
          <InfoRow label="인원">{session.headcount}</InfoRow>
          <InfoRow label="경과">{session.elapsed}</InfoRow>
          {session.startedAtLabel ? (
            <InfoRow label="시작 시각">{session.startedAtLabel}</InfoRow>
          ) : null}
          {session.expectedEndLabel ? (
            <InfoRow label="예정 종료">{session.expectedEndLabel}</InfoRow>
          ) : null}
          {session.scheduleNote ? (
            <InfoRow label="예정 대비">{session.scheduleNote}</InfoRow>
          ) : null}
        </div>
      </Card>

      <Card padding={24} gap={16}>
        <CardHeader>
          <CardTitle>게이트 시뮬레이션</CardTitle>
        </CardHeader>
        <div className={styles.placeholder}>
          <span className={styles.placeholderTitle}>🚧 준비 중인 자리</span>
          <p className={styles.placeholderBody}>
            젯슨 오린에서 &ldquo;문이 열렸다&rdquo; 신호가 오면, 작업자가 문
            앞에서 기다리다가 들어가 작업을 시작하는 과정을 여기서 화면으로
            보여줄 예정이에요. 지금은 라우팅과 세션 데이터 연결까지만 만들어둔
            상태이고, 실제 시뮬레이션 UI는 천호 님이 붙이기로 했어요.
          </p>
        </div>
      </Card>
    </Stack>
  );
}
