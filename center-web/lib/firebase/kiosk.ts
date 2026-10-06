import "server-only";

import { adminDb } from "./admin";
import { seoulDate } from "./bundle";
import { crewOf, elapsedLabel, startedRequestIdsOf } from "./dashboard";
import { loadMasters } from "./queries";
import type { KioskSignal, KioskStatus } from "@/lib/kiosk-types";

/* 키오스크(터치패드) 화면 데이터.
 *
 * 이 화면은 **로그인한 사람이 없는 화면**입니다. 현장 벽에 붙어 있고 아무나
 * 만질 수 있으므로, 사용자 토큰이 아니라 서버가 직접 Firestore 를 읽어
 * 필요한 것만 내려줍니다. 브라우저로 키가 나가면 안 되기 때문에 이 파일은
 * server-only 입니다.
 *
 * 2026-09-27 부터 현장 진행(작업 선택 → 문 열림 → 작업 종료)을 **키오스크가
 * 맡습니다.** 관제 화면에 있던 「임시 문열림」「업무 종료」「확인 처리」를
 * 여기로 옮겼습니다. 판정(사원증·얼굴·보호구)은 여전히 젯슨 몫입니다. */

export interface KioskGate {
  gateId: string;
  siteId: string;
  siteName: string;
}

export interface KioskTask {
  requestId: string;
  code: string;
  title: string;
  requesterName: string;
  requesterRank: string;
  headcount: number;
  requiredPpe: string[];
  /** 팀장이 승인하며 남긴 당부. 현장에서 읽으라고 쓴 말이라 카드에 그대로 띄웁니다. */
  approveNote?: string;
  approverName?: string;
  /** 작업 예정 시각. 오늘이면 "14:30", 다른 날이면 "10/6 14:30".
   *  **날짜가 지났어도 목록에서 빼지 않습니다** — 예정 시각은 진입을 막는 값이
   *  아니라 기록용이라, 늦게 와도 들어갈 수 있어야 합니다. */
  scheduledAt?: string;
  /** 오늘이 아닌 작업인지. 화면에서 눈에 띄게 표시하려고 따로 둡니다. */
  scheduledOtherDay?: boolean;
  /** 정렬용 ISO 값. 화면에 쓰지 않습니다. */
  scheduledSortKey?: string;
}

/** 이 게이트에서 지금 작업 중인 것. 작업 선택 화면 위에 따로 보여줍니다 —
 *  끝내러 온 사람이 자기 작업을 바로 찾을 수 있어야 합니다. */
export interface KioskWorking {
  sessionId: string;
  requestId: string | null;
  code: string;
  title: string;
  members: string[];
  elapsed: string;
  overtime: boolean;
}

const hhmm = new Intl.DateTimeFormat("ko-KR", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Seoul",
});

/** "10/6" — 오늘이 아닌 작업에만 붙입니다. */
const md = new Intl.DateTimeFormat("ko-KR", {
  month: "numeric",
  day: "numeric",
  timeZone: "Asia/Seoul",
});

/** 젯슨 대역(시연)을 켰는지. 실제 기기가 붙으면 끕니다.
 *  켜져 있을 때만 키오스크에 "검증 통과 / 실패" 시연 버튼이 나옵니다. */
export function simulationEnabled(): boolean {
  return process.env.KIOSK_SIMULATION === "on";
}

/** 설치 대상 게이트 목록. 키오스크를 어느 문에 붙일지 고르는 화면용입니다. */
export async function loadKioskGates(): Promise<KioskGate[]> {
  const [masters, gateSnap] = await Promise.all([
    loadMasters(),
    adminDb().collection("gates").get(),
  ]);
  return gateSnap.docs
    .map((d) => {
      const g = d.data();
      const siteId = String(g.siteId);
      return {
        gateId: d.id,
        siteId,
        siteName: masters.sites.get(siteId) ?? siteId,
      };
    })
    .sort((a, b) => a.siteName.localeCompare(b.siteName, "ko"));
}

