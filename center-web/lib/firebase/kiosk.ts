import "server-only";

import { adminDb } from "./admin";
import { loadMasters } from "./queries";

/* 키오스크(터치패드) 화면 데이터.
 *
 * 이 화면은 **로그인한 사람이 없는 화면**입니다. 현장 벽에 붙어 있고 아무나
 * 만질 수 있으므로, 사용자 토큰이 아니라 서버가 직접 Firestore 를 읽어
 * 필요한 것만 내려줍니다. 브라우저로 키가 나가면 안 되기 때문에 이 파일은
 * server-only 이고, 화면은 서버 컴포넌트로만 씁니다.
 *
 * 지금은 겉 화면(작업 선택)까지입니다. 사원증 태그·얼굴인식·PPE 판정은
 * 젯슨이 하고, 웹은 lib/gate-contract.ts 계약으로 결과만 받습니다. */

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

const hhmm = new Intl.DateTimeFormat("ko-KR", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Seoul",
});

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

/** 이 게이트에 띄울 작업들.
 *
 *  **승인된 요청만** 올라옵니다. 승인이 곧 게이트 노출 조건이라, 신청만 하고
 *  결재가 안 난 작업은 키오스크에 아예 보이지 않습니다 — 입장 시도 자체가
 *  불가능해야 하기 때문입니다.
 *
 *  이미 세션이 시작된 요청도 뺍니다. 한 번 문이 열린 작업이 목록에 남아 있으면
 *  같은 작업으로 두 번 들어가게 됩니다. */
export async function loadKioskTasks(siteId: string): Promise<KioskTask[]> {
  const db = adminDb();
  const [masters, reqSnap, sessionSnap] = await Promise.all([
    loadMasters(),
    db.collection("approvalRequests").where("siteId", "==", siteId).get(),
    db.collection("gateSessions").get(),
  ]);

  const started = new Set(
    sessionSnap.docs
      .map((d) => d.data().approvalRequestId)
      .filter(Boolean)
      .map(String),
  );

  return reqSnap.docs
    .filter((d) => d.data().status === "approved" && !started.has(d.id))
    .map((d) => {
      const r = d.data();
      const wc = masters.workCodes.get(String(r.workCode));
      const emp = masters.employees.get(String(r.requesterId));
      return {
        requestId: d.id,
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
    })
    .sort((a, b) => a.code.localeCompare(b.code));
}

export async function loadKioskTask(
  siteId: string,
  requestId: string,
): Promise<KioskTask | null> {
  const tasks = await loadKioskTasks(siteId);
  return tasks.find((t) => t.requestId === requestId) ?? null;
}
