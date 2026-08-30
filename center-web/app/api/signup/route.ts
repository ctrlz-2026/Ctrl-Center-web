import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";

/* 가입 신청.
 *
 * **이 경로만 인증 없이 열려 있습니다.** 아직 계정이 없는 사람이 부르는 곳이라
 * 어쩔 수 없습니다. 대신 여기서 만드는 것은 로그인 계정이 아니라 **신청서**뿐입니다
 * — 실제 계정은 안전관리자가 승인해야 생깁니다(api/admin/signups/[id]).
 * 아무나 가입해서 바로 들어올 수 있으면 출입통제의 의미가 없습니다.
 *
 * 인증이 없으므로 입력을 그대로 믿지 않고 형식을 좁혀서 받습니다. */

/** 사번은 숫자 9자리입니다 (예: 202533690). */
const EMP_NO = /^\d{9}$/;

/** 사람이 적는 값의 길이 상한. 없으면 문서 하나로 저장 용량을 채울 수 있습니다. */
const MAX = { name: 20, team: 30, rank: 20 };

const clean = (v: unknown, max: number) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";

export async function POST(request: Request) {
  let body: { empNo?: unknown; name?: unknown; team?: unknown; rank?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON 형식이 아니에요." }, { status: 400 });
  }

  const empNo = clean(body.empNo, 9);
  const name = clean(body.name, MAX.name);
  const team = clean(body.team, MAX.team);
  const rank = clean(body.rank, MAX.rank);

  if (!EMP_NO.test(empNo)) {
    return NextResponse.json(
      { error: "사번은 숫자 9자리예요." },
      { status: 400 },
    );
  }
  if (!name || !team || !rank) {
    return NextResponse.json(
      { error: "이름·팀·직급을 모두 적어주세요." },
      { status: 400 },
    );
  }

  const db = adminDb();

  /* 이미 직원으로 등록된 사번이면 신청을 받지 않습니다. 받아두면 승인 시점에
   * 기존 직원 문서를 덮어써 팀·역할이 바뀌어 버립니다. */
  const existing = await db.collection("employees").doc(empNo).get();
  if (existing.exists) {
    return NextResponse.json(
      { error: "이미 등록된 사번이에요. 계정 문의는 안전관리팀으로 해주세요." },
      { status: 409 },
    );
  }

  /* 신청서 ID 를 사번으로 고정합니다. 같은 사람이 여러 번 눌러도 신청이 쌓이지
   * 않고 덮어써집니다 — 승인함에 같은 이름이 여러 줄 뜨는 걸 막습니다. */
  const ref = db.collection("signupRequests").doc(empNo);
  const prior = await ref.get();
  if (prior.exists && prior.data()?.status === "pending") {
    return NextResponse.json(
      { error: "이미 신청이 접수돼 있어요. 승인을 기다려주세요." },
      { status: 409 },
    );
  }

  await ref.set({
    empNo,
    name,
    team,
    rank,
    status: "pending",
    requestedAt: new Date().toISOString(),
    rejectReason: null,
  });

  return NextResponse.json({ ok: true, empNo }, { status: 201 });
}