export async function loadKioskGate(gateId: string): Promise<KioskGate | null> {
  const [masters, doc] = await Promise.all([
    loadMasters(),
    adminDb().collection("gates").doc(gateId).get(),
  ]);
  if (!doc.exists) return null;
  const siteId = String(doc.data()!.siteId);
  return { gateId, siteId, siteName: masters.sites.get(siteId) ?? siteId };
}

function toTask(
  requestId: string,
  r: FirebaseFirestore.DocumentData,
  masters: Awaited<ReturnType<typeof loadMasters>>,
): KioskTask {
  const wc = masters.workCodes.get(String(r.workCode));
  const emp = masters.employees.get(String(r.requesterId));
  return {
    requestId,
    code: String(r.workCode),
    title: String(wc?.name ?? r.workCode),
    requesterName: String(emp?.name ?? "알 수 없음"),
    requesterRank: String(emp?.rank ?? ""),
    headcount: Number(wc?.requiredHeadcount ?? 0),
    requiredPpe: (wc?.requiredPpe ?? []).map(
      (p: string) => masters.ppeNames.get(p) ?? p,
    ),
    approveNote: r.approveNote ?? undefined,
    approverName: r.approverId
      ? (masters.employees.get(String(r.approverId))?.name ?? undefined)
      : undefined,
    ...scheduleLabel(r.scheduledAt),
  };
}

/** 예정 시각 표기. 오늘이 아니면 날짜를 앞에 붙여 **다른 날 작업임을 숨기지
 *  않습니다** — 목록에서 빼지 않는 대신, 보는 사람이 알아채게 합니다. */
function scheduleLabel(raw: unknown): Partial<KioskTask> {
  if (!raw) return {};
  const at = new Date(String(raw));
  if (Number.isNaN(at.getTime())) return {};
  const otherDay = seoulDate(at) !== seoulDate();
  return {
    scheduledAt: otherDay ? `${md.format(at)} ${hhmm.format(at)}` : hhmm.format(at),
    scheduledOtherDay: otherDay,
    scheduledSortKey: at.toISOString(),
  };
}

/** 이 게이트에 띄울 작업들.
 *
 *  **승인된 작업만** 올라옵니다. 승인이 곧 게이트 노출 조건이라, 신청만 하고
 *  결재가 안 난 작업은 키오스크에 아예 보이지 않습니다.
 *
 *  이미 문이 열린 요청은 뺍니다 — 남아 있으면 같은 작업으로 두 번 들어갑니다.
 *  **차단만 된 요청은 남깁니다.** 막힌 사람이 보호구를 갖추고 다시 와야 하는데
 *  목록에서 사라지면 다시 시도할 길이 없습니다.
 *
 *  ── 예정 날짜로 거르지 않습니다 (2026-10-05 수정) ──────────────────────
 *  한때 "오늘 예정분만" 띄웠는데, 팀장이 승인한 작업이 키오스크에 안 뜨는
 *  일이 생겼습니다. 「출입 및 인원관리 로직」은 **예정 시각이 진입을 막지
 *  않는다**고 못박고 있습니다 — 늦게 와도 일찍 와도 통과시키고 기록만 남기는
 *  것이 규칙인데, 목록에서 빼버리면 아예 시도조차 못 합니다.
 *  날짜가 다른 작업은 **빼는 대신 날짜를 적어** 띄웁니다. 자정을 넘겨 하는
 *  작업, 전날 승인받고 아침에 들어가는 작업이 모두 여기 걸립니다.
 *
 *  관제 화면의 "입장 대기" 숫자는 그대로 오늘 기준입니다 — 그쪽은 오늘
 *  처리량을 세는 지표라 날짜로 묶는 게 맞습니다. */
