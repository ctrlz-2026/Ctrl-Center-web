import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { isResponse, requireGate } from "@/lib/firebase/gate-auth";
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

  // TODO: 아래 값들은 지금 고정입니다. 세션 상태 계산이 붙으면 실제 값이 나갑니다.
  const response: GateStateResponse = {
    session_id: "not-implemented",
    state: "tagging",
    headcount: { required: 0, tagged: 0, verified: 0, entered: 0 },
    unlock: false,
    message: "서버 준비 중이에요.",
    accepted,
    duplicated,
  };

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
