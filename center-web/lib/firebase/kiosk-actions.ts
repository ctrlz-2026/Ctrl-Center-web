import "server-only";

import { NextResponse } from "next/server";
import { adminDb } from "./admin";
import { applyEvents } from "./gate-judge";
import type { GateEvent, GateEventsRequest } from "@/lib/gate-contract";

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
 *   2. tagCard      — 화면이 사원증을 읽음 (USB 리더가 키보드처럼 동작해 브라우저가
 *                     입력을 받습니다). 판정은 젯슨 이벤트와 같은 함수가 합니다.
 *                     (전에 있던 시연 버튼 simulate* 는 2026-10-07 에 지웠습니다.)
 *   3. endWork      — 작업 종료. 기기가 붙은 뒤에도 남는 기능입니다.
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

// ── 2. 사원증 태그 ────────────────────────────────────────────────────────

/** 키오스크 화면이 사원증을 읽었을 때.
 *
 *  현장의 USB 리더는 **키보드처럼** 동작합니다 — 카드를 대면 번호를 빠르게 치고
 *  Enter 를 누릅니다. 그 입력은 화면에 떠 있는 브라우저가 받기 때문에, 젯슨의
 *  검증 프로그램이 아니라 키오스크 화면이 카드를 읽게 됩니다. 그래서 화면이
 *  읽은 번호를 여기로 보내고, 판정은 젯슨 이벤트와 **같은 함수**가 합니다.
 *
 *  기기 키 없이 받는 이유와 한계 — 키오스크 경로는 로그인도 기기 키도 없습니다.
 *  대신 사원증만으로는 문이 열리지 않습니다. 얼굴과 보호구 결과는 여전히 기기
 *  키가 있는 젯슨만 보낼 수 있습니다. 여기서 할 수 있는 일은 "이 사람이 카드를
 *  댔다"까지입니다. */
export async function tagCard(gateId: string, requestId: string, rawUid: string) {
  const typed = rawUid.trim();
  if (!/^[0-9A-Za-z-]{4,32}$/.test(typed)) {
    return fail(400, "사원증을 읽지 못했어요. 다시 대주세요.");
  }
  const loaded = await loadGateAndRequest(gateId, requestId);
  if (loaded instanceof NextResponse) return loaded;

  const db = adminDb();
  /* 리더가 치는 글자는 대문자로 들어오는데, 등록할 때 소문자로 적었을 수 있습니다.
     적힌 그대로 → 대문자 → 소문자 순으로 찾습니다. */
  const candidates = [...new Set([typed, typed.toUpperCase(), typed.toLowerCase()])];
  const [ctx, sessionSnap, ...cards] = await Promise.all([
    db.collection("kioskContexts").doc(gateId).get(),
    db.collection("gateSessions").doc(`${gateId}__${requestId}`).get(),
    ...candidates.map((c) => db.collection("employeeCards").doc(c).get()),
  ]);
  const card = cards.find((c) => c.exists);
  const uid = card?.id ?? typed;
  const empNo = card ? String(card.data()!.empNo) : "";

  const session = sessionSnap.data();
  const state = String(session?.state ?? "");
  if (state === "closed") return fail(409, "이미 끝난 작업이에요.");
  if (state === "working") return fail(409, "이미 작업 중이에요.");
  if (state === "unlocking") return fail(409, "문이 열려 있어요. 들어가세요.");
  // 막힌 뒤에는 「다시 시도」로 작업을 다시 골라야 이어집니다 (선택이 비워져 있음).
  if (ctx.data()?.approvalRequestId !== requestId) {
    return fail(409, "이 게이트에서 지금 고른 작업이 아니에요. 작업을 다시 골라 주세요.");
  }

  /* 모르는 번호는 **작업을 막지 않고** 돌려보냅니다. 젯슨이 보낸 미등록 카드는
     차단으로 기록하지만(기기가 실제로 읽은 카드), 화면으로 들어온 입력은 그만큼
     믿을 수 없습니다 — 리더가 치는 도중에 화면이 뜨면 번호 앞부분이 잘리고,
     누가 키보드로 아무 글자나 쳐도 여기로 옵니다. 그런 입력으로 작업이 막히면
     문 앞에서 「다시 시도」를 눌러야 하고, 아무나 작업을 멈출 수 있게 됩니다.
     시도는 기록에 남깁니다. */
  if (!card) {
    const at = new Date().toISOString();
    await db.collection("gateEvents").doc(`kiosk-${gateId}-${Date.now()}-unknown`).set({
      idempotencyKey: `kiosk-${gateId}-${Date.now()}-unknown`,
      sessionId: sessionSnap.exists ? sessionSnap.id : null,
      gateId,
      approvalRequestId: requestId,
      kind: "card_tag",
      payload: { card_uid: typed },
      occurredAt: at,
      receivedAt: at,
      source: "kiosk",
      result: "card_unknown",
    });
    return fail(404, "등록되지 않은 사원증이에요. 다시 대보고, 계속 안 되면 안전관리자에게 알려주세요.");
  }

  /* 한 번에 한 사람. 앞사람의 얼굴 · 보호구 확인이 끝나기 전에 다음 사람이 카드를
     대면 화면이 다시 "얼굴 확인"으로 돌아가 앞사람의 진행이 꼬입니다. */
  const tagged: string[] = (session?.taggedEmpNos ?? []).map(String);
  const verified = new Set<string>((session?.verifiedEmpNos ?? []).map(String));
  const pending = tagged.filter((e) => !verified.has(e));
  if (empNo && verified.has(empNo)) {
    return fail(409, "이미 확인이 끝난 사원증이에요. 다음 분이 대주세요.");
  }
  if (empNo && pending.includes(empNo) && (state === "face" || state === "verifying")) {
    // 같은 카드를 한 번 더 읽음 (리더가 두 번 쏘거나, 젯슨도 같은 카드를 읽음). 그대로 둡니다.
    return NextResponse.json({ ok: true, duplicate: true, state });
  }
  if (pending.length > 0 && (state === "face" || state === "verifying")) {
    return fail(409, "앞 사람 확인이 끝난 뒤에 사원증을 대주세요.");
  }

  const now = new Date().toISOString();
  const event: GateEvent = {
    idempotency_key: `kiosk-${gateId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: "card_tag",
    occurred_at: now,
    payload: { card_uid: uid },
  } as GateEvent;
  const body: GateEventsRequest = { gate_id: gateId, approval_request_id: requestId, events: [event] };

  // 젯슨 이벤트와 같은 곳에 남깁니다. 누가 읽었는지만 source 로 구분합니다.
  const decision = await applyEvents(body, loaded.r, [event]);
  await db.collection("gateEvents").doc(event.idempotency_key).set({
    idempotencyKey: event.idempotency_key,
    sessionId: decision.session_id,
    gateId,
    approvalRequestId: requestId,
    kind: event.kind,
    payload: event.payload,
    occurredAt: now,
    receivedAt: now,
    source: "kiosk",
  });
  return NextResponse.json({ ok: true, state: decision.state, message: decision.message });
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
