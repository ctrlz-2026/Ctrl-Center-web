import { fail, sameOrigin, tagCard } from "@/lib/firebase/kiosk-actions";

/* 키오스크 화면이 사원증을 읽음.
 *
 *   POST /api/kiosk/gate-a1/tag   { requestId, cardUid }
 *
 * 현장의 USB 리더는 키보드처럼 동작해서, 카드 번호가 젯슨 프로그램이 아니라
 * 화면에 떠 있는 브라우저로 들어옵니다. 화면이 그 번호를 여기로 보냅니다.
 * 판정은 젯슨 이벤트(POST /api/gate/events 의 card_tag)와 같은 함수가 합니다. */

export async function POST(
  request: Request,
  { params }: { params: Promise<{ gateId: string }> },
) {
  if (!sameOrigin(request)) return fail(403, "허용되지 않은 요청이에요.");
  const { gateId } = await params;
  const body = (await request.json().catch(() => null)) as {
    requestId?: string;
    cardUid?: string;
  } | null;
  if (!body?.requestId || typeof body.cardUid !== "string") {
    return fail(400, "requestId 와 cardUid 가 필요해요.");
  }
  return tagCard(gateId, body.requestId, body.cardUid);
}
