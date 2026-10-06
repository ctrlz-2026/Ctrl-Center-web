import "server-only";

import { adminDb } from "./admin";
import { seoulDate } from "./bundle";
import { loadMasters } from "./queries";
import type { Anomaly, CrewMember, SiteBoardTile, SiteStatus } from "@/lib/types";

/* 관제 화면 데이터. 전부 gateSessions · approvalRequests 에서 계산합니다.
 *
 * 하드코딩된 목업이 아니라 실제 세션을 읽으므로, 젯슨이 세션을 만들기 시작하면
 * 이 코드는 그대로 두고 데이터만 진짜로 바뀝니다.
 *
 * 2026-09-27 에 크게 바꿨습니다.
 *   - 제어 버튼이 사라졌습니다. 현장 진행(문 열기·작업 종료)은 키오스크가 합니다.
 *   - 차단은 **표의 행이 아니라 "확인 필요"** 입니다. 차단된 사람은 작업을 한 게
 *     아니라 문 앞에서 막힌 것이라, 작업 목록에 섞이면 표가 부풀기만 합니다.
 *   - 작업장 7곳을 고정 자리에 두는 보드를 추가했습니다. */

export interface DashboardData {
  /** hint 는 KPI 라벨만 보고 뜻을 짐작하기 어려운 값이 헷갈린다는 피드백을 받아
   *  추가했습니다 — 라벨 아래 한 줄로 뭘 세는 값인지 밝힙니다. */
  kpis: { label: string; value: string; alert: boolean; hint: string }[];
  board: SiteBoardTile[];
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

/** 문 앞에서 검증이 진행 중이거나, 문이 열려 작업 중인 상태.
 *  `blocked` 는 여기 없습니다 — 차단은 끝난 시도입니다. */
const LIVE_STATES = ["tagging", "face", "verifying", "unlocking", "working"];

/** 예상시간을 이만큼 넘기면 "종료를 안 누른 것"으로 보고 서버가 닫습니다.
 *
 *  예상 45분짜리가 5시간째 진행중으로 떠 있으면 그건 작업이 길어진 게 아니라
 *  끝내고 나가면서 작업 종료를 안 누른 것입니다. 그대로 두면 진행중 작업 수와
 *  입장 인원이 계속 부풀어 관제 화면 전체를 못 믿게 됩니다.
 *
 *  예전엔 시연 데이터를 이 규칙에서 뺐는데, 그랬더니 며칠 뒤 "331시간째 진행중"
 *  같은 행이 관제에 남았습니다. 이제 예외 없이 적용하고, 시연 데이터는 시연 전에
 *  시나리오를 다시 까는 것으로 해결합니다 (npm run scenario). */
const AUTO_CLOSE_AFTER_OVERTIME_MINUTES = 180;

/** 게이트 세션 상태 → 화면 상태.
 *  키오스크는 단계가 더 잘게 나뉘지만 관제에서는 세 덩어리면 충분합니다. */
function toViewState(state: string): SiteStatus["state"] {
  if (state === "working") return "working";
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

export function elapsedLabel(minutes: number): string {
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`;
}

interface SessionDoc {
  id: string;
  siteId: string;
  gateId?: string | null;
  workCode: string;
  state: string;
  startedAt: string;
  endedAt: string | null;
  members: string[];
  enteredCount?: number;
  /** 젯슨 판정 세션에만 있습니다. 키오스크 시연 세션은 인원 수만 남깁니다. */
  verifiedEmpNos?: string[];
  enteredEmpNos?: string[];
  passedFirstTry?: boolean;
  blockedReason?: string;
  /** 젯슨 판정에서 막힌 사람. 미등록 사원증이면 없습니다. */
  blockedEmpNo?: string | null;
  /** 막힌 이력. 다시 시도해 통과해도 남습니다. */
  blockLog?: { at: string; empNo: string; reason: string; text: string }[];
  durationMinutes?: number;
  scheduledAt?: string | null;
  approvalRequestId?: string | null;
  autoClosed?: boolean;
  /** 기기 없이 키오스크 시연으로 연 세션. 얼굴·보호구 검증을 안 거쳤습니다. */
  simulated?: boolean;
  verification?: string;
}

/** 승인됐지만 아직 문을 안 연 오늘 작업인지.
 *
 *  **오늘 예정된 것만** 셉니다. 날짜 제한이 없으면 며칠 전에 승인만 받고 안 간
 *  작업이 계속 "입장 대기"로 쌓여, 실제로 오늘 올 사람을 가립니다. 예정 시각이
 *  없는 요청은 날짜를 알 수 없어 같이 셉니다 (일일 번들과 같은 기준). */
export function isWaitingToday(
  r: FirebaseFirestore.DocumentData,
  startedRequestIds: Set<string>,
  requestId: string,
  today: string,
): boolean {
  if (r.status !== "approved") return false;
  if (startedRequestIds.has(requestId)) return false;
  if (!r.scheduledAt) return true;
  return seoulDate(new Date(String(r.scheduledAt))) === today;
}

/** 이 요청으로 이미 문이 열렸는지. 차단만 된 요청은 **다시 시도할 수 있어야**
 *  하므로 "시작됨"에 넣지 않습니다. */
export function startedRequestIdsOf(sessions: { state: string; approvalRequestId?: string | null }[]) {
  return new Set(
    sessions
      .filter((s) => s.state !== "blocked" && s.approvalRequestId)
      .map((s) => String(s.approvalRequestId)),
  );
}

/** 참여자 한 명씩 지금 문의 어느 쪽에 있는지.
 *
 *  젯슨이 판정한 세션은 누가 검증을 통과했고 누가 들어갔는지 사번으로 남습니다.
 *  키오스크 시연으로 연 세션은 "몇 명 들어갔다"만 있어, 참여자 순서대로 앞에서부터
 *  들어간 것으로 봅니다 (시연은 전원이 한 번에 들어가므로 실제와 어긋나지 않습니다). */
function crewOf(s: SessionDoc, nameOf: (empNo: string) => string): CrewMember[] {
  const members = s.members ?? [];
  const entered = Array.isArray(s.enteredEmpNos) ? new Set(s.enteredEmpNos) : null;
  const verified = new Set(s.verifiedEmpNos ?? []);
  return members.map((empNo, i) => ({
    name: nameOf(empNo),
    position:
      s.state === "blocked" && s.blockedEmpNo === empNo
        ? "blocked"
        : (entered ? entered.has(empNo) : i < (s.enteredCount ?? 0))
          ? "in"
          : verified.has(empNo)
            ? "verified"
            : "out",
  }));
}

export async function loadDashboard(): Promise<DashboardData> {
  const db = adminDb();
  const [masters, snap, requestSnap, gateSnap] = await Promise.all([
    loadMasters(),
    db.collection("gateSessions").get(),
    db.collection("approvalRequests").get(),
    db.collection("gates").get(),
  ]);

  const now = Date.now();
  const today = seoulDate();
  const gateOfSite = new Map(
    gateSnap.docs.map((d) => [String(d.data().siteId), d.id]),
  );
  const nameOf = (empNo: string) =>
    String(masters.employees.get(empNo)?.name ?? empNo);
  const sessions = snap.docs.map(
    (d) => ({ id: d.id, ...d.data() }) as never as SessionDoc,
  );

  /* ── 방치된 세션 자동 종료 ──────────────────────────────────────────────
   * 예상시간을 3시간 넘긴 진행중 세션은 여기서 닫습니다.
   *
   * 끝난 시각을 "지금"으로 적지 않고 **시작 + 예상시간**으로 적습니다.
   * 지금으로 적으면 5시간 일한 것으로 기록이 남는데, 실제로 그만큼 일했는지는
   * 아무도 모릅니다. 추정값이라는 걸 autoClosed 로 같이 남겨서, 나중에 이
   * 기록을 보는 사람이 측정값과 헷갈리지 않게 합니다. */
  const autoClosedNow: SessionDoc[] = [];
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

  const live = sessions.filter((s) => LIVE_STATES.includes(s.state));
  const closedToday = sessions.filter(
    (s) => s.state === "closed" && s.endedAt && seoulDate(new Date(s.endedAt)) === today,
  );
  const startedIds = startedRequestIdsOf(sessions);

  // ── 진행중 작업 ─────────────────────────────────────────────────────────
  const liveRows: SiteStatus[] = live.map((s) => {
    const wc = masters.workCodes.get(s.workCode);
    const minutes = Math.max(
      0,
      Math.floor((now - new Date(s.startedAt).getTime()) / 60_000),
    );
    const estimated = Number(wc?.estimatedMinutes ?? 0);
    const working = s.state === "working";
    const startedAtDate = new Date(s.startedAt);
    return {
      id: s.id,
      sessionId: s.id,
      requestId: s.approvalRequestId ?? undefined,
      siteId: s.siteId,
      site: masters.sites.get(s.siteId) ?? s.siteId,
      gateId: s.gateId ?? gateOfSite.get(s.siteId) ?? null,
      state: toViewState(s.state),
      elapsed: elapsedLabel(minutes),
      overtime: working && estimated > 0 && minutes > estimated,
      progress: working && estimated > 0 ? minutes / estimated : null,
      headcount: `${s.enteredCount ?? 0} / ${wc?.requiredHeadcount ?? s.members.length}명`,
      work: `${s.workCode} ${wc?.name ?? ""}`.trim(),
      members: (s.members ?? []).map(nameOf),
      crew: crewOf(s, nameOf),
      scheduleNote: scheduleNote(s.scheduledAt, s.startedAt),
      startedAtLabel: hhmm.format(startedAtDate),
      expectedEndLabel:
        estimated > 0
          ? hhmm.format(new Date(startedAtDate.getTime() + estimated * 60_000))
          : undefined,
    };
  });

  /* ── 입장 대기 ───────────────────────────────────────────────────────────
   * 승인은 났는데 아직 키오스크에서 문을 안 연 오늘 작업. */
  const waitingRows: SiteStatus[] = requestSnap.docs
    .map((d) => ({ id: d.id, r: d.data() }))
    .filter(({ id, r }) => isWaitingToday(r, startedIds, id, today))
    .map(({ id, r }) => {
      const wc = masters.workCodes.get(String(r.workCode));
      const siteId = String(r.siteId);
      return {
        id: `req-${id}`,
        requestId: id,
        siteId,
        site: masters.sites.get(siteId) ?? siteId,
        gateId: gateOfSite.get(siteId) ?? null,
        state: "approved" as const,
        elapsed: "—",
        overtime: false,
        progress: null,
        headcount: `0 / ${wc?.requiredHeadcount ?? 0}명`,
        work: `${r.workCode} ${wc?.name ?? ""}`.trim(),
        members: [nameOf(String(r.requesterId))],
        scheduledLabel: r.scheduledAt
          ? hhmm.format(new Date(String(r.scheduledAt)))
          : undefined,
      };
    })
    .sort((a, b) => (a.scheduledLabel ?? "").localeCompare(b.scheduledLabel ?? ""));

  // ── 확인 필요 ───────────────────────────────────────────────────────────
  const anomalies: Anomaly[] = [];

  /* 자동 종료된 세션은 이미 closed 라 아래 live 순회에 안 걸립니다.
     하지만 "누가 종료를 안 눌렀다"는 건 사람이 봐야 하는 사실이라 따로 올립니다. */
  for (const s of autoClosedNow) {
    const wc = masters.workCodes.get(s.workCode);
    const siteName = masters.sites.get(s.siteId) ?? s.siteId;
    anomalies.push({
      id: `autoclosed-${s.id}`,
      kind: "warning",
      title: "자동 종료됨",
      detail: `${s.workCode} ${wc?.name ?? ""} — 예상시간을 3시간 넘겨 서버가 종료했어요. ${s.members.map(nameOf).join(", ")} 님이 작업 종료를 누르지 않은 것으로 보입니다.`,
      siteId: s.siteId,
      siteName,
    });
  }

  /* 오늘 문 앞에서 막힌 시도. **다시 시도해 통과하면 내려갑니다** — 같은 승인
   * 요청으로 나중에 문이 열렸다면 그 차단은 이미 해소된 것입니다. 해소되지
   * 않은 차단은 오늘이 끝날 때까지 남습니다. 예전처럼 "확인 처리" 버튼으로
   * 지우지 않는 이유는, 막힌 사람이 다시 와서 통과하는 게 진짜 해소이기
   * 때문입니다. 지난 차단은 기록으로 남아 있고 "오늘 처리"에 건수로 잡힙니다. */
  const blockedToday = sessions.filter(
    (s) => s.state === "blocked" && seoulDate(new Date(s.startedAt)) === today,
  );
  for (const s of blockedToday) {
    const resolved = sessions.some(
      (o) =>
        o.id !== s.id &&
        o.state !== "blocked" &&
        o.approvalRequestId &&
        o.approvalRequestId === s.approvalRequestId &&
        o.startedAt > s.startedAt,
    );
    if (resolved) continue;
    const wc = masters.workCodes.get(s.workCode);
    /* 막힌 사람. 젯슨 판정은 blockedEmpNo 에, 키오스크 시연은 members 에
       남깁니다. 미등록 사원증이면 둘 다 비어 있습니다. */
    const who = [s.blockedEmpNo, ...(s.members ?? [])]
      .filter(Boolean)
      .map((m) => nameOf(String(m)))
      .join(", ");
    anomalies.push({
      id: s.id,
      kind: "blocked",
      title: "입장 차단",
      /* 누가 막혔는지 모를 수도 있습니다 — 등록되지 않은 사원증이면 사번 자체가
         없습니다. 그때는 이름 없이 사유만 적습니다. */
      detail: `${who ? `${who} 님 — ` : ""}${s.blockedReason ?? "검증 실패"}. ${s.workCode} ${wc?.name ?? ""} 작업에 들어가지 못했어요.`,
      siteId: s.siteId,
      siteName: masters.sites.get(s.siteId) ?? s.siteId,
      atLabel: hhmm.format(new Date(s.startedAt)),
    });
  }

  for (const s of live) {
    if (s.state !== "working") continue;
    const wc = masters.workCodes.get(s.workCode);
    const siteName = masters.sites.get(s.siteId) ?? s.siteId;
    const work = `${s.workCode} ${wc?.name ?? ""}`.trim();

    /* 작업 중 인원이 최소기준 아래로 떨어진 경우 (「출입 및 인원관리 로직」 §11).
       **작업을 끝내지는 않습니다** — 문서가 "시스템이 자동 종료하지 않는다"고
       못박았고, 현장을 확인하는 건 팀장 몫입니다. */
    const required = Number(wc?.requiredHeadcount ?? 0);
    const inside = s.enteredCount ?? 0;
    if (required > 0 && inside < required) {
      anomalies.push({
        id: `understaffed-${s.id}`,
        kind: "warning",
        title: "작업 중 인원 미달",
        detail: `${work} — 지금 ${inside}명뿐이에요 (최소 ${required}명). 현장을 확인해 주세요.`,
        siteId: s.siteId,
        siteName,
        sessionId: s.id,
      });
    }

    const minutes = Math.floor((now - new Date(s.startedAt).getTime()) / 60_000);
    const estimated = Number(wc?.estimatedMinutes ?? 0);
    if (estimated > 0 && minutes > estimated) {
      /* 밀폐공간 작업(자격 요건 "confined")은 시간이 늘어질수록 산소 결핍·유해가스
       * 축적 위험이 커지는 작업이라, 다른 작업의 "예상시간 초과"와 같은 급으로
       * 다루지 않기로 했습니다 (팀 결정, 2026-09-03 대화).
       *
       * requiredQualifications 에 "confined" 가 있는지로 판정해 데이터가 바뀌어도
       * 이 코드를 다시 고칠 필요가 없게 합니다. 알림 체계가 따로 없는 지금은
       * kind 를 blocked(빨강)로 올려 관제 화면에서 안전관리자 눈에 먼저 띄게
       * 합니다 — 이게 "안전관리자에게 뜨는 알림"의 현재 구현입니다. */
      const isConfinedSpace = (wc?.requiredQualifications ?? []).includes("confined");
      anomalies.push(
        isConfinedSpace
          ? {
              id: s.id,
              kind: "blocked",
              title: "밀폐공간 작업시간 초과 — 안전관리자 확인 필요",
              detail: `${work} — 예상시간을 ${minutes - estimated}분 넘겼어요. 산소·유해가스 상태를 반드시 현장에서 확인해 주세요.`,
              siteId: s.siteId,
              siteName,
              sessionId: s.id,
            }
          : {
              id: s.id,
              kind: "warning",
              title: "예상시간 초과",
              detail: `${work} — 예상 ${estimated}분을 ${minutes - estimated}분 넘겼어요.`,
              siteId: s.siteId,
              siteName,
              sessionId: s.id,
            },
      );
    }
  }

  // 차단(빨강)부터, 그다음 경고.
  anomalies.sort((a, b) =>
    a.kind === b.kind ? 0 : a.kind === "blocked" ? -1 : 1,
  );

  // ── 작업 목록 ───────────────────────────────────────────────────────────
  // 손이 가야 하는 것부터: 초과 → 진행중 → 검증중 → 입장 대기
  const alertSessions = new Set(anomalies.map((a) => a.sessionId).filter(Boolean));
  const siteStatuses = [
    ...liveRows.sort((a, b) => {
      const rank = (s: SiteStatus) =>
        alertSessions.has(s.sessionId) ? 0 : s.state === "working" ? 1 : 2;
      return rank(a) - rank(b) || a.site.localeCompare(b.site, "ko");
    }),
    ...waitingRows,
  ];

  // ── 작업장 보드 ─────────────────────────────────────────────────────────
  const board: SiteBoardTile[] = [...masters.sites.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([siteId, siteName]) => {
      const working = liveRows.filter((r) => r.siteId === siteId);
      const waiting = waitingRows.filter((r) => r.siteId === siteId);
      const alertCount = anomalies.filter((a) => a.siteId === siteId).length;
      return {
        siteId,
        siteName,
        gateId: gateOfSite.get(siteId) ?? null,
        state:
          alertCount > 0
            ? "alert"
            : working.length > 0
              ? "working"
              : waiting.length > 0
                ? "waiting"
                : "idle",
        working: working.map((r) => ({
          sessionId: r.sessionId!,
          work: r.work,
          headcount: r.headcount,
          elapsed: r.elapsed,
          progress: r.progress,
          overtime: r.overtime,
        })),
        waitingCount: waiting.length,
        nextLabel: waiting[0]?.scheduledLabel,
        alertCount,
      };
    });

  // ── KPI ──────────────────────────────────────────────────────────────────
  const workingCount = live.filter((s) => s.state === "working").length;
  const entered = live.reduce((sum, s) => sum + (s.enteredCount ?? 0), 0);

  const kpis = [
    {
      label: "진행중 작업",
      value: String(workingCount),
      alert: false,
      hint: "지금 문이 열려 작업 중인 건수",
    },
    {
      label: "현장 인원",
      value: `${entered}명`,
      alert: false,
      hint: "진행 중인 작업에 실제로 들어가 있는 인원 합계",
    },
    {
      label: "입장 대기",
      value: String(waitingRows.length),
      alert: false,
      hint: "오늘 승인됐지만 아직 키오스크에서 시작하지 않은 작업",
    },
    {
      label: "확인 필요",
      value: String(anomalies.length),
      alert: anomalies.length > 0,
      hint: "입장 차단·예상시간 초과·인원 미달 등 지금 봐야 하는 건수",
    },
  ];

  // ── 오늘 처리 ────────────────────────────────────────────────────────────
  const decidedToday = requestSnap.docs
    .map((d) => d.data())
    .filter((r) => r.decidedAt && seoulDate(new Date(r.decidedAt)) === today);

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
        : `${Math.floor(avgMs / 60_000)}분`;

  /* 오늘 막힌 횟수. 젯슨 판정 세션은 막혔다가 통과하면 state 가 바뀌므로
   * 누적 이력(blockLog)으로 셉니다 — 통과했다고 막힌 사실이 사라지면 안 됩니다.
   * 이력이 없는 세션(키오스크 시연)은 차단 상태 그대로 한 건으로 셉니다. */
  const blockCountToday = sessions.reduce((n, s) => {
    if (Array.isArray(s.blockLog) && s.blockLog.length > 0) {
      return n + s.blockLog.filter((b) => seoulDate(new Date(b.at)) === today).length;
    }
    return n + (s.state === "blocked" && seoulDate(new Date(s.startedAt)) === today ? 1 : 0);
  }, 0);

  /* 1차 검증 통과율은 **오늘 끝난 작업**으로 셉니다. 전체 기간으로 세면 오늘
   * 무슨 일이 있어도 숫자가 거의 안 움직입니다. 자동 종료된 세션과 키오스크
   * 시연(젯슨 대역)으로 연 세션은 뺍니다 — 둘 다 검증을 통과한 것도 실패한
   * 것도 아니라 판정 자체가 없는 세션입니다. */
  const verified = closedToday.filter((s) => !s.autoClosed && !s.simulated);
  const firstTry = verified.filter((s) => s.passedFirstTry).length;
  const passRate = verified.length
    ? `${Math.round((firstTry / verified.length) * 100)}%`
    : "—";

  return {
    kpis,
    board,
    siteStatuses,
    anomalies,
    todaySummary: [
      { label: "완료된 작업", value: `${closedToday.length}건` },
      { label: "1차 검증 통과율", value: passRate },
      { label: "입장 차단", value: `${blockCountToday}건` },
      { label: "승인 / 반려", value: `${approved}건 / ${rejected}건` },
      { label: "평균 승인 소요", value: avgLabel },
    ],
  };
}

export { LIVE_STATES };
