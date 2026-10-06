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
 * **이 경로로는 얼굴 데이터를 받지 않습니다.** 젯슨 앞에서 직접 등록했을 때
 * "등록했다"는 사실 한 줄만 알리는 곳입니다.
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
    face_enrolled: body.enrolled,
    enrolled_at: body.enrolled ? now : null,
  });
}
