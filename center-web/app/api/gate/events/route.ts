import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { isResponse, requireGate } from "@/lib/firebase/gate-auth";
import { loadMasters } from "@/lib/firebase/queries";
import { qualificationStatus } from "@/lib/firebase/user";
import type { GateEvent, GateEventsRequest, GateStateResponse } from "@/lib/gate-contract";

/* ────────────────────────────────────────────────────────────────────────────
 * 젯슨 → 웹 수신구. 지금은 **길만 열어둔 상태**입니다.
 *
 * 하는 일: 요청 형태 검증 + 게이트·작업 문맥 확인 + 중복 제거 + Firestore 기록.
 * 아직 안 하는 일: 세션 상태 계산(인원 충족·해정 판정), 3회 실패 알림.
 *
 * 이 파일이 존재하는 이유는 상하 님이 젯슨 쪽을 만들 때 **지금 바로 쏴볼 대상**이
 * 있어야 하기 때문입니다. 계약(요청/응답 형태)이 고정돼 있으면 서버 내부가
 * 비어 있어도 양쪽이 동시에 진행할 수 있습니다.
 *
 * 인증: 게이트별 device key 를 X-Gate-Key 헤더로 받습니다.
 * 젯슨에는 Firebase 키를 심지 않습니다 — 기기가 현장에 물리적으로 노출돼 있어서
 * 키가 새면 DB 전체가 열립니다.
 *
 * 두 사람의 변경을 합친 모양입니다 (2026-09-27).
 *   - 상하 님: 요청마다 `gate_id` · `approval_request_id` 를 명시하고, 그 게이트와
 *     승인 작업이 같은 작업장인지 확인합니다. 젯슨 한 대를 한 게이트에 고정하지
 *     않아도 되게 하려는 설계입니다.
 *   - 병오: 기기 키를 실제로 대조합니다. 합치면서 **키가 본문의 `gate_id` 것과
 *     맞아야** 통과하도록 했습니다. 키만 보고 게이트를 찾던 방식이면 A 게이트
 *     키로 B 게이트 이벤트를 밀어넣을 수 있었습니다.
 * ──────────────────────────────────────────────────────────────────────────── */

function isValidEvent(e: unknown): e is GateEvent {
  if (typeof e !== "object" || e === null) return false;
  const v = e as Record<string, unknown>;
  return (
    typeof v.idempotency_key === "string" &&
    v.idempotency_key.length > 0 &&
    typeof v.kind === "string" &&
    typeof v.occurred_at === "string" &&
    !Number.isNaN(Date.parse(v.occurred_at)) &&
    typeof v.payload === "object" &&
    v.payload !== null
  );
}

const strings = (v: unknown): string[] => Array.isArray(v) ? v.map(String) : [];

