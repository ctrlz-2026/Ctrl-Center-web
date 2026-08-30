import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { isResponse, requireCaller } from "@/lib/firebase/auth-guard";
import { emailOf } from "@/lib/firebase/user";
import { canManageAccounts } from "@/lib/types";
import type { ManagedAccount, Role, SignupRequest } from "@/lib/types";

/* 관리자 콘솔이 읽는 목록 — 가입 신청 + 계정.
 *
 * 안전관리자 전용입니다. 화면에서도 막지만 여기서 다시 막습니다. */

export async function GET(request: Request) {
  const caller = await requireCaller(request);
  if (isResponse(caller)) return caller;

  if (!canManageAccounts(caller.role)) {
    return NextResponse.json(
      { error: "계정 관리 권한이 없어요." },
      { status: 403 },
    );
  }

  const db = adminDb();
  const [signupSnap, empSnap, authUsers] = await Promise.all([
    db.collection("signupRequests").get(),
    db.collection("employees").get(),
    // 로그인 계정이 실제로 있는지는 Auth 가 압니다. employees 에만 있고 계정이
    // 없는 가상 인물과 구분하기 위해 같이 읽습니다.
    adminAuth().listUsers(1000),
  ]);

  const emailSet = new Set(authUsers.users.map((u) => u.email ?? ""));

  const signups: SignupRequest[] = signupSnap.docs
    .map((d) => {
      const s = d.data();
      return {
        id: d.id,
        empNo: String(s.empNo),
        name: String(s.name),
        team: String(s.team),
        rank: String(s.rank),
        status: s.status as SignupRequest["status"],
        requestedAt: String(s.requestedAt),
        rejectReason: s.rejectReason ?? undefined,
      };
    })
    // 대기 중인 것부터, 그 안에서는 오래 기다린 것부터.
    .sort((a, b) => {
      if ((a.status === "pending") !== (b.status === "pending")) {
        return a.status === "pending" ? -1 : 1;
      }
      return a.requestedAt.localeCompare(b.requestedAt);
    });

  const accounts: ManagedAccount[] = empSnap.docs
    .map((d) => {
      const e = d.data();
      return {
        empNo: d.id,
        name: String(e.name),
        team: String(e.team),
        rank: String(e.rank),
        role: e.role as Role,
        active: e.active !== false,
        hasLogin: emailSet.has(emailOf(d.id)),
      };
    })
    // 로그인 계정이 있는 사람부터 — 관리 대상이 그쪽입니다.
    .sort((a, b) => {
      if (a.hasLogin !== b.hasLogin) return a.hasLogin ? -1 : 1;
      return a.name.localeCompare(b.name, "ko");
    });

  return NextResponse.json({ signups, accounts, viewerEmpNo: caller.empNo });
}
