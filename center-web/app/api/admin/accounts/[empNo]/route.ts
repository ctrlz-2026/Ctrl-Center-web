import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { isResponse, requireCaller } from "@/lib/firebase/auth-guard";
import { emailOf, initialPassword } from "@/lib/firebase/user";
import { canManageAccounts } from "@/lib/types";
import type { Role } from "@/lib/types";

/* 계정 관리 — 비밀번호 초기화 · 역할 변경 · 활성/비활성.
 *
 * 비밀번호는 Firestore 에 저장하지 않습니다. Firebase Auth 가 갖고 있고
 * 여기서는 Admin SDK 로 덮어쓰기만 합니다.
 *
 * 계정을 **지우는 경로는 없습니다.** 지우면 그 사람이 참여한 과거 작업 이력의
 * 이름이 빈칸이 됩니다. 퇴사자는 active: false 로 내립니다. */

const ROLES: Role[] = ["worker", "leader", "safety_admin"];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ empNo: string }> },
) {
  const caller = await requireCaller(request);
  if (isResponse(caller)) return caller;

  if (!canManageAccounts(caller.role)) {
    return NextResponse.json(
      { error: "계정 관리 권한이 없어요." },
      { status: 403 },
    );
  }

  let body: { action?: string; role?: string; active?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON 형식이 아니에요." }, { status: 400 });
  }

  const { empNo } = await params;
  const db = adminDb();
  const ref = db.collection("employees").doc(empNo);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ error: "없는 계정이에요." }, { status: 404 });
  }

  /* 자기 자신의 역할·활성 상태는 못 바꿉니다.
   * 안전관리자가 실수로 자기 권한을 내리면 아무도 계정 관리를 못 하게 됩니다.
   * (비밀번호 초기화는 자기 것이어도 괜찮습니다 — 잠기지 않습니다.) */
  const isSelf = empNo === caller.empNo;

  // ── 비밀번호 초기화 ──────────────────────────────────────────────────
  if (body.action === "resetPassword") {
    const email = emailOf(empNo);
    const password = initialPassword(empNo);
    try {
      const user = await adminAuth().getUserByEmail(email);
      await adminAuth().updateUser(user.uid, { password });
    } catch {
      return NextResponse.json(
        { error: "로그인 계정이 없는 사람이에요." },
        { status: 404 },
      );
    }
    // 초기화했다는 사실만 남깁니다. 비밀번호 자체는 저장하지 않습니다.
    await ref.update({
      passwordResetAt: new Date().toISOString(),
      passwordResetBy: caller.empNo,
    });
    return NextResponse.json({ ok: true, password });
  }

  // ── 역할 변경 ────────────────────────────────────────────────────────
  if (body.action === "setRole") {
    if (isSelf) {
      return NextResponse.json(
        { error: "본인 역할은 바꿀 수 없어요." },
        { status: 403 },
      );
    }
    const role = body.role as Role;
    if (!ROLES.includes(role)) {
      return NextResponse.json({ error: "없는 역할이에요." }, { status: 400 });
    }

    await ref.update({ role });

    /* Firestore 의 role 만 고치면 **토큰에는 옛 역할이 남습니다.**
     * 서버는 토큰 클레임으로 권한을 판정하므로 클레임을 같이 갱신해야 하고,
     * 당사자는 토큰을 새로 받아야(재로그인) 반영됩니다. */
    try {
      const user = await adminAuth().getUserByEmail(emailOf(empNo));
      await adminAuth().setCustomUserClaims(user.uid, { role, empNo });
      await adminAuth().revokeRefreshTokens(user.uid);
    } catch {
      // 로그인 계정이 없는 가상 인물이면 Firestore 만 바뀝니다.
    }
    return NextResponse.json({ ok: true, role });
  }

  // ── 활성 / 비활성 ────────────────────────────────────────────────────
  if (body.action === "setActive") {
    if (isSelf) {
      return NextResponse.json(
        { error: "본인 계정은 비활성화할 수 없어요." },
        { status: 403 },
      );
    }
    const active = body.active === true;
    await ref.update({ active });

    /* 비활성은 로그인 자체를 막습니다. Firestore 플래그만 내리면 이미 로그인한
     * 사람은 토큰이 살아 있는 동안 계속 들어옵니다. */
    try {
      const user = await adminAuth().getUserByEmail(emailOf(empNo));
      await adminAuth().updateUser(user.uid, { disabled: !active });
      if (!active) await adminAuth().revokeRefreshTokens(user.uid);
    } catch {
      // 로그인 계정이 없는 가상 인물이면 Firestore 만 바뀝니다.
    }
    return NextResponse.json({ ok: true, active });
  }

  return NextResponse.json(
    { error: "action 은 resetPassword · setRole · setActive 중 하나여야 해요." },
    { status: 400 },
  );
}