export async function loadKioskTasks(siteId: string): Promise<KioskTask[]> {
  const db = adminDb();
  const [masters, reqSnap, sessionSnap] = await Promise.all([
    loadMasters(),
    db.collection("approvalRequests").where("siteId", "==", siteId).get(),
    db.collection("gateSessions").get(),
  ]);

  const started = startedRequestIdsOf(
    sessionSnap.docs.map((d) => d.data() as { state: string; approvalRequestId?: string }),
  );

  return reqSnap.docs
    .filter((d) => d.data().status === "approved" && !started.has(d.id))
    .map((d) => toTask(d.id, d.data(), masters))
    // 예정이 이른 것부터. 예정 시각이 없는 요청은 뒤로 보냅니다.
    .sort((a, b) =>
      (a.scheduledSortKey ?? "9999").localeCompare(b.scheduledSortKey ?? "9999"),
    );
}

export async function loadKioskTask(
  siteId: string,
  requestId: string,
): Promise<KioskTask | null> {
  const tasks = await loadKioskTasks(siteId);
  return tasks.find((t) => t.requestId === requestId) ?? null;
}

/** 목록 필터 없이 요청 하나를 읽습니다. 진행 화면은 문이 열린 뒤에도
 *  (= 목록에서 빠진 뒤에도) 그 작업을 보여줘야 해서 따로 둡니다. */
export async function loadKioskRequest(
  siteId: string,
  requestId: string,
): Promise<KioskTask | null> {
  const [masters, doc] = await Promise.all([
    loadMasters(),
    adminDb().collection("approvalRequests").doc(requestId).get(),
  ]);
  if (!doc.exists) return null;
  const r = doc.data()!;
  if (String(r.siteId) !== siteId || r.status !== "approved") return null;
  return toTask(doc.id, r, masters);
}

/** 이 게이트(작업장)에서 지금 작업 중인 것들. */
export async function loadKioskWorking(siteId: string): Promise<KioskWorking[]> {
  const db = adminDb();
  const [masters, snap] = await Promise.all([
    loadMasters(),
    db.collection("gateSessions").where("siteId", "==", siteId).get(),
  ]);
  const now = Date.now();
  return snap.docs
    .map((d) => ({ id: d.id, s: d.data() }))
    .filter(({ s }) => s.state === "working")
    .map(({ id, s }) => {
      const wc = masters.workCodes.get(String(s.workCode));
      const minutes = Math.max(
        0,
        Math.floor((now - new Date(String(s.startedAt)).getTime()) / 60_000),
      );
      const estimated = Number(wc?.estimatedMinutes ?? 0);
      return {
        sessionId: id,
        requestId: s.approvalRequestId ?? null,
        code: String(s.workCode),
        title: String(wc?.name ?? s.workCode),
        members: (s.members ?? []).map(
          (m: string) => String(masters.employees.get(m)?.name ?? m),
        ),
        elapsed: elapsedLabel(minutes),
        overtime: estimated > 0 && minutes > estimated,
      };
    });
}

/** 진행 화면이 몇 초마다 묻는 "이 작업 지금 어떻게 됐나".
 *
 *  그 요청으로 만들어진 세션 중 **가장 최근 것**을 봅니다. 막혔다가 다시 시도해
 *  통과했다면 최근 것이 working 이라 막힌 기록은 가려집니다. */
