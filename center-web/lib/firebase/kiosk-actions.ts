import "server-only";

import { NextResponse } from "next/server";
import { adminDb } from "./admin";

/* 키오스크에서 일어나는 현장 진행.
 *
 *   작업 선택 ──▶ (젯슨 검증) ──▶ 문 열림 = 작업 시작 ──▶ 작업 종료
 *
 * 관제 화면에 있던 수동 버튼을 여기로 옮겼습니다 (2026-09-27). 관제는 보는
 * 곳이고, 문을 여닫는 건 문 앞에서 합니다.
 *
 * 두 가지입니다. (시연 버튼 simulate* 는 2026-10-07 에 지웠습니다.)
 *   1. selectWork   — 키오스크에서 작업을 고름. 젯슨이 "지금 어느 작업의 검증인지"
 *                     알 수 있게 게이트별로 서버에 적어둡니다 (kioskContexts).
 *   2. endWork      — 작업 종료. 기기가 붙은 뒤에도 남는 기능입니다.
 *
 * 키오스크는 로그인이 없는 화면이라 이 경로들도 토큰을 요구하지 않습니다. 대신
 * 무엇이든 **요청한 게이트와 같은 작업장의 것**인지 확인하고, 상태 전이가 맞을
 * 때만 받습니다 (진행중이 아니면 종료 불가 등). 젯슨이 붙으면 종료도 사원증
 * 태그(퇴장 이벤트)로 바뀌고 이 경로는 "모두 나갔는지 확인"만 하게 됩니다. */

export function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

/** 다른 사이트에서 키오스크 경로를 대신 눌러 보내는 것을 막습니다.
 *  브라우저가 붙이는 Origin 이 있으면 우리 주소와 같아야 합니다. */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

async function loadGateAndRequest(gateId: string, requestId: string) {
  const db = adminDb();
  const [gateDoc, reqDoc] = await Promise.all([
    db.collection("gates").doc(gateId).get(),
    db.collection("approvalRequests").doc(requestId).get(),
  ]);
  if (!gateDoc.exists) return fail(404, "없는 게이트예요.");
  if (!reqDoc.exists) return fail(404, "없는 작업이에요.");
  const gate = gateDoc.data()!;
  const r = reqDoc.data()!;
  // 상하 님 이벤트 수신구와 같은 두 가지 확인입니다.
  if (r.status !== "approved") return fail(409, "승인된 작업만 시작할 수 있어요.");
  if (String(gate.siteId) !== String(r.siteId)) {
    return fail(409, "이 게이트의 작업이 아니에요.");
  }
  return { siteId: String(gate.siteId), r };
}

/** 이 요청으로 이미 문이 열렸는지 (진행중이거나 끝남). */
async function alreadyOpened(requestId: string) {
  const snap = await adminDb()
    .collection("gateSessions")
    .where("approvalRequestId", "==", requestId)
    .get();
  return snap.docs.some((d) => d.data().state !== "blocked");
}

// ── 1. 작업 선택 ──────────────────────────────────────────────────────────

export async function selectWork(gateId: string, requestId: string) {
  const loaded = await loadGateAndRequest(gateId, requestId);
  if (loaded instanceof NextResponse) return loaded;
  if (await alreadyOpened(requestId)) {
    return fail(409, "이미 문이 열린 작업이에요.");
  }

  /* 게이트마다 문서 하나. 새로 고르면 덮어씁니다 — 한 게이트 앞에서 동시에
   * 두 작업을 검증하지는 않습니다. 젯슨은 GET /api/gate/{gateId}/context 로
   * 이걸 읽고, 이벤트를 보낼 때 approval_request_id 로 그대로 돌려줍니다. */
  await adminDb()
    .collection("kioskContexts")
    .doc(gateId)
    .set({
      gateId,
      siteId: loaded.siteId,
      approvalRequestId: requestId,
      workCode: String(loaded.r.workCode),
      selectedAt: new Date().toISOString(),
    });
  return NextResponse.json({ ok: true });
}

// ── 2. 작업 종료 ──────────────────────────────────────────────────────────

export async function endWork(gateId: string, sessionId: string) {
  const db = adminDb();
  const [gateDoc, snap] = await Promise.all([
    db.collection("gates").doc(gateId).get(),
    db.collection("gateSessions").doc(sessionId).get(),
  ]);
  if (!gateDoc.exists) return fail(404, "없는 게이트예요.");
  if (!snap.exists) return fail(404, "없는 작업이에요.");
  const s = snap.data()!;
  if (String(s.siteId) !== String(gateDoc.data()!.siteId)) {
    return fail(409, "이 게이트의 작업이 아니에요.");
  }
  if (s.state !== "working") return fail(409, "진행중인 작업만 종료할 수 있어요.");

  const now = new Date().toISOString();
  const durationMinutes = Math.max(
    1,
    Math.round((Date.now() - new Date(String(s.startedAt)).getTime()) / 60_000),
  );
  await snap.ref.update({
    state: "closed",
    endedAt: now,
    durationMinutes,
    enteredCount: 0,
    endedVia: "kiosk",
  });

  const logs = await db.collection("accessLogs").where("sessionId", "==", sessionId).get();
  const batch = db.batch();
  for (const l of logs.docs) {
    if (!l.data().exitedAt) batch.update(l.ref, { exitedAt: now });
  }
  await batch.commit();

  return NextResponse.json({ ok: true, phase: "closed", durationMinutes });
}
