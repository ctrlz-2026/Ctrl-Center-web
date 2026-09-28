import { simulationEnabled } from "@/lib/firebase/kiosk";
import {
  fail,
  sameOrigin,
  simulateBlock,
  simulatePass,
} from "@/lib/firebase/kiosk-actions";

/* 젯슨 대역 — 기기가 붙기 전 시연용.
 *
 *   POST /api/kiosk/gate-a1/simulate   { requestId, outcome: "pass" | "block" }
 *
 * KIOSK_SIMULATION=on 일 때만 열립니다. 꺼져 있으면 **없는 경로처럼 404** 로
 * 답합니다 — 운영에서 누가 이 주소를 알아도 문을 열 수 없어야 합니다.
 *
 * 젯슨이 붙으면 이 파일은 지웁니다. 그때는 문이 열리는 근거가
 * /api/gate/events 로 들어오는 실제 검증 결과입니다. */

export async function POST(
  request: Request,
  { params }: { params: Promise<{ gateId: string }> },
) {
  if (!simulationEnabled()) return fail(404, "없는 경로예요.");
  if (!sameOrigin(request)) return fail(403, "허용되지 않은 요청이에요.");

  const { gateId } = await params;
  const body = (await request.json().catch(() => null)) as {
    requestId?: string;
    outcome?: "pass" | "block";
  } | null;
  if (!body?.requestId) return fail(400, "requestId 가 필요해요.");
  if (body.outcome === "pass") return simulatePass(gateId, body.requestId);
  if (body.outcome === "block") return simulateBlock(gateId, body.requestId);
  return fail(400, "outcome 은 pass 또는 block 이어야 해요.");
}
