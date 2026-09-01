import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { isResponse, requireCaller } from "@/lib/firebase/auth-guard";
import { loadMasters, toRequestView } from "@/lib/firebase/queries";
import { canApprove } from "@/lib/types";

/** 승인 · 반려.
 *
 *  화면에서도 막지만 여기서 다시 막습니다. 클라이언트 검사는 UX 용이고,
 *  실제 차단은 서버가 합니다 — 화면을 거치지 않고 이 경로를 직접 부를 수 있으니까요. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const caller = await requireCaller(request);
  if (isResponse(caller)) return caller;

  if (!canApprove(caller.role)) {
    return NextResponse.json(
      { error: "승인 권한이 없어요." },
      { status: 403 },
    );
  }

  let body: { action?: "approve" | "reject"; reason?: string; note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON 형식이 아니에요." }, { status: 400 });
  }

  if (body.action !== "approve" && body.action !== "reject") {
    return NextResponse.json(
      { error: "action 은 approve 또는 reject 여야 해요." },
      { status: 400 },
    );
  }

  // 스펙 권장: 반려는 사유 없이 불가.
  const reason = body.reason?.trim() ?? "";
  if (body.action === "reject" && !reason) {
    return NextResponse.json(
      { error: "반려하려면 사유를 적어야 해요." },
      { status: 400 },
    );
  }

  const { id } = await params;
  const db = adminDb();
  const ref = db.collection("approvalRequests").doc(id);
  const snap = await ref.get();

  if (!snap.exists) {
    return NextResponse.json({ error: "없는 요청이에요." }, { status: 404 });
  }
  const current = snap.data()!;

  if (current.status !== "pending") {
    return NextResponse.json(
      { error: "이미 처리된 요청이에요." },
      { status: 409 },
    );
  }

  /* 본인 요청 셀프 승인은 **허용**합니다 (2026-08-30 결정).
   *
   * 원래는 막았는데, 팀장도 현장 작업에 직접 들어갑니다. 막아두면 팀장이 올린
   * 요청은 승인자가 한 명뿐인 팀에서 영원히 대기로 남고, 그러면 팀장은
   * 키오스크를 통과하지 못해 자기 작업장에 못 들어갑니다.
   *
   * 대신 **누가 승인했는지는 그대로 남깁니다** — approverId 가 요청자와 같으면
   * 셀프 승인이었다는 뜻이고, 사후에 추적할 수 있어야 합니다.
   * 승인자가 여러 명인 조직으로 바뀌면 이 허용을 되돌릴 수 있습니다. */

  /* 승인하면서 남기는 한마디는 **선택**입니다. 반려 사유처럼 강제하면
     대충 채운 글자가 쌓여서 정작 중요한 당부가 묻힙니다. */
  const note = body.note?.trim() ?? "";

  const patch = {
    status: body.action === "approve" ? "approved" : "rejected",
    approverId: caller.empNo,
    selfApproved: String(current.requesterId) === caller.empNo,
    decidedAt: new Date().toISOString(),
    rejectReason: body.action === "reject" ? reason : null,
    approveNote: body.action === "approve" && note ? note : null,
  };
  await ref.update(patch);

  const masters = await loadMasters();
  return NextResponse.json(toRequestView(id, { ...current, ...patch }, masters));
}
