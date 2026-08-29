import { NextResponse } from "next/server";
import { adminAuth, adminDb, isAdminReady } from "@/lib/firebase/admin";
import { toUser } from "@/lib/firebase/user";

/* 로그인한 본인의 프로필.
 *
 * 브라우저가 Firestore 를 직접 읽지 않고 이 경로를 거칩니다.
 * Firestore 보안 규칙은 전부 잠근 채로 두고(프로덕션 모드), 서버만 Admin SDK 로
 * 접근합니다. 클라이언트에 DB 를 열어주지 않는 편이 안전하고,
 * "규칙은 Route Handler 에 둔다"는 설계와도 일치합니다.
 *
 * 신원은 Authorization 헤더의 Firebase ID 토큰으로 확인합니다.
 * 역할(role)은 요청 본문이 아니라 **토큰의 커스텀 클레임**에서 읽습니다 —
 * 클라이언트가 보내는 값을 믿으면 누구나 관리자가 될 수 있습니다. */
export async function GET(request: Request) {
  if (!isAdminReady) {
    return NextResponse.json(
      { error: "서버에 Firebase 설정이 없어요." },
      { status: 503 },
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return NextResponse.json({ error: "인증이 필요해요." }, { status: 401 });
  }

  let empNo: string;
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    empNo = String(decoded.empNo ?? "");
  } catch {
    return NextResponse.json({ error: "인증이 필요해요." }, { status: 401 });
  }

  if (!empNo) {
    return NextResponse.json(
      { error: "계정에 사번이 연결돼 있지 않아요. 관리자에게 문의하세요." },
      { status: 403 },
    );
  }

  const db = adminDb();
  const [snap, quals] = await Promise.all([
    db.collection("employees").doc(empNo).get(),
    db.collection("qualifications").get(),
  ]);

  if (!snap.exists) {
    return NextResponse.json(
      { error: "직원 정보를 찾을 수 없어요." },
      { status: 404 },
    );
  }

  const names: Record<string, string> = {};
  quals.forEach((q) => {
    names[q.id] = (q.data() as { name: string }).name;
  });

  return NextResponse.json(toUser(snap.data() as never, names));
}
