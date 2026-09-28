import { endWork, fail, sameOrigin } from "@/lib/firebase/kiosk-actions";

/* 키오스크에서 「작업 종료」.
 *
 *   POST /api/kiosk/gate-a1/end   { sessionId }
 *
 * 관제 화면의 「업무 종료」를 여기로 옮겼습니다. 작업을 끝내는 건 현장에서
 * 나오는 사람이 문 앞에서 하는 일입니다. */

export async function POST(
  request: Request,
  { params }: { params: Promise<{ gateId: string }> },
) {
  if (!sameOrigin(request)) return fail(403, "허용되지 않은 요청이에요.");
  const { gateId } = await params;
  const body = (await request.json().catch(() => null)) as { sessionId?: string } | null;
  if (!body?.sessionId) return fail(400, "sessionId 가 필요해요.");
  return endWork(gateId, body.sessionId);
}
