"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/Badge";
import { Card, CardHeader, CardTitle, Divider, InfoRow } from "@/components/Card";
import { Chip, ChipGroup } from "@/components/Chip";
import { DataTable } from "@/components/DataTable";
import type { Column } from "@/components/DataTable";
import { Primary, Side, Split, Stack } from "@/components/Layout";
import { useRequests } from "@/lib/store";
import {
  SITE_BOARD_LABEL,
  SITE_STATUS_ACCENT,
  SITE_STATUS_LABEL,
  SITE_STATUS_TONE,
} from "@/lib/types";
import type { SiteBoardTile, SiteStatus } from "@/lib/types";
import styles from "./page.module.css";

/* W4 · 전체 현황.
 *
 * 2026-09-27 개편. 관제는 **보는 화면**으로 정리했습니다.
 *   - 문을 열고 작업을 끝내는 버튼은 키오스크로 옮겼습니다. 대신 작업장마다
 *     그 게이트의 키오스크 화면으로 바로 가는 링크를 둡니다.
 *   - 작업장 7곳을 고정 자리에 두는 보드를 맨 위에 둡니다. 표를 다 읽지 않아도
 *     "어디가 바쁘고 어디가 비었는지"가 위치로 보입니다.
 *   - 진행중 작업을 누르면 세션 상세(게이트 시뮬레이션 자리)로 갑니다. */

type Filter = "all" | "live" | "waiting";

/** 경과 / 예상시간 막대. 넘으면 주황으로 바뀌고 100% 에서 멈춥니다. */
function Progress({ value, over }: { value: number | null; over: boolean }) {
  if (value === null) return null;
  return (
    <span className={styles.bar} aria-hidden="true">
      <span
        className={`${styles.barFill} ${over ? styles.barOver : ""}`}
        style={{ width: `${Math.min(100, Math.round(value * 100))}%` }}
      />
    </span>
  );
}

function KioskLink({ gateId, label = "키오스크" }: { gateId: string | null; label?: string }) {
  if (!gateId) return null;
  return (
    <a
      href={`/kiosk/${gateId}`}
      target="_blank"
      rel="noreferrer"
      className={styles.kioskLink}
      onClick={(e) => e.stopPropagation()}
    >
      {label} ↗
    </a>
  );
}

function BoardTile({ t }: { t: SiteBoardTile }) {
  const first = t.working[0];
  return (
    <div className={`${styles.tile} ${styles[`tile_${t.state}`]}`}>
      <div className={styles.tileHead}>
        <span className={styles.tileSite}>{t.siteName}</span>
        <span className={`${styles.tileState} ${styles[`state_${t.state}`]}`}>
          {SITE_BOARD_LABEL[t.state]}
          {t.alertCount > 1 ? ` ${t.alertCount}` : ""}
        </span>
      </div>

      {first ? (
        <Link href={`/dashboard/sessions/${first.sessionId}`} className={styles.tileWork}>
          <span className={styles.tileWorkTitle}>{first.work}</span>
          <span className={styles.tileMeta}>
            인원 {first.headcount} · {first.elapsed}
            {first.overtime ? " (초과)" : ""}
          </span>
          <Progress value={first.progress} over={first.overtime} />
        </Link>
      ) : (
        <span className={styles.tileEmpty}>
          {t.waitingCount > 0
            ? `입장 대기 ${t.waitingCount}건${t.nextLabel ? ` · ${t.nextLabel} 예정` : ""}`
            : "오늘 남은 작업 없음"}
        </span>
      )}

      <div className={styles.tileFoot}>
        <span className={styles.tileFootNote}>
          {t.working.length > 1
            ? `외 ${t.working.length - 1}건 진행중`
            : first && t.waitingCount > 0
              ? `다음 대기 ${t.waitingCount}건`
              : ""}
        </span>
        <KioskLink gateId={t.gateId} />
      </div>
    </div>
  );
}

const COLUMNS: Column<SiteStatus>[] = [
  { key: "site", header: "작업장", width: "1fr", render: (s) => s.site },
  {
    key: "state",
    header: "상태",
    width: "92px",
    render: (s) => (
      <Badge tone={SITE_STATUS_TONE[s.state]}>{SITE_STATUS_LABEL[s.state]}</Badge>
    ),
  },
  {
    key: "work",
    header: "작업",
    width: "1.3fr",
    render: (s) => (
      <span className={styles.workCell}>
        <span className={styles.workTitle}>{s.work}</span>
        <span className={styles.scheduleNote}>
          {s.state === "approved"
            ? `${s.members[0] ?? ""} 신청${s.scheduledLabel ? ` · ${s.scheduledLabel} 예정` : ""}`
            : s.members.join(", ")}
        </span>
      </span>
    ),
  },
  { key: "headcount", header: "인원", width: "76px", render: (s) => s.headcount },
  {
    key: "elapsed",
    header: "경과",
    width: "132px",
    render: (s) =>
      s.state === "approved" ? (
        <KioskLink gateId={s.gateId} label="키오스크에서 시작" />
      ) : (
        <span className={styles.elapsedCell}>
          <span className={`${styles.elapsed} ${s.overtime ? styles.elapsedOver : ""}`}>
            {s.elapsed}
            {s.expectedEndLabel ? (
              <span className={styles.elapsedHint}> / {s.expectedEndLabel}까지</span>
            ) : null}
          </span>
          <Progress value={s.progress} over={s.overtime} />
        </span>
      ),
  },
];

const ANOMALY_PREVIEW = 4;