async function applyEvents(
  body: GateEventsRequest,
  approval: FirebaseFirestore.DocumentData,
  events: GateEvent[],
): Promise<Omit<GateStateResponse, "accepted" | "duplicated">> {
  const db = adminDb();
  const masters = await loadMasters();
  const workCodeId = String(approval.workCode);
  const work = masters.workCodes.get(workCodeId);
  if (!work) throw new Error("work code missing");

  const ref = db.collection("gateSessions").doc(`${body.gate_id}__${body.approval_request_id}`);
  const snap = await ref.get();
  const old = snap.exists ? snap.data()! : {};
  const tagged = new Set(strings(old.taggedEmpNos));
  const face = new Set(strings(old.facePassedEmpNos));
  const verified = new Set(strings(old.verifiedEmpNos));
  const entered = new Set(strings(old.enteredEmpNos));
  const members = new Set(strings(old.members));
  let state: GateStateResponse["state"] = old.state ?? "tagging";
  let message = String(old.message ?? "사원증을 태그해 주세요.");
  let unlock = false;
  let lastVerification: GateStateResponse["last_verification"] | undefined;
  let lastExit: GateStateResponse["last_exit"] | undefined;
  let shouldClearContext = false;

  const block = (empNo: string, reason: NonNullable<GateStateResponse["last_verification"]>["block_reason"], text: string, attempt = 0, failed: string[] = []) => {
    state = "blocked";
    message = text;
    lastVerification = { emp_no: empNo, passed: false, failed_items: failed, attempt, block_reason: reason };
    shouldClearContext = true;
  };

  for (const event of events) {
    const p = event.payload as unknown as Record<string, unknown>;
    if (event.kind === "card_tag") {
      const uid = String(p.card_uid ?? "");
      const card = uid ? await db.collection("employeeCards").doc(uid).get() : null;
      const empNo = card?.exists ? String(card.data()!.empNo) : "";
      const employee = empNo ? masters.employees.get(empNo) : undefined;
      if (!card?.exists) { block("", "card_unknown", "등록되지 않은 사원증입니다."); continue; }
      if (card.data()!.revokedAt) { block(empNo, "card_revoked", "폐기된 사원증입니다."); continue; }
      if (!employee || employee.active === false) { block(empNo, "employee_inactive", "사용할 수 없는 직원 계정입니다."); continue; }
      const allowed = Array.isArray(employee.allowedWorkCodes) ? employee.allowedWorkCodes.map(String) : null;
      if (allowed && !allowed.includes(workCodeId)) { block(empNo, "not_assigned", "이 작업에 배정되지 않은 작업자입니다."); continue; }
      const held = new Map<string, string>((employee.qualifications ?? []).map((q: { code: string; expiresOn: string }) => [String(q.code), String(q.expiresOn)]));
      const missing = strings(work.requiredQualifications).find((code) => {
        const expires = held.get(code);
        return !expires || qualificationStatus(expires).status === "expired";
      });
      if (missing) { block(empNo, "qualification", `${masters.qualNames.get(missing) ?? missing} 자격이 없거나 만료됐습니다.`); continue; }
      tagged.add(empNo); members.add(empNo); state = "face"; message = "얼굴을 확인하고 있습니다.";
      continue;
    }

    const empNo = typeof p.emp_no === "string" ? p.emp_no : "";
    if (!empNo || !tagged.has(empNo)) continue;
    if (event.kind === "face_match") {
      if (p.matched === true && p.live !== false) { face.add(empNo); state = "verifying"; message = "얼굴 확인 완료 · 보호구를 확인하고 있습니다."; }
      else { state = "face"; message = "얼굴 확인에 실패했습니다. 다시 시도해 주세요."; lastVerification = { emp_no: empNo, passed: false, failed_items: [], attempt: 0, block_reason: "face" }; }
    } else if (event.kind === "ppe_check") {
      const items = Array.isArray(p.items) ? p.items : [];
      const worn = new Set(items.filter((x) => typeof x === "object" && x !== null && (x as { worn?: boolean }).worn === true).map((x) => String((x as { code?: string }).code)));
      const required = strings(work.requiredPpe).filter((code) => masters.ppeYolo.get(code) !== null);
      const failed = required.filter((code) => !worn.has(code));
      const attempt = Math.max(1, Number(p.attempt ?? 1));
      if (!face.has(empNo)) { state = "face"; message = "얼굴 확인을 먼저 진행해 주세요."; }
      else if (failed.length && attempt >= 3) block(empNo, "ppe", `${failed.map((x) => masters.ppeNames.get(x) ?? x).join(", ")} 미착용으로 입장이 차단됐습니다.`, attempt, failed);
      else if (failed.length) { state = "verifying"; message = `필수 보호구를 확인해 주세요. (${attempt}/3)`; lastVerification = { emp_no: empNo, passed: false, failed_items: failed, attempt, block_reason: "ppe" }; }
      else {
        verified.add(empNo);
        lastVerification = { emp_no: empNo, passed: true, failed_items: [], attempt };
        const needed = Number(work.requiredHeadcount ?? 1);
        unlock = verified.size >= needed;
        state = unlock ? "unlocking" : "tagging";
        message = unlock ? "검증 완료 · 문을 열 수 있습니다." : `검증 완료 · 추가 인원 ${needed - verified.size}명 대기 중입니다.`;
        if (unlock) shouldClearContext = true;
      }
    } else if (event.kind === "entry" && verified.has(empNo)) {
      entered.add(empNo);
      const ready = verified.size >= Number(work.requiredHeadcount ?? 1);
      state = ready ? "working" : "tagging";
      message = ready ? "입장 처리되었습니다." : `입장 확인 · 추가 인원 ${Number(work.requiredHeadcount ?? 1) - verified.size}명 대기 중입니다.`;
    } else if (event.kind === "exit") {
      entered.delete(empNo); lastExit = { emp_no: empNo }; message = "퇴장 처리되었습니다.";
    }
  }

  const required = Number(work.requiredHeadcount ?? 1);
  const headcount = { required, tagged: tagged.size, verified: verified.size, entered: entered.size };
  const now = new Date().toISOString();
  await ref.set({
    gateId: body.gate_id, siteId: approval.siteId, workCode: workCodeId,
    approvalRequestId: body.approval_request_id, state, members: [...members],
    enteredCount: entered.size, startedAt: old.startedAt ?? now, endedAt: old.endedAt ?? null,
    taggedEmpNos: [...tagged], facePassedEmpNos: [...face], verifiedEmpNos: [...verified], enteredEmpNos: [...entered],
    headcount, unlock, message, lastVerification: lastVerification ?? old.lastVerification ?? null,
    lastExit: lastExit ?? old.lastExit ?? null, simulated: false, updatedAt: now,
    ...(state === "blocked" ? { blockedReason: message } : {}),
  }, { merge: true });
  if (shouldClearContext) {
    const ctx = db.collection("kioskContexts").doc(body.gate_id);
    const ctxSnap = await ctx.get();
    if (ctxSnap.data()?.approvalRequestId === body.approval_request_id) await ctx.delete();
  }
  return { session_id: ref.id, state, headcount, last_verification: lastVerification, last_exit: lastExit, unlock, message };
}

