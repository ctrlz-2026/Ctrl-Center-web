import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { isResponse, requireCaller } from "@/lib/firebase/auth-guard";

/* 젯슨 대역 — 웹에서 게이트를 수동으로 진행시킵니다.
 *
 * 원래는 작업자가 키오스크에서 작업을 고르고, 사원증을 태그하고, 얼굴·보호구
 * 검증을 통과하면 문이 열립니다. 그 기기가 아직 없으므로 관제 화면에서
 * 같은 상태 전이를 손으로 넘길 수 있게 했습니다.
 *
 *   승인됨 ──[임시 문열림]──▶ 진행중 ──[업무 종료]──▶ 종료
 *
 * **문이 열리면 곧 작업 시작입니다.** 예전엔 "문열림"과 "작업 시작"이 별도
 * 버튼이었는데, 문을 열어놓고 작업을 안 하는 경우는 없다고 판단해 한 동작으로
 * 합쳤습니다(팀 결정, docs/backend-design.md §7 참고). 젯슨 연동 후에도 이
 * 규칙은 그대로입니다 — `lib/gate-contract.ts` 의 상태 순서가 `unlocking` 다음
 * 바로 `working` 인 이유이기도 합니다.
 *
 * 젯슨이 붙으면 이 경로는 지웁니다. 상태 전이 로직 자체는 /api/gate/events 로
 * 옮겨가고, 전이 규칙(어떤 상태에서 어디로 갈 수 있는지)은 그대로 씁니다.
 *
 * **예정 시각은 진입을 막지 않습니다.** 미리 시작하든 늦게 시작하든 통과시키고,
 * 예정 대비 얼마나 차이 났는지만 세션에 기록합니다. */

type Action = "unlock" | "end" | "dismiss";

/** 수동 조작으로 만든 출입 기록임을 남깁니다 — 실제 태그·얼굴인식을 거치지
 *  않았으므로 나중에 통계를 낼 때 구분할 수 있어야 합니다. */
const MANUAL = { manual: true as const };