export default function DashboardPage() {
  const router = useRouter();
  const { dashboard, status, lastUpdatedAt, loading } = useRequests();
  const [filter, setFilter] = useState<Filter>("all");
  const [showAllAnomalies, setShowAllAnomalies] = useState(false);

  // 화면에 뜨는 값이 전부 게이트 세션·승인 요청에서 계산돼 서버에서 내려옵니다.
  const kpis = dashboard?.kpis ?? [];
  const board = dashboard?.board ?? [];
  const rows = dashboard?.siteStatuses ?? [];
  const anomalies = dashboard?.anomalies ?? [];
  const todaySummary = dashboard?.todaySummary ?? [];

  const liveRows = rows.filter((r) => r.state !== "approved");
  const waitingRows = rows.filter((r) => r.state === "approved");
  const shown = filter === "live" ? liveRows : filter === "waiting" ? waitingRows : rows;
  const visibleAnomalies = showAllAnomalies
    ? anomalies
    : anomalies.slice(0, ANOMALY_PREVIEW);

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
                className={`${styles.kpiValue} ${k.alert ? styles.kpiValueAlert : ""}`}
              >
                {k.value}
              </span>
              <span className={styles.kpiHint}>{k.hint}</span>
            </div>
          </Card>
        ))}
      </div>

      <Card padding={24} gap={16}>
        <CardHeader>
          <CardTitle>작업장 한눈에 보기</CardTitle>
          <div className={styles.headTools}>
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
                  }).format(lastUpdatedAt)}`
                : ""}
            </span>
            {/* 현장 화면으로 가는 입구. 관제는 보는 곳이고, 문을 여닫는 건
                키오스크에서 합니다. 새 탭으로 열어 관제 화면을 잃지 않게 합니다. */}
            <a href="/kiosk" target="_blank" rel="noreferrer" className={styles.kioskButton}>
              키오스크 화면 열기 ↗
            </a>
          </div>
        </CardHeader>

        {loading ? (
          <span className={styles.calm}>불러오는 중이에요.</span>
        ) : (
          <div className={styles.board}>
            {board.map((t) => (
              <BoardTile key={t.siteId} t={t} />
            ))}
          </div>
        )}
      </Card>

      <Split>
        <Primary>
          <Card padding={24} gap={16}>
            <CardHeader>
              <CardTitle>작업 목록</CardTitle>
              <ChipGroup>
                <Chip active={filter === "all"} onClick={() => setFilter("all")}>
                  전체 {rows.length}
                </Chip>
                <Chip active={filter === "live"} onClick={() => setFilter("live")}>
                  진행중 {liveRows.length}
                </Chip>
                <Chip active={filter === "waiting"} onClick={() => setFilter("waiting")}>
                  입장 대기 {waitingRows.length}
                </Chip>
              </ChipGroup>
            </CardHeader>

            <DataTable
              label="작업 목록"
              columns={COLUMNS}
              rows={shown}
              rowKey={(s) => s.id}
              emptyText={
                loading
                  ? "불러오는 중이에요."
                  : filter === "waiting"
                    ? "오늘 입장을 기다리는 작업이 없어요."
                    : "지금 진행중인 작업이 없어요."
              }
              // 진행중 작업만 눌러 들어갈 곳(세션 상세)이 있습니다.
              onRowClick={(s) => {
                if (s.sessionId) router.push(`/dashboard/sessions/${s.sessionId}`);
              }}
              isMuted={(s) => !s.sessionId}
              rowAccent={(s) => SITE_STATUS_ACCENT[s.state]}
            />
            <p className={styles.tableHint}>
              진행중인 작업을 누르면 게이트 상세로 들어가요. 입장 대기 작업은
              현장 키오스크에서 시작합니다.
            </p>
          </Card>
        </Primary>

        <Side>
          <Card padding={20} gap={12}>
            <span className={styles.sectionTitle}>
              확인 필요 {anomalies.length > 0 ? anomalies.length : ""}
            </span>
            {anomalies.length === 0 ? (
              <span className={styles.calm}>지금 확인할 일이 없어요.</span>
            ) : null}
            {visibleAnomalies.map((a) => {
              const body = (
                <>
                  <span className={styles.anomalyTop}>
                    <span
                      className={`${styles.anomalyTitle} ${
                        a.kind === "warning"
                          ? styles.anomalyTitleWarning
                          : styles.anomalyTitleBlocked
                      }`}
                    >
                      {a.title}
                    </span>
                    {a.atLabel ? <span className={styles.anomalyAt}>{a.atLabel}</span> : null}
                  </span>
                  <span className={styles.anomalySite}>{a.siteName}</span>
                  <span className={styles.anomalyDetail}>{a.detail}</span>
                </>
              );
              const cls = `${styles.anomaly} ${
                a.kind === "warning" ? styles.anomalyWarning : styles.anomalyBlocked
              }`;
              return a.sessionId ? (
                <Link
                  key={a.id}
                  href={`/dashboard/sessions/${a.sessionId}`}
                  className={`${cls} ${styles.anomalyLink}`}
                >
                  {body}
                </Link>
              ) : (
                <div key={a.id} className={cls}>
                  {body}
                </div>
              );
            })}
            {anomalies.length > ANOMALY_PREVIEW ? (
              <button
                type="button"
                className={styles.moreButton}
                onClick={() => setShowAllAnomalies((v) => !v)}
              >
                {showAllAnomalies
                  ? "접기"
                  : `${anomalies.length - ANOMALY_PREVIEW}건 더 보기`}
              </button>
            ) : null}

            <Divider />

            <span className={styles.sectionTitle}>오늘</span>
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
