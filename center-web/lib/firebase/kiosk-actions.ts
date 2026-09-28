import "server-only";

import { NextResponse } from "next/server";
import { adminDb } from "./admin";
import { loadMasters } from "./queries";
import { qualificationStatus } from "./user";

/* 키오스크에서 일어나는 현장 진행.
 *
 *   작업 선택 ──▶ (젯슨 검증) ──▶ 문 열림 = 작업 시작 ──▶ 작업 종료
 *
 * 관제 화면에 있던 수동 버튼을 여기로 옮겼습니다 (2026-09-27). 관제는 보는
 * 곳이고, 문을 여닫는 건 문 앞에서 합니다.
 *
 * 세 가지로 나뉩니다.
 *   1. selectWork   — 키오스크에서 작업을 고름. 젯슨이 "지금 어느 작업의 검증인지"
 *                     알 수 있게 게이트별로 서버에 적어둡니다 (kioskContexts).
 *   2. simulate*    — **젯슨 대역.** 기기가 붙기 전 시연용이고, KIOSK_SIMULATION=on
 *                     일 때만 열립니다. 기기가 붙으면 이 두 함수는 지웁니다.
 *   3. endWork      — 작업 종료. 기기가 붙은 뒤에도 남는 기능입니다.
 *
 * 키오스크는 로그인이 없는 화면이라 이 경로들도 토큰을 요구하지 않습니다. 대신
 * 무엇이든 **요청한 게이트와 같은 작업장의 것**인지 확인하고, 상태 전이가 맞을
 * 때만 받습니다 (진행중이 아니면 종료 불가 등). 젯슨이 붙으면 종료도 사원증
 * 태그(퇴장 이벤트)로 바뀌고 이 경로는 "모두 나갔는지 확인"만 하게 됩니다. */

type Masters = Awaited<ReturnType<typeof loadMasters>>;

const LIVE = ["tagging", "face", "verifying", "unlocking", "working"];

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

async function clearContext(gateId: string, requestId: string) {
  const ref = adminDb().collection("kioskContexts").doc(gateId);
  const snap = await ref.get();
  if (snap.exists && snap.data()?.approvalRequestId === requestId) {
    await ref.delete();
  }
}

// ── 2. 젯슨 대역 (시연) ───────────────────────────────────────────────────

/** 작업코드가 요구하는 자격을 이 사람이 유효하게 갖고 있는지.
 *  **이 판정은 흉내가 아니라 진짜입니다** — 자격은 서버가 가진 데이터라
 *  기기 없이도 정확히 판단할 수 있습니다. 흉내 내는 건 얼굴·보호구뿐입니다. */
function missingQualification(
  masters: Masters,
  workCode: string,
  empNo: string,
): string | null {
  const required: string[] = masters.workCodes.get(workCode)?.requiredQualifications ?? [];
  const held: { code: string; expiresOn: string }[] =
    masters.employees.get(empNo)?.qualifications ?? [];
  for (const code of required) {
    const name = masters.qualNames.get(code) ?? code;
    const has = held.find((q) => q.code === code);
    if (!has) return `${name} 미보유`;
    if (qualificationStatus(has.expiresOn).status === "expired") return `${name} 만료`;
  }
  return null;
}

/** 같이 들어갈 사람을 고릅니다. 실제로는 한 명씩 사원증을 찍으며 모이는데,
 *  시연에서는 **규칙에 맞는 사람만** 골라 태웁니다.
 *    - 활성 계정 · 이 작업에 배정됨(또는 배정 제한 없음) · 필요한 자격이 유효
 *    - 지금 다른 작업장에 들어가 있지 않음 (「출입 및 인원관리 로직」 §9)
 *  같은 팀을 먼저 고릅니다 — 요청자와 같이 일하는 사람일 가능성이 높습니다. */
async function pickCrew(masters: Masters, workCode: string, requesterId: string) {
  const required = Number(masters.workCodes.get(workCode)?.requiredHeadcount ?? 1);
  const liveSnap = await adminDb().collection("gateSessions").get();
  const busy = new Set(
    liveSnap.docs
      .filter((d) => LIVE.includes(String(d.data().state)))
      .flatMap((d) => (d.data().members ?? []) as string[]),
  );
  const team = masters.employees.get(requesterId)?.team;

  const candidates = [...masters.employees.entries()]
    .filter(([empNo, e]) => {
      if (empNo === requesterId || busy.has(empNo)) return false;
      if (e.active === false || e.role === "safety_admin") return false;
      const allowed = Array.isArray(e.allowedWorkCodes) ? e.allowedWorkCodes : null;
      if (allowed && !allowed.includes(workCode)) return false;
      return missingQualification(masters, workCode, empNo) === null;
    })
    .sort(([a, ea], [b, eb]) => {
      const sa = ea.team === team ? 0 : 1;
      const sb = eb.team === team ? 0 : 1;
      return sa - sb || a.localeCompare(b);
    })
    .map(([empNo]) => empNo);

  return { required, crew: [requesterId, ...candidates.slice(0, required - 1)], busy };
}