export async function POST(request: Request) {
  // 키가 없으면 본문을 읽기 전에 돌려보냅니다.
  if (!request.headers.get("x-gate-key")) {
    return NextResponse.json(
      { error: "X-Gate-Key 헤더가 필요해요." },
      { status: 401 },
    );
  }

  let body: GateEventsRequest;
  try {
    body = (await request.json()) as GateEventsRequest;
  } catch {
    return NextResponse.json({ error: "JSON 형식이 아니에요." }, { status: 400 });
  }

  if (
    typeof body?.gate_id !== "string" ||
    body.gate_id.length === 0 ||
    typeof body?.approval_request_id !== "string" ||
    body.approval_request_id.length === 0 ||
    !Array.isArray(body?.events)
  ) {
    return NextResponse.json(
      { error: "gate_id · approval_request_id · events 배열이 필요해요." },
      { status: 400 },
    );
  }

  // 키가 본문이 말하는 그 게이트의 것인지. 게이트가 없으면 404 도 여기서 납니다.
  const gate = await requireGate(request, body.gate_id);
  if (isResponse(gate)) return gate;

  // 선택한 키오스크 화면의 게이트와 승인 작업이 실제로 같은 작업장인지 먼저
  // 확인합니다. 이 검증이 없으면 다른 작업장의 Jetson 이벤트가 섞일 수 있습니다.
  const db = adminDb();
  const requestSnap = await db
    .collection("approvalRequests")
    .doc(body.approval_request_id)
    .get();
  if (!requestSnap.exists) {
    return NextResponse.json(
      { error: "선택한 게이트 또는 승인 작업을 찾을 수 없어요." },
      { status: 404 },
    );
  }
  const approval = requestSnap.data()!;
  if (approval.status !== "approved") {
    return NextResponse.json(
      { error: "승인된 작업만 현장 검증할 수 있어요." },
      { status: 409 },
    );
  }
  if (gate.siteId !== String(approval.siteId)) {
    return NextResponse.json(
      { error: "게이트와 승인 작업장의 위치가 일치하지 않아요." },
      { status: 409 },
    );
  }

  const invalid = body.events.findIndex((e) => !isValidEvent(e));
  if (invalid !== -1) {
    return NextResponse.json(
      {
        error: `events[${invalid}] 형태가 올바르지 않아요. idempotency_key · kind · occurred_at(ISO 8601) · payload 가 모두 필요해요.`,
      },
      { status: 400 },
    );
  }

  /* 중복 제거를 문서 ID 로 합니다.
   *
   * idempotency_key 를 문서 ID 로 쓰고 create() 를 부르면, 같은 키가 이미 있을 때
   * Firestore 가 ALREADY_EXISTS 로 거절합니다. 메모리 Set 과 달리 서버를 재시작해도
   * 유지되고, 서버가 여러 대여도 동작합니다. */
  const receivedAt = new Date().toISOString();
  let accepted = 0;
  let duplicated = 0;
  const acceptedEvents: GateEvent[] = [];

  for (const event of body.events) {
    try {
      await db
        .collection("gateEvents")
        .doc(event.idempotency_key)
        .create({
          idempotencyKey: event.idempotency_key,
          sessionId: null, // 세션 매칭은 상태 계산이 붙을 때 채웁니다
          // 기기 키가 아니라 게이트 ID 를 남깁니다 — 비밀값을 기록에 남길 이유가 없습니다
          gateId: gate.id,
          approvalRequestId: body.approval_request_id,
          kind: event.kind,
          payload: event.payload,
          occurredAt: event.occurred_at,
          receivedAt,
        });
      accepted += 1;
      acceptedEvents.push(event);
    } catch (err) {
      // ALREADY_EXISTS = 중복. 그 외 오류는 그대로 알립니다.
      const code = (err as { code?: number }).code;
      if (code === 6) {
        duplicated += 1;
      } else {
        return NextResponse.json(
          { error: "이벤트를 기록하지 못했어요." },
          { status: 500 },
        );
      }
    }
  }

  const decision = await applyEvents(body, approval, acceptedEvents);
  if (acceptedEvents.length) {
    const batch = db.batch();
    acceptedEvents.forEach((event) => batch.update(
      db.collection("gateEvents").doc(event.idempotency_key),
      { sessionId: decision.session_id },
    ));
    await batch.commit();
  }
  const response: GateStateResponse = { ...decision, accepted, duplicated };

  return NextResponse.json(response);
}

/** 연결 확인용. 젯슨 쪽에서 주소가 맞는지 먼저 찔러볼 수 있게 열어둡니다. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    contract: "lib/gate-contract.ts",
    note: "POST 로 { gate_id, approval_request_id, events: [...] } 를 보내세요. X-Gate-Key 헤더(그 게이트의 키)가 필요합니다.",
  });
}
