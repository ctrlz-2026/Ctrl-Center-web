import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { isResponse, requireGate } from "@/lib/firebase/gate-auth";
import { invalidateMasters } from "@/lib/firebase/queries";
import type { FaceEnrollmentRequest } from "@/lib/gate-contract";

/* 젯슨이 "이 사람 얼굴 등록을 마쳤다"고 알리는 곳.
 *
 *   POST /api/gate/gate-a1/face-enrollment
 *   헤더: X-Gate-Key
 *   본문: { "emp_no": "202533872", "enrolled": true }
 *
 * **얼굴 데이터는 받지 않습니다.** 사진도, 특징 벡터도 서버로 오지 않습니다.
 * 얼굴은 젯슨 안에서 숫자 벡터로 바뀌어 젯슨에만 남고, 서버는 "등록했는가"
 * 라는 사실 한 줄만 압니다 (팀 결정 2026-08-30, 재확인 2026-10-06).
 *
 * 이유는 책임의 크기입니다. 얼굴 특징값은 바꿀 수 없는 생체정보라, 서버 DB 에
 * 두는 순간 암호화·접근 기록·파기까지 전부 우리 몫이 됩니다. 비밀번호는 새면
 * 바꾸면 되지만 얼굴은 못 바꿉니다. 판정은 어차피 젯슨이 하므로 서버가
 * 벡터를 가질 이유가 없습니다.
 *
 * 그래서 본문에 얼굴 데이터로 보이는 값이 섞여 오면 **조용히 버리지 않고
 * 거절합니다.** 조용히 버리면 보내는 쪽은 저장된 줄 알고 계속 보냅니다.
 *
 * 전에는 관리자가 화면에서 "등록 완료"를 손으로 눌렀습니다. 사람이 누르면
 * 실제로 등록했는지와 어긋날 수 있어, 등록한 기기가 직접 알리게 했습니다. */

/** 얼굴 데이터로 보이는 필드 이름. 하나라도 있으면 받지 않습니다. */
const FORBIDDEN = ["embedding", "embeddings", "vector", "feature", "features", "image", "photo", "face", "template"];

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
        error: `얼굴 데이터는 서버로 보내지 않아요 (${leaked.join(", ")}). 사번과 등록 여부만 보내주세요.`,
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
    face_enrolled: body.enrolled,
    enrolled_at: body.enrolled ? now : null,
  });
}
