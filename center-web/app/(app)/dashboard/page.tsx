"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { Card, CardHeader, CardTitle, Divider, InfoRow } from "@/components/Card";
import { DataTable } from "@/components/DataTable";
import type { Column } from "@/components/DataTable";
import { Primary, Side, Split, Stack } from "@/components/Layout";
import { useRequests } from "@/lib/store";
import { SITE_STATUS_LABEL, SITE_STATUS_TONE } from "@/lib/types";
import type { SiteStatus } from "@/lib/types";
import styles from "./page.module.css";

const CONTROL_LABEL = {
  unlock: "임시 문열림",
  end: "업무 종료",
} as const;

function buildColumns(
  onControl: (s: SiteStatus) => void,
  busyId: string | null,
): Column<SiteStatus>[] {
  return [
  { key: "site", header: "작업장", width: "1fr", render: (s) => s.site },
  {
    key: "state",
    header: "상태",
    width: "130px",
    render: (s) => (
      <Badge tone={SITE_STATUS_TONE[s.state]}>{SITE_STATUS_LABEL[s.state]}</Badge>
    ),
  },
  {
    key: "elapsed",
    header: "경과",
    width: "110px",
    render: (s) => (
      <span
        className={`${styles.elapsed} ${s.overtime ? styles.elapsedOver : ""}`}
      >
        {s.elapsed}
      </span>
    ),
  },
  {
    key: "headcount",
    header: "인원",
    width: "110px",
    render: (s) => s.headcount,
  },
  {
    key: "work",
    header: "작업",
    width: "1fr",
    render: (s) => (
      <span className={styles.workCell}>
        {/* 세션이 생긴 작업만 상세 페이지가 있습니다. 승인 대기(세션 없음)는
            눌러 들어갈 곳이 없어 그냥 글자로 둡니다. 행 클릭(펼치기)과 겹치지
            않게 링크 클릭은 버블링을 막습니다. */}
        {s.sessionId ? (
          <Link
            href={`/dashboard/sessions/${s.sessionId}`}
            className={styles.workTitle}
            onClick={(e) => e.stopPropagation()}
          >
            {s.work}
          </Link>
        ) : (
          <span className={styles.workTitle}>{s.work}</span>
        )}
        {/* 예정 시각은 진입을 막지 않습니다. 늦거나 일러도 통과시키고 기록만 남깁니다. */}
        {s.scheduleNote ? (
          <span className={styles.scheduleNote}>{s.scheduleNote}</span>
        ) : null}
      </span>
    ),
  },
  {
    key: "control",
    header: "제어",
    width: "130px",
    render: (s) =>
      s.control ? (
        <Button
          size="small"
          variant={s.control === "end" ? "outlined" : "solid"}
          color={s.control === "end" ? "assistive" : "primary"}
          disabled={busyId === s.id}
          onClick={(e) => {
            e.stopPropagation();
            onControl(s);
          }}
        >
          {busyId === s.id ? "처리 중" : CONTROL_LABEL[s.control]}
        </Button>
      ) : null,
  },
  ];
}

