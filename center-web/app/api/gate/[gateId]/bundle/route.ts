import { NextResponse } from "next/server";
import { buildGateBundle, isDateString, seoulDate } from "@/lib/firebase/bundle";
import { isResponse, requireGate } from "@/lib/firebase/gate-auth";

/* ────────────────────────────────────────────────────────────────────────────
 * 일일 번들 내려주기 — 네트워크가 끊겨도 현장이 돌아가게
 *
 * 2차 멘토링 조언을 구현한 것입니다. 지금은 젯슨이 관찰을 보내고 서버가 판정해
 * 응답을 내려주는데, 인터넷이 끊기면 문을 열 수 없습니다. 그래서 **그 게이트가
 * 그날 쓸 자료**를 미리 한 번들로 받아두게 했습니다.
 *
 *   GET /api/gate/gate-a1/bundle              오늘치 (한국 시각 기준)
 *   GET /api/gate/gate-a1/bundle?date=2026-09-22   특정 날짜
 *   헤더: X-Gate-Key: <게이트별 기기 키>
 *
 * 젯슨은 하루 한 번(예: 새벽) 받아두고, 온라인일 때는 평소대로 서버 판정을
 * 따릅니다. 번들은 끊겼을 때만 쓰는 대비책입니다.
 *
 * 내용이 안 바뀌었으면 304 로 답합니다 — 매일 받아도 같은 걸 다시 내려보내지
 * 않으려는 것입니다. 젯슨은 받은 ETag 를 `If-None-Match` 로 보내면 됩니다.
 * ──────────────────────────────────────────────────────────────────────────── */

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ gateId: string }> },
) {
  const { gateId } = await params;

  const gate = await requireGate(request, gateId);
  if (isResponse(gate)) return gate;

  const asked = new URL(request.url).searchParams.get("date");
  if (asked && !isDateString(asked)) {
    return NextResponse.json(
      { error: "date 는 YYYY-MM-DD 형식이어야 해요." },
      { status: 400 },
    );
  }
  const date = asked ?? seoulDate();

  const bundle = await buildGateBundle(gate.id, gate.siteId, gate.name, date);

  /* 날짜가 다르면 내용이 같아도 다른 번들입니다 — 해시에 날짜를 함께 넣습니다. */
  const etag = `"${bundle.valid_for}-${bundle.bundle_hash}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: etag, "Cache-Control": "no-store" },
    });
  }

  return NextResponse.json(bundle, {
    headers: { ETag: etag, "Cache-Control": "no-store" },
  });
}
