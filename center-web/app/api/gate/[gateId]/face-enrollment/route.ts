import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { isResponse, requireGate } from "@/lib/firebase/gate-auth";
import { invalidateMasters } from "@/lib/firebase/queries";
import type { FaceEnrollmentRequest } from "@/lib/gate-contract";

/* 젯슨의 얼굴 등록 프로그램이 쓰는 곳.
 *
 *   GET  /api/gate/gate-a1/face-enrollment?emp_no=202612345   ← 등록 전에 누구인지 확인
 *   POST /api/gate/gate-a1/face-enrollment                    ← 등록을 마쳤다고 알림
 *   헤더: X-Gate-Key
 *   본문: { "emp_no": "202612345", "enrolled": true }
 *
 * 흐름 (2026-10-07 확정) — 안전관리자가 웹에서 사람을 등록해 사번을 만들고,
 * 그 사람이 젯슨의 얼굴 등록 프로그램에서 사번을 넣고 얼굴을 찍습니다. 등록이
 * 끝나면 프로그램이 POST 로 알리고, 웹의 계정 관리 화면은 그 사람을 **자동으로**
 * "얼굴 등록됨"으로 바꿉니다. 관리자가 따로 누르지 않습니다.
 *
 * GET 을 둔 이유 — 사번을 잘못 넣으면 **남의 이름으로 얼굴이 등록됩니다.**
 * 찍기 전에 "○○○ 님 맞나요?"를 물을 수 있게 이름과 소속만 돌려줍니다.
 *
 * **이 경로로는 얼굴 데이터를 받지 않습니다.** "등록했다"는 사실 한 줄만 받습니다.
 *
 * 2026-10-06 부터 서버가 얼굴 특징 벡터를 보관하지만, 들어오는 길은 **하나**로
 * 둡니다 — 안전관리자가 로그인해서 파일로 올리는 경로
 * (/api/admin/accounts/{사번}/face-template). 기기 키만으로 누군가의 얼굴을
 * 바꿔 넣을 수 있으면, 게이트 한 대가 털렸을 때 그 사람 행세를 할 수 있게 됩니다.
 *
 * 그래서 본문에 얼굴 데이터로 보이는 값이 섞여 오면 **조용히 버리지 않고
 * 거절합니다.** 조용히 버리면 보내는 쪽은 저장된 줄 알고 계속 보냅니다.
 *
 * 전에는 관리자가 화면에서 "등록 완료"를 손으로 눌렀습니다. 사람이 누르면
 * 실제로 등록했는지와 어긋날 수 있어, 등록한 기기가 직접 알리게 했습니다. */

/** 얼굴 데이터로 보이는 필드 이름. 하나라도 있으면 받지 않습니다. */
const FORBIDDEN = ["embedding", "embeddings", "vector", "feature", "features", "image", "photo", "face", "template"];

export async function GET(
  request: Request,
  { params }: { params: Promise<{ gateId: string }> },
) {
  const { gateId } = await params;
  const gate = await requireGate(request, gateId);
  if (isResponse(gate)) return gate;

  const empNo = (new URL(request.url).searchParams.get("emp_no") ?? "").trim();
  if (!empNo) {
    return NextResponse.json({ error: "emp_no 가 필요해요." }, { status: 400 });
  }
  const snap = await adminDb().collection("employees").doc(empNo).get();
  if (!snap.exists) {
    return NextResponse.json({ error: "없는 직원이에요." }, { status: 404 });
  }
  const e = snap.data()!;
  // 확인에 필요한 것만. 자격 · 사원증 · 역할은 등록 프로그램이 알 필요가 없습니다.
  return NextResponse.json({
    emp_no: empNo,
    name: String(e.name ?? ""),
    team: String(e.team ?? ""),
    active: e.active !== false,
    face_enrolled: e.faceEnrolled === true,
    enrolled_at: e.faceEnrolledAt ?? null,
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ gateId: string }> },
) {
  const { gateId } = await params;
  const gate = await requireGate(request, gateId);
  if (isResponse(gate)) return gate;

  let body: FaceEnrollmentRequest & Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON 형식이 아니에요." }, { status: 400 });
  }

  const leaked = Object.keys(body ?? {}).filter((k) => FORBIDDEN.includes(k.toLowerCase()));
  if (leaked.length > 0) {
    return NextResponse.json(
      {
        error: `이 경로로는 얼굴 데이터를 받지 않아요 (${leaked.join(", ")}). 사번과 등록 여부만 보내주세요. 벡터는 안전관리자가 계정 관리 화면에서 파일로 올려요.`,
      },
      { status: 400 },
    );
  }

  const empNo = typeof body?.emp_no === "string" ? body.emp_no.trim() : "";
  if (!empNo || typeof body?.enrolled !== "boolean") {
    return NextResponse.json(
      { error: "emp_no(문자열)와 enrolled(true/false)가 필요해요." },
      { status: 400 },
    );
  }

  const ref = adminDb().collection("employees").doc(empNo);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ error: "없는 직원이에요." }, { status: 404 });
  }
  if (snap.data()?.active === false) {
    return NextResponse.json(
      { error: "비활성화된 직원은 등록할 수 없어요." },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  await ref.update({
    faceEnrolled: body.enrolled,
    faceEnrolledAt: body.enrolled ? now : null,
    // 누가 등록했는지. 사람이 누른 것과 기기가 알린 것을 구분합니다.
    faceEnrolledBy: body.enrolled ? `gate:${gateId}` : null,
  });
  invalidateMasters();

  return NextResponse.json({
    ok: true,
    emp_no: empNo,
    // 프로그램이 "○○○ 님 등록 완료"를 띄울 수 있게 같이 돌려줍니다.
    name: String(snap.data()?.name ?? ""),
    face_enrolled: body.enrolled,
    enrolled_at: body.enrolled ? now : null,
  });
}
