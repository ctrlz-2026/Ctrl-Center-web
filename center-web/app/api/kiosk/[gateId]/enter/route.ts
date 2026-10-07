import { enterNext, fail, sameOrigin } from "@/lib/firebase/kiosk-actions";

/* 문이 열린 뒤 한 사람이 들어감 (키오스크 화면의 문이 알림).
 *
 *   POST /api/kiosk/gate-a1/enter   { requestId }
 *
 * 실물 문도, 사람이 지났는지 볼 센서도 없어서 화면의 3D 문이 대신 알립니다.
 * 서버가 "문을 열어도 된다"고 판정한 작업에서, 검증을 통과하고 아직 안 들어간
 * 사람을 한 명 들여보냅니다. 전원이 들어가면 작업 중이 됩니다. */

export async function POST(
  request: Request,
  { params }: { params: Promise<{ gateId: string }> },
) {
  if (!sameOrigin(request)) return fail(403, "허용되지 않은 요청이에요.");
  const { gateId } = await params;
  const body = (await request.json().catch(() => null)) as { requestId?: string } | null;
  if (!body?.requestId) return fail(400, "requestId 가 필요해요.");
  return enterNext(gateId, body.requestId);
}