export default function DashboardPage() {
  const { dashboard, status, lastUpdatedAt, loading, gateControl } = useRequests();
  const [busyId, setBusyId] = useState<string | null>(null);
  // 어느 행을 펼쳤는지. 한 번에 하나만 — 여러 개를 열어두면 표가 길어져서
  // "지금 뭘 보고 있었는지" 잃어버리기 쉽습니다.
  const [expandedId, setExpandedId] = useState<string | null>(null);

  /* 젯슨이 없는 동안 여기서 게이트를 손으로 진행시킵니다.
     승인됨 → 임시 문열림(=작업 시작) → 업무 종료 */
  async function handleControl(s: SiteStatus) {
    if (!s.control || busyId) return;
    setBusyId(s.id);
    await gateControl(s.control, {
      requestId: s.requestId,
      sessionId: s.sessionId,
    });
    setBusyId(null);
  }

  // 화면에 뜨는 값이 전부 게이트 세션에서 계산돼 서버에서 내려옵니다.
  // 진행중 작업 수, 통과율, 이상 상황 전부 실제 데이터입니다.
  const kpis = dashboard?.kpis ?? [];
  const rows = dashboard?.siteStatuses ?? [];
  const anomalies = dashboard?.anomalies ?? [];
  const todaySummary = dashboard?.todaySummary ?? [];

  return (
    <Stack>
      <div className={styles.kpis}>
        {kpis.map((k) => (
          <Card
            key={k.label}
            padding={20}
            className={k.alert ? styles.kpiAlert : undefined}
          >
            <div className={styles.kpi}>
              <span className={styles.kpiLabel}>{k.label}</span>
              <span
                className={`${styles.kpiValue} ${
                  k.alert ? styles.kpiValueAlert : ""
                }`}
              >
                {k.value}
              </span>
              <span className={styles.kpiHint}>{k.hint}</span>
            </div>
          </Card>
        ))}
      </div>

      <Split>
        <Primary>
          <Card padding={24} gap={16}>
            <CardHeader>
              <CardTitle>작업장별 현황</CardTitle>
              {/* 폴링이 아니라 서버 push(SSE)로 갱신됩니다. 끊기면 표시가
                  --red-50 으로 바뀌고 마지막 갱신 시각을 띄웁니다 (스펙 "통신 끊김"). */}
              <span
                className={`${styles.link} ${status !== "open" ? styles.linkDown : ""}`}
                role="status"
              >
                <span className={styles.linkDot} aria-hidden="true" />
                {status === "open"
                  ? "실시간 연결됨"
                  : status === "connecting"
                    ? "연결 중"
                    : "연결 끊김"}
                {lastUpdatedAt
                  ? ` · ${new Intl.DateTimeFormat("ko-KR", {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                      hour12: false,
                    }).format(lastUpdatedAt)} 갱신`
                  : ""}
              </span>
            </CardHeader>

            <DataTable
              label="작업장별 현황"
              columns={buildColumns(handleControl, busyId)}
              rows={rows}
              rowKey={(s) => s.id}
              emptyText={loading ? "불러오는 중이에요." : "지금 진행중인 작업이 없어요."}
              onRowClick={(s) =>
                setExpandedId((cur) => (cur === s.id ? null : s.id))
              }
              isExpanded={(s) => expandedId === s.id}
              renderExpanded={(s) => (
                <div className={styles.expandGrid}>
                  <InfoRow label="작업장">{s.site}</InfoRow>
                  <InfoRow label="인원">{s.headcount}</InfoRow>
                  <InfoRow label="상태">{SITE_STATUS_LABEL[s.state]}</InfoRow>
                  {s.startedAtLabel ? (
                    <InfoRow label="시작 시각">{s.startedAtLabel}</InfoRow>
                  ) : null}
                  {s.expectedEndLabel ? (
                    <InfoRow label="예정 종료">{s.expectedEndLabel}</InfoRow>
                  ) : null}
                  {!s.sessionId ? (
                    <p className={styles.expandNote}>
                      아직 게이트가 열리지 않았어요 — &ldquo;임시 문열림&rdquo;을
                      누르면 시작 시각이 기록돼요.
                    </p>
                  ) : (
                    <Link
                      href={`/dashboard/sessions/${s.sessionId}`}
                      className={styles.expandLink}
                    >
                      자세히 보기 →
                    </Link>
                  )}
                </div>
              )}
            />
          </Card>
        </Primary>

        <Side>
          <Card padding={20} gap={12}>
            <span className={styles.sectionTitle}>이상 상황</span>
            {anomalies.length === 0 ? (
              <span className={styles.calm}>지금은 이상 상황이 없어요.</span>
            ) : null}
            {anomalies.map((a) => (
              <div
                key={a.id}
                className={`${styles.anomaly} ${
                  a.kind === "warning"
                    ? styles.anomalyWarning
                    : styles.anomalyBlocked
                }`}
              >
                <span
                  className={`${styles.anomalyTitle} ${
                    a.kind === "warning"
                      ? styles.anomalyTitleWarning
                      : styles.anomalyTitleBlocked
                  }`}
                >
                  {a.title}
                </span>
                <span className={styles.anomalyDetail}>{a.detail}</span>
              </div>
            ))}

            <Divider />

            <span className={styles.sectionTitle}>오늘 처리</span>
            {todaySummary.map((t) => (
              <InfoRow key={t.label} label={t.label}>
                {t.value}
              </InfoRow>
            ))}
          </Card>
        </Side>
      </Split>
    </Stack>
  );
}
