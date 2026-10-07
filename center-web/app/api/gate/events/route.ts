import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { isResponse, requireGate } from "@/lib/firebase/gate-auth";
import { applyEvents } from "@/lib/firebase/gate-judge";
import type { GateEvent, GateEventsRequest, GateStateResponse } from "@/lib/gate-contract";

/* ────────────────────────────────────────────────────────────────────────────
 * 젯슨 → 웹 수신구.
 *
 * 젯슨은 **관찰**(사원증을 읽었다 · 얼굴이 맞았다 · 보호구를 썼다 · 들어갔다)만
 * 보내고, **판정은 여기서** 합니다 (lib/gate-contract.ts 의 원칙).
 *
 *   1. 요청 형태 · 기기 키 · 게이트와 작업의 작업장 일치 확인
 *   2. 이벤트를 gateEvents 에 기록 (같은 키는 한 번만 — 재전송해도 안전)
 *   3. applyEvents(lib/firebase/gate-judge.ts) 가 작업별 세션(gateSessions)을 갱신하고 판정을 돌려줌
 *        사원증   등록·폐기 여부, 계정 활성, 작업 배정, 자격 유효
 *        얼굴     젯슨이 판정한 결과를 받아 기록
 *        보호구   작업코드의 필수 보호구 중 AI 가 볼 수 있는 것만 대조, 3회 실패 시 차단
 *        인원     검증 통과 인원이 차야 문이 열리고, **전원이 들어가야** 작업 중
 *
 * 세션 문서는 `{게이트}__{승인요청}` 하나입니다. 관제 화면과 키오스크 진행
 * 화면이 이 문서의 state · members · enteredCount · startedAt · blockedReason 을
 * 읽습니다.
 *
 * 인증: 게이트별 device key 를 X-Gate-Key 헤더로 받습니다. 키는 본문의
 * `gate_id` 것과 맞아야 합니다 — A 게이트 키로 B 게이트 이벤트를 밀어넣을 수
 * 없습니다. 젯슨에는 Firebase 키를 심지 않습니다. 기기가 현장에 노출돼 있어서
 * 키가 새면 DB 전체가 열립니다.
 *
 * 만든 사람: 판정 로직(applyEvents) 상하 · 인증과 수신 틀 병오.
 * 2026-10-05 병합하며 고친 것 — 작업 중 기준을 검증 인원에서 **입장 인원**으로,
 * 작업 시작 시각을 첫 태그에서 **첫 입장**으로, 차단 이력 누적, 끝난 작업 보호.
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
          sessionId: null, // 판정이 끝난 뒤 아래에서 세션 ID 를 채웁니다
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
        // The receipt may have been created before a failed session update.
        // Retry unfinished receipts; the transactional judge deduplicates them.
        const receipt = await db.collection("gateEvents").doc(event.idempotency_key).get();
        const stored = receipt.data();
        if (stored && (stored.gateId !== body.gate_id || stored.approvalRequestId !== body.approval_request_id)) {
          return NextResponse.json({ error: "다른 작업에서 사용된 이벤트 키입니다." }, { status: 409 });
        }
        if (stored && !stored.sessionId) acceptedEvents.push({
          idempotency_key: event.idempotency_key,
          kind: stored.kind,
          payload: stored.payload,
          occurred_at: stored.occurredAt,
        } as GateEvent);
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
