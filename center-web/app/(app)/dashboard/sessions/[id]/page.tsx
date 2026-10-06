"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge } from "@/components/Badge";
import { Card, CardHeader, CardTitle, InfoRow } from "@/components/Card";
import { GateSimulation } from "@/components/GateSimulation";
import { PageTitle, Stack } from "@/components/Layout";
import { useRequests } from "@/lib/store";
import { SITE_STATUS_LABEL, SITE_STATUS_TONE } from "@/lib/types";
import styles from "./page.module.css";

/* 전체 현황(W4)에서 진행중 작업을 눌러 들어오는 상세 페이지.
 *
 * 위: 세션 정보 / 아래: 게이트 3D 시뮬레이션(천호 님의 Unity 빌드, components/GateSimulation).
 * 값은 관제 실시간 스트림에서 오므로 키오스크에서 상태가 바뀌면 이 화면도
 * 새로고침 없이 따라 바뀝니다.
 *
 * 관제는 보는 화면이라 여기에도 제어 버튼은 없습니다. 이 작업을 끝내거나
 * 현장 상황을 보려면 그 게이트의 키오스크 화면으로 갑니다. */

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { dashboard, loading } = useRequests();

  const session = dashboard?.siteStatuses.find((s) => s.sessionId === id);

  if (!session) {
    return (
      <Stack>
        <div className={styles.empty}>
          <PageTitle>작업 상세</PageTitle>
          <p>
            {loading
              ? "불러오는 중이에요."
              : "이 작업을 찾을 수 없어요 — 이미 종료됐거나 주소가 잘못됐을 수 있어요."}
          </p>
          <Link href="/dashboard" className={styles.back}>
            ← 전체 현황으로
          </Link>
        </div>
      </Stack>
    );
  }

  const [entered, required] = session.headcount
    .replace("명", "")
    .split("/")
    .map((n) => Number(n.trim()));

  return (
    <Stack>
      <Link href="/dashboard" className={styles.back}>
        ← 전체 현황으로
      </Link>

      <div className={styles.headRow}>
        <PageTitle>{session.work}</PageTitle>
        <Badge tone={SITE_STATUS_TONE[session.state]}>
          {SITE_STATUS_LABEL[session.state]}
        </Badge>
        {session.gateId ? (
          <a
            href={
              session.requestId
                ? `/kiosk/${session.gateId}/${session.requestId}/live`
                : `/kiosk/${session.gateId}`
            }
            target="_blank"
            rel="noreferrer"
            className={styles.kiosk}
          >
            이 게이트 키오스크 보기 ↗
          </a>
        ) : null}
      </div>
      <span className={styles.site}>{session.site}</span>

      <Card padding={24} gap={16}>
        <CardHeader>
          <CardTitle>작업 정보</CardTitle>
        </CardHeader>
        <div className={styles.infoGrid}>
          <InfoRow label="인원">{session.headcount}</InfoRow>
          <InfoRow label="참여자">{session.members.join(", ") || "—"}</InfoRow>
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
        <GateSimulation
          state={session.state}
          siteName={session.site}
          work={session.work}
          required={Number.isFinite(required) ? required : 0}
          entered={Number.isFinite(entered) ? entered : 0}
          members={session.members}
          crew={session.crew}
          elapsed={session.elapsed}
          progress={session.progress}
        />
      </Card>
    </Stack>
  );
}
