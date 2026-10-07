import "server-only";

import { adminDb } from "./admin";
import { loadMasters } from "./queries";
import { qualificationStatus } from "./user";
import { entryAllowed } from "../entry-policy";
import type { GateEvent, GateEventsRequest, GateStateResponse } from "@/lib/gate-contract";

/* 문 앞 판정.
 *
 * 관찰(사원증을 읽었다 · 얼굴이 맞았다 · 보호구를 썼다 · 들어갔다)을 받아 작업별
 * 세션을 갱신하고 "지금 어느 단계인가 · 문을 열어도 되는가"를 돌려줍니다.
 *
 * 원래 젯슨 수신구(app/api/gate/events/route.ts) 안에 있었습니다. 키오스크 화면도
 * 사원증을 읽게 되면서(2026-10-07, /api/kiosk/{gateId}/tag) **같은 판정**을 써야
 * 해서 밖으로 꺼냈습니다 — 두 곳에 따로 두면 한쪽만 고쳐져 화면과 기기가 다른
 * 답을 내게 됩니다. 내용은 옮기기만 했고 바꾸지 않았습니다.
 *
 * 화면의 사원증 읽기는 같은 날 한 번 뺐다가 다시 넣었습니다. 뺀 이유는 "화면이
 * 카드를 가져가면 젯슨은 누가 댔는지 모른다"였는데, 빼고 보니 젯슨의 검증
 * 프로그램이 돌지 않는 동안에는 카드를 대도 아무 일도 일어나지 않았습니다.
 * 젯슨은 GET /api/gate/{gateId}/context 의 session.pending 으로 차례를 압니다.
 *
 * 만든 사람: 판정 로직 상하 · 2026-10-05 병합하며 고친 것(입장 인원 기준 · 첫 입장
 * 시각 · 차단 이력 누적 · 끝난 작업 보호) 병오. */

const strings = (v: unknown): string[] => Array.isArray(v) ? v.map(String) : [];

