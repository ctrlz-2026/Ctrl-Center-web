import { NextResponse } from "next/server";
import { loadKioskGate, loadKioskStatus } from "@/lib/firebase/kiosk";

/* 키오스크 진행 화면이 몇 초마다 묻는 "이 작업 지금 어떻게 됐나".
 *
 *   GET /api/kiosk/gate-a1/status?request=<요청 ID>
 *
 * 현장 화면에 뜨는 정도의 정보(단계·인원·참여자 이름·경과)만 돌려줍니다.
 * 사번이나 사원증 UID 는 내보내지 않습니다. */

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ gateId: string }> },
) {
  const { gateId } = await params;
  const requestId = new URL(request.url).searchParams.get("request");
  if (!requestId) {
    return NextResponse.json({ error: "request 가 필요해요." }, { status: 400 });
  }
  const gate = await loadKioskGate(gateId);
  if (!gate) return NextResponse.json({ error: "없는 게이트예요." }, { status: 404 });

  const status = await loadKioskStatus(gateId, gate.siteId, requestId);
  return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
}