export async function loadKioskStatus(
  gateId: string,
  siteId: string,
  requestId: string,
): Promise<KioskStatus> {
  const db = adminDb();
  const [masters, reqDoc, sessSnap, ctxDoc] = await Promise.all([
    loadMasters(),
    db.collection("approvalRequests").doc(requestId).get(),
    db.collection("gateSessions").where("approvalRequestId", "==", requestId).get(),
    db.collection("kioskContexts").doc(gateId).get(),
  ]);

  const workCode = String(reqDoc.data()?.workCode ?? "");
  const wc = masters.workCodes.get(workCode);
  const required = Number(wc?.requiredHeadcount ?? 0);
  const estimated = Number(wc?.estimatedMinutes ?? 0);
  const selected =
    ctxDoc.exists && ctxDoc.data()?.approvalRequestId === requestId;
  const nameOf = (m: string) => String(masters.employees.get(m)?.name ?? m);

  const latest = sessSnap.docs
    .map((d) => ({ id: d.id, s: d.data() }))
    .filter(({ s }) => String(s.siteId) === siteId)
    .sort((a, b) => String(b.s.startedAt).localeCompare(String(a.s.startedAt)))[0];

  if (!latest) {
    return { phase: "ready", sessionId: null, required, entered: 0, members: [], selected };
  }

  const { id, s } = latest;
  const started = new Date(String(s.startedAt));
  const base = {
    sessionId: id,
    required,
    entered: Number(s.enteredCount ?? 0),
    members: (s.members ?? []).map(nameOf),
    crew: crewOf(
      {
        state: String(s.state),
        members: s.members ?? [],
        enteredCount: Number(s.enteredCount ?? 0),
        enteredEmpNos: Array.isArray(s.enteredEmpNos) ? s.enteredEmpNos : undefined,
        verifiedEmpNos: Array.isArray(s.verifiedEmpNos) ? s.verifiedEmpNos : undefined,
        blockedEmpNo: s.blockedEmpNo ?? null,
      },
      nameOf,
    ),
    selected,
    // 젯슨 판정 세션에만 있는 값들. 키오스크 시연 세션에는 없습니다.
    message: s.message ? String(s.message) : undefined,
    tagged: s.headcount ? Number(s.headcount.tagged ?? 0) : undefined,
    verified: s.headcount ? Number(s.headcount.verified ?? 0) : undefined,
    signal: s.lastSignal?.at
      ? { kind: s.lastSignal.kind as KioskSignal, at: String(s.lastSignal.at) }
      : undefined,
  };

  /* 막힌 시각. 젯슨 세션은 문서 하나를 계속 쓰므로 startedAt(처음 검증을 시작한
   * 때)이 아니라 **마지막으로 막힌 때**를 봐야 합니다. 안 그러면 다시 시도했다가
   * 또 막혀도 "지난 차단"으로 보여 화면이 대기로 돌아갑니다. */
  const lastBlock = Array.isArray(s.blockLog) ? s.blockLog[s.blockLog.length - 1] : null;
  const blockedAt = String(lastBlock?.at ?? s.startedAt);

  /* 막힌 뒤 이 작업을 **다시 고르면** 새 시도입니다. 선택 시각보다 앞선 차단은
   * 지난 시도라 화면을 대기로 돌립니다 — 안 그러면 다시 온 사람이 문 앞에서
   * 아까 막힌 화면부터 보게 됩니다. 차단 기록 자체는 그대로 남습니다. */
  const selectedAt = selected ? String(ctxDoc.data()?.selectedAt ?? "") : "";
  if (s.state === "blocked" && selectedAt && blockedAt < selectedAt) {
    return {
      phase: "ready",
      sessionId: null,
      required,
      entered: 0,
      members: [],
      selected,
      step: "tagging",
    };
  }

  if (s.state === "blocked") {
    return {
      ...base,
      phase: "blocked",
      entered: 0,
      blockedReason: String(s.blockedReason ?? "검증을 통과하지 못했어요"),
      blockedAtLabel: hhmm.format(new Date(blockedAt)),
    };
  }
  if (s.state === "closed") {
    const d = Number(s.durationMinutes ?? 0);
    return {
      ...base,
      phase: "closed",
      entered: 0,
      startedAtLabel: hhmm.format(started),
      durationLabel: elapsedLabel(d),
    };
  }
  if (s.state === "working") {
    const minutes = Math.max(0, Math.floor((Date.now() - started.getTime()) / 60_000));
    return {
      ...base,
      phase: "working",
      startedAtLabel: hhmm.format(started),
      expectedEndLabel:
        estimated > 0
          ? hhmm.format(new Date(started.getTime() + estimated * 60_000))
          : undefined,
      elapsed: elapsedLabel(minutes),
      overtime: estimated > 0 && minutes > estimated,
    };
  }
  // tagging · face · verifying · unlocking — 아직 문 앞입니다.
  const step =
    s.state === "face" || s.state === "verifying" || s.state === "unlocking"
      ? s.state
      : "tagging";
  return { ...base, phase: "ready", step };
}