async function writeSession(
  gateId: string,
  siteId: string,
  requestId: string,
  r: FirebaseFirestore.DocumentData,
  data: Record<string, unknown>,
) {
  const ref = adminDb().collection("gateSessions").doc();
  await ref.set({
    gateId,
    siteId,
    workCode: String(r.workCode),
    approvalRequestId: requestId,
    scheduledAt: r.scheduledAt ?? null,
    endedAt: null,
    // 기기 없이 진행한 세션입니다. 통계(1차 통과율)에서 뺍니다 —
    // 하지 않은 검증을 통과했다고 세면 숫자가 거짓말이 됩니다.
    simulated: true,
    ...(r.demo === true ? { demo: true } : {}),
    ...data,
  });
  return ref.id;
}

/** 검증 통과 → 문 열림 = 작업 시작. */
export async function simulatePass(gateId: string, requestId: string) {
  const loaded = await loadGateAndRequest(gateId, requestId);
  if (loaded instanceof NextResponse) return loaded;
  if (await alreadyOpened(requestId)) return fail(409, "이미 문이 열린 작업이에요.");

  const { siteId, r } = loaded;
  const masters = await loadMasters();
  const workCode = String(r.workCode);
  const requesterId = String(r.requesterId);
  const now = new Date().toISOString();

  // 요청자부터 서버가 진짜로 판정합니다. 자격이 없으면 문은 안 열립니다.
  const { required, crew, busy } = await pickCrew(masters, workCode, requesterId);
  const missing = missingQualification(masters, workCode, requesterId);
  const blockReason = missing
    ? missing
    : busy.has(requesterId)
      ? "다른 작업에 이미 들어가 있음"
      : null;
  if (blockReason) {
    const id = await writeSession(gateId, siteId, requestId, r, {
      state: "blocked",
      startedAt: now,
      members: [requesterId],
      enteredCount: 0,
      blockedReason: blockReason,
    });
    await clearContext(gateId, requestId);
    return NextResponse.json({ ok: true, sessionId: id, phase: "blocked" });
  }

  if (crew.length < required) {
    return fail(
      409,
      `같이 들어갈 수 있는 사람이 부족해요 (필요 ${required}명, 가능 ${crew.length}명).`,
    );
  }

  const id = await writeSession(gateId, siteId, requestId, r, {
    state: "working",
    startedAt: now,
    members: crew,
    enteredCount: crew.length,
    verification: "시연 — 젯슨 대역으로 진행 (얼굴·보호구 검증 미실시)",
    passedFirstTry: false,
  });

  // 개인별 출입 기록. 얼굴·보호구 판정은 하지 않았으므로 비워 둡니다.
  const batch = adminDb().batch();
  crew.forEach((empNo) => {
    batch.set(adminDb().collection("accessLogs").doc(`${id}_${empNo}`), {
      sessionId: id,
      empNo,
      gateId,
      siteId,
      workCode,
      cardUid: null,
      taggedAt: now,
      faceMatched: null,
      faceScore: null,
      ppePassed: null,
      ppeAttempts: 0,
      enteredAt: now,
      exitedAt: null,
      simulated: true,
    });
  });
  await batch.commit();
  await clearContext(gateId, requestId);
  return NextResponse.json({ ok: true, sessionId: id, phase: "working" });
}

/** 검증 실패 → 입장 차단. 얼굴·보호구는 기기 몫이라 여기서는 보호구 미착용을
 *  흉내 냅니다 — 작업에 필요한 첫 보호구를 안 썼다고 봅니다. */
export async function simulateBlock(gateId: string, requestId: string) {
  const loaded = await loadGateAndRequest(gateId, requestId);
  if (loaded instanceof NextResponse) return loaded;
  if (await alreadyOpened(requestId)) return fail(409, "이미 문이 열린 작업이에요.");

  const { siteId, r } = loaded;
  const masters = await loadMasters();
  const firstPpe: string | undefined = masters.workCodes.get(String(r.workCode))
    ?.requiredPpe?.[0];
  const ppeName = firstPpe ? (masters.ppeNames.get(firstPpe) ?? firstPpe) : "보호구";

  const id = await writeSession(gateId, siteId, requestId, r, {
    state: "blocked",
    startedAt: new Date().toISOString(),
    members: [String(r.requesterId)],
    enteredCount: 0,
    blockedReason: `${ppeName} 미착용 (3회 재시도 후 차단)`,
  });
  return NextResponse.json({ ok: true, sessionId: id, phase: "blocked" });
}

// ── 3. 작업 종료 ──────────────────────────────────────────────────────────

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
