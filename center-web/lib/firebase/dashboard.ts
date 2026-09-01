import "server-only";

import { adminDb } from "./admin";
import { loadMasters } from "./queries";
import type { Anomaly, SiteStatus } from "@/lib/types";

/* 관제 화면 데이터. 전부 gateSessions 에서 계산합니다.
 *
 * 하드코딩된 목업이 아니라 실제 세션을 읽으므로, 젯슨이 세션을 만들기 시작하면
 * 이 코드는 그대로 두고 데이터만 진짜로 바뀝니다. */

export interface DashboardData {
  /** hint 는 KPI 라벨만 보고 뜻을 짐작하기 어려운 값(입장 인원 · 1차 검증 통과율)이
   *  헷갈린다는 피드백을 받아 추가했습니다 — 라벨 아래 한 줄로 뭘 세는 값인지 밝힙니다. */
  kpis: { label: string; value: string; alert: boolean; hint: string }[];
  siteStatuses: SiteStatus[];
  anomalies: Anomaly[];
  todaySummary: { label: string; value: string }[];
}

const hhmm = new Intl.DateTimeFormat("ko-KR", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Seoul",
});

const LIVE_STATES = ["tagging", "face", "verifying", "unlocking", "working"];

/** 예상시간을 이만큼 넘기면 "종료를 안 누른 것"으로 보고 서버가 닫습니다.
 *
 *  예상 45분짜리가 5시간째 진행중으로 떠 있으면 그건 작업이 길어진 게 아니라
 *  끝내고 나가면서 업무 종료를 안 누른 것입니다. 그대로 두면 진행중 작업 수와
 *  입장 인원이 계속 부풀어 관제 화면 전체를 못 믿게 됩니다. */
const AUTO_CLOSE_AFTER_OVERTIME_MINUTES = 180;

/** 게이트 세션 상태 → 화면 상태.
 *  키오스크는 단계가 더 잘게 나뉘지만 관제에서는 세 덩어리면 충분합니다. */
function toViewState(state: string): SiteStatus["state"] {
  if (state === "working") return "working";
  if (state === "blocked") return "blocked";
  if (state === "unlocking") return "unlocked";
  if (state === "tagging" || state === "face") return "waiting";
  return "verifying";
}

/** 예정 시각 대비 시작 시점. **진입을 막지 않고 기록만 남깁니다** —
 *  미리 와도 늦게 와도 들어갈 수 있고, 늦었다는 사실만 남습니다. */