export async function POST(request: Request) {
  const caller = await requireCaller(request);
  if (isResponse(caller)) return caller;

  // 현장 제어라 결재권자와 안전관리자만 누를 수 있습니다.
  if (caller.role !== "leader" && caller.role !== "safety_admin") {
    return NextResponse.json(
      { error: "게이트를 제어할 권한이 없어요." },
      { status: 403 },
    );
  }

  let body: { action?: Action; requestId?: string; sessionId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON 형식이 아니에요." }, { status: 400 });
  }

  const db = adminDb();
  const now = new Date().toISOString();

  // ── 임시 문열림: 승인된 요청으로 게이트 세션을 엽니다 ────────────────────
  if (body.action === "unlock") {
    if (!body.requestId) {
      return NextResponse.json({ error: "requestId 가 필요해요." }, { status: 400 });
    }
    const reqRef = db.collection("approvalRequests").doc(body.requestId);
    const reqSnap = await reqRef.get();
    if (!reqSnap.exists) {
      return NextResponse.json({ error: "없는 요청이에요." }, { status: 404 });
    }
    const r = reqSnap.data()!;
    if (r.status !== "approved") {
      return NextResponse.json(
        { error: "승인된 작업만 문을 열 수 있어요." },
        { status: 409 },
      );
    }

    // 같은 요청으로 세션이 두 번 열리면 인원 집계가 섞입니다.
    const existing = await db
      .collection("gateSessions")
      .where("approvalRequestId", "==", body.requestId)
      .limit(1)
      .get();
    if (!existing.empty) {
      return NextResponse.json(
        { error: "이미 게이트가 열린 작업이에요." },
        { status: 409 },
      );
    }

    const gate = await db
      .collection("gates")
      .where("siteId", "==", r.siteId)
      .limit(1)
      .get();

    // 문이 열리면 곧 작업 시작이므로 별도 "작업 시작" 클릭 없이 바로 진행중으로 둡니다.
    const members = [r.requesterId];
    const sessionRef = db.collection("gateSessions").doc();
    await sessionRef.set({
      gateId: gate.empty ? null : gate.docs[0].id,
      siteId: r.siteId,
      workCode: r.workCode,
      approvalRequestId: body.requestId,
      state: "working",
      scheduledAt: r.scheduledAt ?? null,
      startedAt: now,
      endedAt: null,
      members,
      enteredCount: members.length,
      // 시연용 요청에서 연 세션은 시연용입니다. 안 물려주면 시연 도중 문을 연
      // 작업만 3시간 뒤 자동 종료 대상이 돼, 나머지와 다르게 굴러갑니다.
      ...(r.demo === true ? { demo: true } : {}),
      ...MANUAL,
    });

    // 개인별 출입 기록. 수동 조작이라 얼굴·보호구 판정은 남기지 않습니다 —
    // 하지 않은 검증을 통과했다고 적으면 기록이 거짓말이 됩니다.
    const batch = db.batch();
    for (const empNo of members) {
      batch.set(db.collection("accessLogs").doc(`${sessionRef.id}_${empNo}`), {
        sessionId: sessionRef.id,
        empNo,
        gateId: gate.empty ? null : gate.docs[0].id,
        siteId: r.siteId,
        workCode: r.workCode,
        cardUid: null,
        taggedAt: null,
        faceMatched: null,
        faceScore: null,
        ppePassed: null,
        ppeAttempts: 0,
        enteredAt: now,
        exitedAt: null,
        ...MANUAL,
      });
    }
    await batch.commit();

    return NextResponse.json({ ok: true, sessionId: sessionRef.id, state: "working" });
  }

  /* ── 차단 확인 ───────────────────────────────────────────────────────────
   * 차단된 세션을 표에서 내립니다.
   *
   * 차단은 시간이 지나도 저절로 사라지지 않게 뒀습니다. 자격 미달로 막힌 사람이
   * 있었다는 사실은 누군가 보고 조치해야 하는 것이라, 아무도 안 봤는데 화면에서
   * 없어지면 안 됩니다. 그래서 내리는 것도 사람이 누르고, **누가 언제 확인했는지**
   * 를 세션에 남깁니다.
   *
   * 통과율 분모에는 그대로 들어갑니다 — 검증에서 실제로 막힌 건이라 빼면
   * 통과율이 실제보다 좋아 보입니다. (자동 종료를 분모에서 빼는 것과 다른
   * 이유입니다. 그쪽은 판정 자체가 없는 세션이라 뺐습니다.) */
  if (body.action === "dismiss") {
    if (!body.sessionId) {
      return NextResponse.json({ error: "sessionId 가 필요해요." }, { status: 400 });
    }
    const ref = db.collection("gateSessions").doc(body.sessionId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "없는 세션이에요." }, { status: 404 });
    }
    if (snap.data()!.state !== "blocked") {
      return NextResponse.json(
        { error: "차단된 작업만 확인 처리할 수 있어요." },
        { status: 409 },
      );
    }

    await ref.update({
      state: "closed",
      endedAt: now,
      durationMinutes: 0,
      passedFirstTry: false,
      dismissedBy: caller.empNo,
      dismissedAt: now,
      verification: "차단 — 관제에서 확인 처리",
    });

    return NextResponse.json({ ok: true, state: "closed" });
  }

  // ── 업무 종료 ────────────────────────────────────────────────────────────
  if (body.action !== "end") {
    return NextResponse.json(
      { error: "action 은 unlock · end · dismiss 중 하나여야 해요." },
      { status: 400 },
    );
  }
  if (!body.sessionId) {
    return NextResponse.json({ error: "sessionId 가 필요해요." }, { status: 400 });
  }

  const ref = db.collection("gateSessions").doc(body.sessionId);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ error: "없는 세션이에요." }, { status: 404 });
  }
  const s = snap.data()!;

  if (s.state !== "working") {
    return NextResponse.json(
      { error: "진행중인 작업만 종료할 수 있어요." },
      { status: 409 },
    );
  }

  const durationMinutes = Math.max(
    1,
    Math.round((Date.now() - new Date(String(s.startedAt)).getTime()) / 60_000),
  );

  await ref.update({
    state: "closed",
    endedAt: now,
    durationMinutes,
    // 수동 진행이라 검증을 거치지 않았습니다. 1차 통과로 적으면 통과율이 부풀려집니다.
    passedFirstTry: false,
    verification: "웹에서 수동 진행 (검증 미실시)",
  });

  const logs = await db
    .collection("accessLogs")
    .where("sessionId", "==", body.sessionId)
    .get();
  const batch = db.batch();
  for (const l of logs.docs) batch.update(l.ref, { exitedAt: now });
  await batch.commit();

  return NextResponse.json({ ok: true, state: "closed", durationMinutes });
}
