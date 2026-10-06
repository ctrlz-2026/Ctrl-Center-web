import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { buildGateBundle, isDateString, seoulDate } from "@/lib/firebase/bundle";
import { loadFaceTemplates } from "@/lib/firebase/face-templates";
import { isResponse, requireGate } from "@/lib/firebase/gate-auth";
import type { FaceTemplatesResponse } from "@/lib/gate-contract";

/* 게이트 기기가 얼굴 특징 벡터를 내려받는 곳.
 *
 *   GET /api/gate/gate-b2/face-templates          오늘 이 게이트에 올 사람들
 *   GET /api/gate/gate-b2/face-templates?date=2026-10-07
 *   헤더: X-Gate-Key
 *
 * 관리자가 올린 벡터를 기기가 받아 자기 안에서 얼굴을 비교합니다. 비교는 여전히
 * 젯슨이 하고, 서버는 보관했다가 돌려줄 뿐입니다.
 *
 * **전 직원 것을 주지 않습니다.** 일일 번들과 같은 범위 — 그날 이 게이트에서
 * 승인된 작업에 올 수 있는 사람 — 만 내려갑니다. 기기는 현장 벽에 붙어 있어
 * 한 대가 털리면 담긴 만큼 새기 때문입니다. 작업이 없는 날은 빈 목록입니다.
 *
 * 바뀐 것이 없으면 304 로 답합니다 (If-None-Match). 벡터는 한 사람에 수 KB 라
 * 매번 다시 받을 이유가 없습니다. */

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

  // 누구 것을 줄지는 번들이 정합니다 — 같은 날 같은 게이트면 같은 사람들입니다.
  const bundle = await buildGateBundle(gate.id, gate.siteId, gate.name, date);
  const wanted = bundle.workers.filter((w) => w.face_enrolled).map((w) => w.emp_no);
  const { templates, undecryptable } = await loadFaceTemplates(wanted);

  const have = new Set(templates.map((t) => t.empNo));
  const body: FaceTemplatesResponse = {
    gate_id: gate.id,
    valid_for: date,
    templates: templates
      .sort((a, b) => a.empNo.localeCompare(b.empNo))
      .map((t) => ({
        emp_no: t.empNo,
        dim: t.dim,
        model: t.model,
        vectors: t.vectors,
        uploaded_at: t.uploadedAt,
      })),
    /* 등록됐다고 표시돼 있는데 서버에 벡터가 없는 사람. 젯슨 앞에서 직접 등록해
       "등록됨" 알림만 온 경우입니다 — 그 기기에는 있고 다른 기기에는 없습니다. */
    enrolled_without_template: wanted.filter((e) => !have.has(e) && !undecryptable.includes(e)),
    // 서버 키가 바뀌어 풀 수 없는 벡터. 관리자가 다시 올려야 합니다.
    needs_reupload: undecryptable,
  };

  // 벡터 값이 아니라 "누구 것이 언제 올라왔는가"로 판별합니다.
  const etag = `"${date}-${createHash("sha256")
    .update(JSON.stringify(body.templates.map((t) => [t.emp_no, t.uploaded_at])))
    .update(JSON.stringify([body.enrolled_without_template, body.needs_reupload]))
    .digest("hex")
    .slice(0, 16)}"`;
  if (request.headers.get("if-none-match") === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: { ETag: etag, "Cache-Control": "no-store" },
    });
  }
  return NextResponse.json(body, { headers: { ETag: etag, "Cache-Control": "no-store" } });
}
