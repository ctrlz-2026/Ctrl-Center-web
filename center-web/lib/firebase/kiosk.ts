import "server-only";

import { adminDb } from "./admin";
import { seoulDate } from "./bundle";
import {
  elapsedLabel,
  isWaitingToday,
  startedRequestIdsOf,
} from "./dashboard";
import { loadMasters } from "./queries";
import type { KioskStatus } from "@/lib/kiosk-types";

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
  /** 작업 예정 시각 (HH:mm). 없으면 지정 안 한 요청입니다. */
  scheduledAt?: string;
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
    scheduledAt: r.scheduledAt ? hhmm.format(new Date(r.scheduledAt)) : undefined,
  };
}

/** 이 게이트에 띄울 작업들.
 *
 *  **승인된 오늘 작업만** 올라옵니다. 승인이 곧 게이트 노출 조건이라, 신청만
 *  하고 결재가 안 난 작업은 키오스크에 아예 보이지 않습니다.
 *
 *  이미 문이 열린 요청은 뺍니다 — 남아 있으면 같은 작업으로 두 번 들어갑니다.
 *  **차단만 된 요청은 남깁니다.** 막힌 사람이 보호구를 갖추고 다시 와야 하는데
 *  목록에서 사라지면 다시 시도할 길이 없습니다. */
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
  const today = seoulDate();

  return reqSnap.docs
    .filter((d) => isWaitingToday(d.data(), started, d.id, today))
    .map((d) => toTask(d.id, d.data(), masters))
    .sort((a, b) => (a.scheduledAt ?? "").localeCompare(b.scheduledAt ?? ""));
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
    selected,
  };

  /* 막힌 뒤 이 작업을 **다시 고르면** 새 시도입니다. 선택 시각보다 앞선 차단은
   * 지난 시도라 화면을 대기로 돌립니다 — 안 그러면 다시 온 사람이 문 앞에서
   * 아까 막힌 화면부터 보게 됩니다. 차단 기록 자체는 그대로 남습니다. */
  const selectedAt = selected ? String(ctxDoc.data()?.selectedAt ?? "") : "";
  if (s.state === "blocked" && selectedAt && String(s.startedAt) < selectedAt) {
    return { phase: "ready", sessionId: null, required, entered: 0, members: [], selected };
  }

  if (s.state === "blocked") {
    return {
      ...base,
      phase: "blocked",
      entered: 0,
      blockedReason: String(s.blockedReason ?? "검증을 통과하지 못했어요"),
      blockedAtLabel: hhmm.format(started),
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
  return { ...base, phase: "ready" };
}
