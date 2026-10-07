import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { isResponse, requireGate } from "@/lib/firebase/gate-auth";
import { loadMasters } from "@/lib/firebase/queries";
import type { GateContext } from "@/lib/gate-contract";

/* 젯슨이 "지금 이 문 앞에서 어느 작업을 검증하나"를 묻는 곳.
 *
 *   GET /api/gate/gate-a1/context
 *   헤더: X-Gate-Key: <그 게이트의 기기 키>
 *
 * 키오스크에서 작업을 고르면 서버가 게이트별로 적어 둡니다
 * (POST /api/kiosk/{gateId}/select). 젯슨은 이걸 읽어 검증을 시작하고,
 * 이벤트를 보낼 때 approval_request_id 로 그대로 돌려줍니다.
 *
 * 아무 작업도 안 골랐으면 approval_request_id 가 null 입니다 — 오류가 아니라
 * "대기 화면"이라는 뜻입니다.
 *
 * 상하 님 로컬에 같은 역할의 경로가 있다고 들었습니다(2026-09-27 기준 미반영).
 * 합칠 때는 응답 모양(GateContext)만 맞추면 어느 쪽 구현을 남겨도 됩니다. */

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ gateId: string }> },
) {
  const { gateId } = await params;
  const gate = await requireGate(request, gateId);
  if (isResponse(gate)) return gate;

  const doc = await adminDb().collection("kioskContexts").doc(gateId).get();
  const empty: GateContext = {
    gate_id: gateId,
    approval_request_id: null,
    work_code: null,
    required_headcount: 0,
    required_ppe: [],
    selected_at: null,
  };
  if (!doc.exists) return NextResponse.json(empty, { headers: { "Cache-Control": "no-store" } });

  const c = doc.data()!;
  const [masters, sessionSnap] = await Promise.all([
    loadMasters(),
    adminDb().collection("gateSessions").doc(`${gateId}__${String(c.approvalRequestId)}`).get(),
  ]);
  // 검증이 어디까지 왔는지. 젯슨이 다시 켜졌을 때 여기서 차례를 다시 압니다.
  const s = sessionSnap.data();
  const verified = new Set<string>((s?.verifiedEmpNos ?? []).map(String));
  const facePassed = new Set<string>((s?.facePassedEmpNos ?? []).map(String));
  const session: GateContext["session"] = s
    ? {
        state: s.state,
        headcount: s.headcount ?? { required: 0, tagged: 0, verified: 0, entered: 0 },
        pending: ((s.taggedEmpNos ?? []) as unknown[])
          .map(String)
          .filter((e) => !verified.has(e))
          .map((e) => ({ emp_no: e, stage: facePassed.has(e) ? ("ppe" as const) : ("face" as const) })),
      }
    : null;
  const wc = masters.workCodes.get(String(c.workCode));
  const body: GateContext = {
    gate_id: gateId,
    approval_request_id: String(c.approvalRequestId),
    work_code: String(c.workCode),
    required_headcount: Number(wc?.requiredHeadcount ?? 0),
    required_ppe: (wc?.requiredPpe ?? []).map((p: string) => ({
      code: p,
      name: masters.ppeNames.get(p) ?? p,
      yolo_class: masters.ppeYolo.get(p) ?? null,
    })),
    selected_at: String(c.selectedAt),
    session,
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
