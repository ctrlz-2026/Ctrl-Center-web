import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { isResponse, requireCaller } from "@/lib/firebase/auth-guard";
import { emailOf, initialPassword } from "@/lib/firebase/user";
import { canManageAccounts } from "@/lib/types";

/* 가입 신청 승인 · 거절.
 *
 * **승인이 곧 계정 생성입니다.** 신청서만 있고 계정이 없는 상태가 기본값이고,
 * 안전관리자가 승인해야 로그인할 수 있게 됩니다. */

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const caller = await requireCaller(request);
  if (isResponse(caller)) return caller;

  if (!canManageAccounts(caller.role)) {
    return NextResponse.json(
      { error: "계정 관리 권한이 없어요." },
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

  // 승인 요청 반려와 같은 규칙 — 사유 없이 거절할 수 없습니다.
  const reason = body.reason?.trim() ?? "";
  if (body.action === "reject" && !reason) {
    return NextResponse.json(
      { error: "거절하려면 사유를 적어야 해요." },
      { status: 400 },
    );
  }

  const { id } = await params;
  const db = adminDb();
  const ref = db.collection("signupRequests").doc(id);
  const snap = await ref.get();

  if (!snap.exists) {
    return NextResponse.json({ error: "없는 신청이에요." }, { status: 404 });
  }
  const s = snap.data()!;
  if (s.status !== "pending") {
    return NextResponse.json(
      { error: "이미 처리된 신청이에요." },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();

  if (body.action === "reject") {
    await ref.update({
      status: "rejected",
      rejectReason: reason,
      decidedBy: caller.empNo,
      decidedAt: now,
    });
    return NextResponse.json({ ok: true, status: "rejected" });
  }

  // ── 승인: 직원 문서 + 로그인 계정을 만듭니다 ──────────────────────────
  const empNo = String(s.empNo);

  /* 신청 접수와 승인 사이에 같은 사번이 직원으로 등록됐을 수 있습니다.
   * 덮어쓰면 기존 사람의 팀·역할이 날아가므로 여기서 한 번 더 봅니다. */
  const already = await db.collection("employees").doc(empNo).get();
  if (already.exists) {
    return NextResponse.json(
      { error: "이미 등록된 사번이에요. 신청을 거절하고 확인해주세요." },
      { status: 409 },
    );
  }

  await db.collection("employees").doc(empNo).set({
    empNo,
    name: String(s.name),
    team: String(s.team),
    rank: String(s.rank),
    // 가입은 항상 작업자로 시작합니다. 승급은 계정 관리에서 따로 합니다 —
    // 신청서에 역할을 적게 하면 본인이 자기 권한을 고르게 됩니다.
    role: "worker",
    hiredOn: now.slice(0, 10),
    completedCount: 0,
    active: true,
    qualifications: [],
  });

  const email = emailOf(empNo);
  const password = initialPassword(empNo);
  let user;
  try {
    user = await adminAuth().getUserByEmail(email);
    await adminAuth().updateUser(user.uid, { password, displayName: String(s.name) });
  } catch {
    user = await adminAuth().createUser({
      email,
      password,
      displayName: String(s.name),
    });
  }
  // 역할은 토큰 클레임에 박습니다. 서버가 이 값으로 권한을 판정합니다.
  await adminAuth().setCustomUserClaims(user.uid, { role: "worker", empNo });

  await ref.update({
    status: "approved",
    decidedBy: caller.empNo,
    decidedAt: now,
    rejectReason: null,
  });

  return NextResponse.json({ ok: true, status: "approved", empNo });
}
