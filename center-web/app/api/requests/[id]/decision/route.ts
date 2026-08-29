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

  let body: { action?: "approve" | "reject"; reason?: string };
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

  // 자기가 올린 요청은 자기가 처리할 수 없습니다.
  if (String(current.requesterId) === caller.empNo) {
    return NextResponse.json(
      { error: "본인이 올린 요청은 승인하거나 반려할 수 없어요." },
      { status: 403 },
    );
  }

  const patch = {
    status: body.action === "approve" ? "approved" : "rejected",
    approverId: caller.empNo,
    decidedAt: new Date().toISOString(),
    rejectReason: body.action === "reject" ? reason : null,
  };
  await ref.update(patch);

  const masters = await loadMasters();
  return NextResponse.json(toRequestView(id, { ...current, ...patch }, masters));
}