export function scheduleNote(
  scheduledAt: string | null | undefined,
  startedAt: string | null | undefined,
): string | undefined {
  if (!scheduledAt || !startedAt) return undefined;
  const diff = Math.round(
    (new Date(startedAt).getTime() - new Date(scheduledAt).getTime()) / 60_000,
  );
  if (Math.abs(diff) < 5) return "예정 시각에 시작";
  const label = (m: number) =>
    m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`;
  return diff > 0
    ? `예정보다 ${label(diff)} 늦게 시작`
    : `예정보다 ${label(-diff)} 일찍 시작`;
}

function elapsedLabel(minutes: number): string {
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}

export async function loadDashboard(): Promise<DashboardData> {
  const db = adminDb();
  const [masters, snap] = await Promise.all([
    loadMasters(),
    db.collection("gateSessions").get(),
  ]);

  const now = Date.now();
  const sessions = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as never as {
    id: string;
    siteId: string;
    workCode: string;
    state: string;
    startedAt: string;
    endedAt: string | null;
    members: string[];
    enteredCount?: number;
    passedFirstTry?: boolean;
    blockedReason?: string;
    durationMinutes?: number;
    scheduledAt?: string | null;
    approvalRequestId?: string | null;
    autoClosed?: boolean;
    verification?: string;
  });

  /* ── 방치된 세션 자동 종료 ──────────────────────────────────────────────
   * 예상시간을 3시간 넘긴 진행중 세션은 여기서 닫습니다.
   *
   * 끝난 시각을 "지금"으로 적지 않고 **시작 + 예상시간**으로 적습니다.
   * 지금으로 적으면 5시간 일한 것으로 기록이 남는데, 실제로 그만큼 일했는지는
   * 아무도 모릅니다. 추정값이라는 걸 autoClosed 로 같이 남겨서, 나중에 이
   * 기록을 보는 사람이 측정값과 헷갈리지 않게 합니다. */
  const autoClosedNow: typeof sessions = [];
  for (const s of sessions) {
    if (s.state !== "working") continue;
    const estimated = Number(
      masters.workCodes.get(s.workCode)?.estimatedMinutes ?? 0,
    );
    if (estimated <= 0) continue;
    const minutes = Math.floor((now - new Date(s.startedAt).getTime()) / 60_000);
    if (minutes - estimated < AUTO_CLOSE_AFTER_OVERTIME_MINUTES) continue;

    s.state = "closed";
    s.endedAt = new Date(
      new Date(s.startedAt).getTime() + estimated * 60_000,
    ).toISOString();
    s.durationMinutes = estimated;
    s.autoClosed = true;
    s.verification = "종료 처리 안 됨 — 서버가 자동 종료";
    autoClosedNow.push(s);
  }
  if (autoClosedNow.length > 0) {
    const batch = db.batch();
    for (const s of autoClosedNow) {
      batch.update(db.collection("gateSessions").doc(s.id), {
        state: "closed",
        endedAt: s.endedAt,
        durationMinutes: s.durationMinutes,
        autoClosed: true,
        verification: s.verification,
      });
    }
    await batch.commit();
  }

  const live = sessions.filter((s) => s.state !== "closed");
  const closed = sessions.filter((s) => s.state === "closed");

  // ── 작업장별 현황 ────────────────────────────────────────────────────────
  const siteStatuses: SiteStatus[] = live
    .map((s) => {
      const wc = masters.workCodes.get(s.workCode);
      const minutes = Math.floor(
        (now - new Date(s.startedAt).getTime()) / 60_000,
      );
      const estimated = Number(wc?.estimatedMinutes ?? 0);
      const overtime =
        s.state === "working" && estimated > 0 && minutes > estimated;

      const view = toViewState(s.state);
      const startedAtDate = s.state === "blocked" ? null : new Date(s.startedAt);
      return {
        id: s.id,
        sessionId: s.id,
        site: masters.sites.get(s.siteId) ?? s.siteId,
        state: view,
        elapsed: s.state === "blocked" ? "—" : elapsedLabel(minutes),
        overtime,
        headcount: `${s.enteredCount ?? 0} / ${wc?.requiredHeadcount ?? s.members.length}명`,
        work: `${s.workCode} ${wc?.name ?? ""}`.trim(),
        // 젯슨이 없는 동안 웹에서 다음 단계로 넘기는 버튼.
        // 문 열림은 곧 작업 시작이라 "unlocked" 에는 더 이상 수동 버튼이 없습니다.
        control: view === "working" ? ("end" as const) : null,
        scheduleNote: scheduleNote(s.scheduledAt, s.startedAt),
        startedAtLabel: startedAtDate ? hhmm.format(startedAtDate) : undefined,
        expectedEndLabel:
          startedAtDate && estimated > 0
            ? hhmm.format(new Date(startedAtDate.getTime() + estimated * 60_000))
            : undefined,
      };
    })
    // 손이 가야 하는 것부터 위로: 차단 → 진행중 → 나머지
    .sort((a, b) => {
      const rank = (s: SiteStatus) =>
        s.state === "blocked" ? 0 : s.overtime ? 1 : s.state === "working" ? 2 : 3;
      return rank(a) - rank(b) || a.site.localeCompare(b.site, "ko");
    });

  /* 승인은 났는데 아직 게이트 세션이 없는 작업.
   * 원래는 작업자가 키오스크에서 고르면 세션이 생기는데, 젯슨이 없으니
   * 관제에서 "임시 문열림"으로 대신 시작시킬 수 있게 표에 올립니다. */
  const requestSnap = await db.collection("approvalRequests").get();
  const sessionRequestIds = new Set(
    sessions.map((s) => s.approvalRequestId).filter(Boolean),
  );
  const awaiting: SiteStatus[] = requestSnap.docs
    .map((d) => ({ id: d.id, r: d.data() }))
    .filter((x) => x.r.status === "approved" && !sessionRequestIds.has(x.id))
    .map(({ id, r }) => {
      const wc = masters.workCodes.get(String(r.workCode));
      return {
        id: `req-${id}`,
        requestId: id,
        site: masters.sites.get(String(r.siteId)) ?? String(r.siteId),
        state: "approved" as const,
        elapsed: "—",
        overtime: false,
        headcount: `0 / ${wc?.requiredHeadcount ?? 0}명`,
        work: `${r.workCode} ${wc?.name ?? ""}`.trim(),
        control: "unlock" as const,
      };
    });

  siteStatuses.unshift(...awaiting);

  // ── 이상 상황 ────────────────────────────────────────────────────────────
  const anomalies: Anomaly[] = [];

  /* 자동 종료된 세션은 이미 closed 라 아래 live 순회에 안 걸립니다.
     하지만 "누가 종료를 안 눌렀다"는 건 사람이 봐야 하는 사실이라 따로 올립니다. */
  for (const s of autoClosedNow) {
    const wc = masters.workCodes.get(s.workCode);
    const siteName = masters.sites.get(s.siteId) ?? s.siteId;
    const who = s.members
      .map((m) => masters.employees.get(m)?.name ?? m)
      .join(", ");
    anomalies.push({
      id: `autoclosed-${s.id}`,
      kind: "warning",
      title: "자동 종료됨",
      detail: `${siteName} · ${s.workCode} ${wc?.name ?? ""}이 예상시간을 3시간 넘겨 서버가 종료했어요. ${who} 님이 업무 종료를 누르지 않은 것으로 보입니다.`,
    });
  }

  for (const s of live) {
    const wc = masters.workCodes.get(s.workCode);
    const siteName = masters.sites.get(s.siteId) ?? s.siteId;
    const who = s.members
      .map((m) => masters.employees.get(m)?.name ?? m)
      .join(", ");

    if (s.state === "blocked") {
      anomalies.push({
        id: s.id,
        kind: "blocked",
        title: "자격 미달 차단",
        detail: `${siteName} · ${who} 님의 ${s.blockedReason ?? "자격"}으로 입장이 차단됐어요.`,
      });
      continue;
    }

    /* 작업 중 인원이 최소기준 아래로 떨어진 경우 (「출입 및 인원관리 로직」 §11).
       한 명이 퇴장해 2명 작업이 1명이 되면 경고를 올립니다.
       **작업을 끝내지는 않습니다** — 문서가 "시스템이 자동 종료하지 않는다"고
       못박았고, 현장을 확인하는 건 팀장 몫입니다. */
    const required = Number(wc?.requiredHeadcount ?? 0);
    const inside = s.enteredCount ?? 0;
    if (s.state === "working" && required > 0 && inside < required) {
      anomalies.push({
        id: `understaffed-${s.id}`,
        kind: "warning",
        title: "작업 중 인원 미달",
        detail: `${siteName} · ${s.workCode} ${wc?.name ?? ""}에 지금 ${inside}명뿐이에요 (최소 ${required}명). 현장을 확인해 주세요.`,
      });
    }

    const minutes = Math.floor((now - new Date(s.startedAt).getTime()) / 60_000);
    const estimated = Number(wc?.estimatedMinutes ?? 0);
    if (s.state === "working" && estimated > 0 && minutes > estimated) {
      anomalies.push({
        id: s.id,
        kind: "warning",
        title: "예상시간 초과",
        detail: `${siteName} · ${s.workCode} ${wc?.name ?? ""}이 예상시간을 ${minutes - estimated}분 넘겼어요.`,
      });
    }
  }

  // ── KPI ──────────────────────────────────────────────────────────────────
  const working = live.filter((s) => s.state === "working");
  const entered = live.reduce((sum, s) => sum + (s.enteredCount ?? 0), 0);
  /* 자동 종료된 세션은 통과율에서 뺍니다. 검증을 통과한 것도 실패한 것도
     아니라 **판정 자체가 없는** 세션이라, 분모에 넣으면 실패로 깎입니다. */
  const verified = closed.filter((s) => !s.autoClosed);
  const firstTryPass = verified.filter((s) => s.passedFirstTry).length;
  const passRate =
    verified.length > 0
      ? Math.round((firstTryPass / verified.length) * 100)
      : 0;

  const kpis = [
    {
      label: "진행중 작업",
      value: String(working.length),
      alert: false,
      hint: "지금 문이 열려 작업 중인 건수",
    },
    {
      label: "입장 인원",
      value: `${entered}명`,
      alert: false,
      hint: "진행 중인 작업에 실제로 들어가 있는 인원 합계",
    },
    {
      label: "1차 검증 통과율",
      value: `${passRate}%`,
      alert: false,
      hint: "끝난 작업 중 얼굴·보호구 검증을 재시도 없이 통과한 비율",
    },
    {
      label: "이상 상황",
      value: String(anomalies.length),
      alert: anomalies.length > 0,
      hint: "예상시간 초과·자격 미달 차단 등 지금 확인이 필요한 건수",
    },
  ];

  // ── 오늘 처리 ────────────────────────────────────────────────────────────
  const todayKey = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
  }).format(new Date());
  const decidedToday = requestSnap.docs
    .map((d) => d.data())
    .filter(
      (r) =>
        r.decidedAt &&
        new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(
          new Date(r.decidedAt),
        ) === todayKey,
    );

  const approved = decidedToday.filter((r) => r.status === "approved").length;
  const rejected = decidedToday.filter((r) => r.status === "rejected").length;

  const waits = decidedToday
    .filter((r) => r.createdAt && r.decidedAt)
    .map((r) => new Date(r.decidedAt).getTime() - new Date(r.createdAt).getTime());
  const avgMs = waits.length
    ? Math.round(waits.reduce((a, b) => a + b, 0) / waits.length)
    : 0;
  const avgLabel =
    waits.length === 0
      ? "—"
      : avgMs < 60_000
        ? `${Math.round(avgMs / 1000)}초`
        : `${Math.floor(avgMs / 60_000)}분 ${Math.round((avgMs % 60_000) / 1000)}초`;

  return {
    kpis,
    siteStatuses,
    anomalies,
    todaySummary: [
      { label: "승인", value: `${approved}건` },
      { label: "반려", value: `${rejected}건` },
      { label: "평균 승인 소요", value: avgLabel },
    ],
  };
}

export { LIVE_STATES };
