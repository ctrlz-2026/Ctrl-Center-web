import { NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase/admin";
import { isResponse, requireCaller } from "@/lib/firebase/auth-guard";
import { invalidateMasters } from "@/lib/firebase/queries";
import { emailOf, initialPassword } from "@/lib/firebase/user";
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
  const [signupSnap, empSnap, cardSnap, authUsers] = await Promise.all([
    db.collection("signupRequests").get(),
    db.collection("employees").get(),
    db.collection("employeeCards").get(),
    // 로그인 계정이 실제로 있는지는 Auth 가 압니다. employees 에만 있고 계정이
    // 없는 가상 인물과 구분하기 위해 같이 읽습니다.
    adminAuth().listUsers(1000),
  ]);

  const emailSet = new Set(authUsers.users.map((u) => u.email ?? ""));

  /* 사람별 현재 사원증. 폐기된 카드는 빼고, 실물이 하나라도 있으면 "발급됨"으로
     봅니다. 게이트를 지날 수 있는 사람인지 목록에서 바로 보이게 하려는 것입니다. */
  const cardOf = new Map<string, "issued" | "temp">();
  for (const c of cardSnap.docs) {
    const d = c.data();
    if (d.revokedAt) continue;
    const empNo = String(d.empNo);
    if (d.pending === true) {
      if (!cardOf.has(empNo)) cardOf.set(empNo, "temp");
    } else {
      cardOf.set(empNo, "issued");
    }
  }

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
    .map((d): ManagedAccount => {
      const e = d.data();
      return {
        empNo: d.id,
        name: String(e.name),
        team: String(e.team),
        rank: String(e.rank),
        role: e.role as Role,
        active: e.active !== false,
        hasLogin: emailSet.has(emailOf(d.id)),
        card: cardOf.get(d.id) ?? ("none" as const),
        faceEnrolled: e.faceEnrolled === true,
      };
    })
    // 로그인 계정이 있는 사람부터 — 관리 대상이 그쪽입니다.
    .sort((a, b) => {
      if (a.hasLogin !== b.hasLogin) return a.hasLogin ? -1 : 1;
      return a.name.localeCompare(b.name, "ko");
    });

  return NextResponse.json({ signups, accounts, viewerEmpNo: caller.empNo });
}

/* ── 작업자 직접 등록 ───────────────────────────────────────────────────────
 * 가입 신청을 기다리지 않고 안전관리자가 바로 사람을 넣습니다. 현장에서는
 * 본인이 신청하는 것보다 **관리자가 명단을 들고 한꺼번에 등록**하는 일이 더
 * 많습니다 — 신규 입사자나 협력업체 인원이 그렇습니다.
 *
 * 가입 승인과 **같은 결과**를 만듭니다: 직원 문서 + 로그인 계정(첫 비밀번호는
 * 사번 뒤에 1234) + 역할 클레임. 두 경로가 다른 모양의 계정을 만들면 나중에
 * 어느 쪽으로 들어온 사람인지에 따라 동작이 달라집니다.
 *
 * 역할은 여기서도 작업자로 시작합니다. 승급은 계정 목록에서 따로 합니다 —
 * 등록과 권한 부여를 한 번에 하면 실수로 높은 권한을 주기 쉽습니다.
 *
 * 사원증 UID 를 같이 받습니다(선택). 실물 카드를 나눠주면서 등록하는 경우가
 * 보통이라, 등록 → 정보 관리 → 카드 입력 세 단계를 한 번으로 줄였습니다. */

const EMP_NO = /^\d{9}$/;
const MAX = { name: 20, team: 30, rank: 20, card: 40 };
const clean = (v: unknown, max: number) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

export async function POST(request: Request) {
  const caller = await requireCaller(request);
  if (isResponse(caller)) return caller;

  if (!canManageAccounts(caller.role)) {
    return NextResponse.json(
      { error: "계정 관리 권한이 없어요." },
      { status: 403 },
    );
  }

  let body: {
    empNo?: unknown;
    name?: unknown;
    team?: unknown;
    rank?: unknown;
    cardUid?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON 형식이 아니에요." }, { status: 400 });
  }

  const empNo = clean(body.empNo, 9);
  const name = clean(body.name, MAX.name);
  const team = clean(body.team, MAX.team);
  const rank = clean(body.rank, MAX.rank);
  const cardUid = clean(body.cardUid, MAX.card);

  if (!EMP_NO.test(empNo)) {
    return NextResponse.json({ error: "사번은 숫자 9자리예요." }, { status: 400 });
  }
  if (!name || !team || !rank) {
    return NextResponse.json(
      { error: "이름·팀·직급을 모두 적어주세요." },
      { status: 400 },
    );
  }

  const db = adminDb();
  const empRef = db.collection("employees").doc(empNo);
  if ((await empRef.get()).exists) {
    return NextResponse.json({ error: "이미 등록된 사번이에요." }, { status: 409 });
  }

  // 남의 카드를 새 사람에게 붙이면 게이트가 엉뚱한 사람으로 읽습니다.
  if (cardUid) {
    const taken = await db.collection("employeeCards").doc(cardUid).get();
    if (taken.exists && !taken.data()?.revokedAt) {
      return NextResponse.json(
        { error: "다른 직원에게 등록된 사원증이에요." },
        { status: 409 },
      );
    }
  }

  const now = new Date().toISOString();
  await empRef.set({
    empNo,
    name,
    team,
    rank,
    role: "worker",
    hiredOn: now.slice(0, 10),
    completedCount: 0,
    active: true,
    qualifications: [],
    // 얼굴은 젯슨 앞에서 따로 등록합니다. 여기서는 "아직"으로 시작합니다.
    faceEnrolled: false,
    registeredBy: caller.empNo,
    registeredAt: now,
  });

  if (cardUid) {
    await db.collection("employeeCards").doc(cardUid).set({
      cardUid,
      empNo,
      issuedAt: now.slice(0, 10),
      revokedAt: null,
      pending: false,
    });
  }

  const email = emailOf(empNo);
  const password = initialPassword(empNo);
  let user;
  try {
    user = await adminAuth().getUserByEmail(email);
    await adminAuth().updateUser(user.uid, { password, displayName: name, disabled: false });
  } catch {
    user = await adminAuth().createUser({ email, password, displayName: name });
  }
  // 역할은 토큰 클레임에 박습니다. 서버가 이 값으로 권한을 판정합니다.
  await adminAuth().setCustomUserClaims(user.uid, { role: "worker", empNo });

  /* 같은 사번으로 대기 중인 가입 신청이 있었다면 같이 닫습니다. 남겨두면
     나중에 승인을 눌렀을 때 "이미 등록된 사번"으로 막힙니다. */
  const signup = db.collection("signupRequests").doc(empNo);
  const prior = await signup.get();
  if (prior.exists && prior.data()?.status === "pending") {
    await signup.update({
      status: "approved",
      decidedBy: caller.empNo,
      decidedAt: now,
      rejectReason: null,
    });
  }

  invalidateMasters();
  return NextResponse.json({ ok: true, empNo }, { status: 201 });
}