export async function applyEvents(
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
  /** 첫 입장 시각 = 작업 시작. 관제의 경과 시간과 자동 종료가 이 값을 씁니다. */
  let workStartedAt: string | null = old.workStartedAt ?? null;

  /* 이미 끝난 작업입니다. 키오스크에서 「작업 종료」를 누른 뒤에 늦게 도착한
   * 이벤트(네트워크 복구 후 재전송 등)가 세션을 다시 열면 안 됩니다. 기록
   * (gateEvents)은 이미 남았으니 상태는 건드리지 않고 끝났다고만 답합니다. */
  if (old.state === "closed") {
    const h = old.headcount ?? { required: Number(work.requiredHeadcount ?? 1), tagged: 0, verified: 0, entered: 0 };
    return { session_id: ref.id, state: "closed", headcount: { ...h, entered: 0 }, unlock: false, message: "이미 종료된 작업입니다." };
  }

  /* 막힌 기록은 **쌓아 둡니다.** 세션 문서가 게이트+작업으로 하나라, 막혔다가
   * 다시 시도해 통과하면 state 가 덮여 "막힌 적이 있었다"는 사실이 사라집니다.
   * 지우는 대신 남긴다는 원칙대로, 통과한 뒤에도 이 목록은 남습니다. */
  const blockLog: { at: string; empNo: string; reason: string; text: string }[] =
    Array.isArray(old.blockLog) ? [...old.blockLog] : [];
  /* 키오스크가 소리·화면으로 알릴 "방금 일어난 일". 한 번에 여러 이벤트가 오면
   * 마지막 것만 남습니다. */
  let signal: string | null = null;

  const block = (empNo: string, reason: NonNullable<GateStateResponse["last_verification"]>["block_reason"], text: string, attempt = 0, failed: string[] = []) => {
    state = "blocked";
    message = text;
    lastVerification = { emp_no: empNo, passed: false, failed_items: failed, attempt, block_reason: reason };
    shouldClearContext = true;
    blockLog.push({ at: new Date().toISOString(), empNo, reason: String(reason), text });
    signal = "blocked";
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
      if (verified.has(empNo)) {
        lastVerification = { emp_no: empNo, passed: true, failed_items: [], attempt: Number(old.lastVerification?.attempt ?? 1) };
        message = entered.has(empNo)
          ? "이미 입장이 기록된 작업자입니다. 퇴장은 실제 통과 확인 신호로 처리합니다."
          : "이미 얼굴·보호구 확인을 마쳤습니다. 다른 작업자의 확인 또는 입장 안내를 기다려 주세요.";
        continue;
      }
      tagged.add(empNo); members.add(empNo); state = "face"; message = "얼굴을 확인하고 있습니다.";
      signal = "card_ok";
      continue;
    }

    const empNo = typeof p.emp_no === "string" ? p.emp_no : "";
    if (!empNo || !tagged.has(empNo)) continue;
    // Late observations must not undo a completed verification or reopen work.
    if ((event.kind === "face_match" || event.kind === "ppe_check") &&
        (verified.has(empNo) || state === "working")) continue;
    if (event.kind === "face_match") {
      if (p.matched === true && p.live !== false) { face.add(empNo); state = "verifying"; message = "얼굴 확인 완료 · 보호구를 확인하고 있습니다."; signal = "face_ok"; }
      else { face.delete(empNo); state = "face"; message = "얼굴 확인에 실패했습니다. 다시 시도해 주세요."; lastVerification = { emp_no: empNo, passed: false, failed_items: [], attempt: 0, block_reason: "face" }; signal = "face_fail"; }
    } else if (event.kind === "ppe_check") {
      const items = Array.isArray(p.items) ? p.items : [];
      const worn = new Set(items.filter((x) => typeof x === "object" && x !== null && (x as { worn?: boolean }).worn === true).map((x) => String((x as { code?: string }).code)));
      const required = strings(work.requiredPpe).filter((code) => masters.ppeYolo.get(code) !== null);
      const failed = required.filter((code) => !worn.has(code));
      const attempt = Math.max(1, Number(p.attempt ?? 1));
      if (!face.has(empNo)) { state = "face"; message = "얼굴 확인을 먼저 진행해 주세요."; }
      else if (failed.length && attempt >= 3) block(empNo, "ppe", `${failed.map((x) => masters.ppeNames.get(x) ?? x).join(", ")} 미착용으로 입장이 차단됐습니다.`, attempt, failed);
      else if (failed.length) { state = "verifying"; message = `필수 보호구를 확인해 주세요. (${attempt}/3)`; lastVerification = { emp_no: empNo, passed: false, failed_items: failed, attempt, block_reason: "ppe" }; signal = "ppe_fail"; }
      else {
        verified.add(empNo);
        lastVerification = { emp_no: empNo, passed: true, failed_items: [], attempt };
        const needed = Number(work.requiredHeadcount ?? 1);
        unlock = verified.size >= needed;
        state = unlock ? "unlocking" : "tagging";
        message = unlock ? "검증 완료 · 문을 열 수 있습니다." : `검증 완료 · 추가 인원 ${needed - verified.size}명 대기 중입니다.`;
        signal = unlock ? "unlock" : "ppe_ok";
        if (unlock) shouldClearContext = true;
      }
    } else if (event.kind === "entry" && state !== "blocked" && entryAllowed(verified.has(empNo), verified.size, Number(work.requiredHeadcount ?? 1))) {
      /* 작업 시작 기준은 **실제로 들어간 사람 수**입니다 (「출입 및 인원관리
       * 로직」 §7). 검증을 통과한 수(verified)로 재면, 2명 작업에서 둘 다
       * 통과하고 한 명만 들어가도 "작업 중"이 됩니다 — 혼자 들어간 사람이
       * 화면상 2인 작업으로 보이게 되어 인원 미달 경고도 안 뜹니다. */
      entered.add(empNo);
      const need = Number(work.requiredHeadcount ?? 1);
      const ready = entered.size >= need;
      // 검증 인원이 찼으면 문은 열려 있는 상태입니다 — 나머지가 들어올 때까지
      // "문 열림"으로 두고, 전원이 들어가야 "작업 중"이 됩니다.
      state = ready ? "working" : verified.size >= need ? "unlocking" : "tagging";
      message = ready
        ? "입장 처리되었습니다."
        : `입장 확인 · 추가 인원 ${need - entered.size}명 대기 중입니다.`;
      signal = "entry";
      // 문이 열려 첫 사람이 들어간 때가 작업 시작입니다. 사원증을 처음 댄
      // 시각으로 잡으면 검증에 걸린 시간까지 작업 시간에 섞입니다.
      if (!workStartedAt) workStartedAt = event.occurred_at;
    } else if (event.kind === "entry") {
      message = "필요한 인원의 검증이 아직 끝나지 않아 입장할 수 없습니다.";
    } else if (event.kind === "exit") {
      entered.delete(empNo); lastExit = { emp_no: empNo }; message = "퇴장 처리되었습니다.";
      signal = "exit";
    }
  }

  const required = Number(work.requiredHeadcount ?? 1);
  /* "문을 열어도 되는가"는 그 순간의 이벤트가 아니라 **지금 상태**로 답합니다.
   * 검증 인원이 찼고 아직 전원이 들어가지 않았으면 열려 있어야 합니다. 방금
   * 통과한 요청에서만 true 를 주면, 한 명이 들어간 직후의 응답이 false 가 되어
   * 뒤따르는 사람 앞에서 문이 닫힐 수 있습니다. */
  unlock = state !== "blocked" && verified.size >= required && entered.size < required;
  const headcount = { required, tagged: tagged.size, verified: verified.size, entered: entered.size };
  const now = new Date().toISOString();
  await ref.set({
    gateId: body.gate_id, siteId: approval.siteId, workCode: workCodeId,
    approvalRequestId: body.approval_request_id, state, members: [...members],
    /* startedAt 은 관제 화면이 "경과"로 읽는 값이라 **작업이 시작된 때**여야
       합니다. 아직 아무도 안 들어갔으면 검증이 시작된 때를 임시로 씁니다. */
    enteredCount: entered.size, startedAt: workStartedAt ?? old.startedAt ?? now,
    workStartedAt, endedAt: old.endedAt ?? null,
    taggedEmpNos: [...tagged], facePassedEmpNos: [...face], verifiedEmpNos: [...verified], enteredEmpNos: [...entered],
    headcount, unlock, message, lastVerification: lastVerification ?? old.lastVerification ?? null,
    lastExit: lastExit ?? old.lastExit ?? null, simulated: false, updatedAt: now,
    /* 차단이 풀리면(다시 태그해서 진행되면) 사유를 지웁니다. merge 라 그냥 두면
       통과한 뒤에도 옛 사유가 남아 관제에서 막힌 작업처럼 보입니다. */
    blockedReason: state === "blocked" ? message : null,
    /* 차단된 사람. 미등록 카드처럼 사번을 모르는 경우도 있어, 관제가 이름을
       못 찾으면 사유만 보여주도록 빈 값을 그대로 둡니다. */
    blockedEmpNo: state === "blocked" ? (lastVerification?.emp_no || null) : null,
    blockLog,
    lastSignal: signal ? { kind: signal, at: now } : (old.lastSignal ?? null),
    /* 시나리오(시연) 요청에서 생긴 세션은 시나리오 것입니다. 표시를 물려주지
       않으면 시나리오를 다시 깔 때 이 세션만 남아, 그 작업이 "이미 끝난 작업"
       으로 취급돼 키오스크 목록에서 빠집니다. */
    ...(approval.demo === true ? { demo: true } : {}),
  }, { merge: true });
  if (shouldClearContext) {
    const ctx = db.collection("kioskContexts").doc(body.gate_id);
    const ctxSnap = await ctx.get();
    if (ctxSnap.data()?.approvalRequestId === body.approval_request_id) await ctx.delete();
  }
  return { session_id: ref.id, state, headcount, last_verification: lastVerification, last_exit: lastExit, unlock, message };
}
