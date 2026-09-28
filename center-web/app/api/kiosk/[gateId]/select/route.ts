import { fail, sameOrigin, selectWork } from "@/lib/firebase/kiosk-actions";

/* 키오스크에서 "이 작업으로 입장 시작"을 누름.
 *
 *   POST /api/kiosk/gate-a1/select   { requestId }
 *
 * 게이트별로 "지금 이 문 앞에서 검증할 작업"을 서버에 적어 둡니다. 젯슨은
 * GET /api/gate/{gateId}/context 로 이걸 읽고, 이벤트를 보낼 때 같은 요청 ID 를
 * approval_request_id 로 돌려줍니다 (상하 님 이벤트 규격). */

export async function POST(
  request: Request,
  { params }: { params: Promise<{ gateId: string }> },
) {
  if (!sameOrigin(request)) return fail(403, "허용되지 않은 요청이에요.");
  const { gateId } = await params;
  const body = (await request.json().catch(() => null)) as { requestId?: string } | null;
  if (!body?.requestId) return fail(400, "requestId 가 필요해요.");
  return selectWork(gateId, body.requestId);
}
