import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { isResponse, requireCaller } from "@/lib/firebase/auth-guard";
import { loadMasters, toRequestView, toSites, toWorkCodes } from "@/lib/firebase/queries";
import { canRequestWork } from "@/lib/types";

/** 승인 요청 목록 + 작업코드 마스터.
 *  화면이 두 번 왕복하지 않도록 한 번에 내려줍니다. */
export async function GET(request: Request) {
  const caller = await requireCaller(request);
  if (isResponse(caller)) return caller;

  const db = adminDb();
  const [masters, snap] = await Promise.all([
    loadMasters(),
    db.collection("approvalRequests").get(),
  ]);

  const requests = snap.docs
    .map((d) => ({ id: d.id, data: d.data() }))
    // 최신순. createdAt 은 ISO 문자열이라 사전순 = 시간순입니다.
    .sort((a, b) => String(b.data.createdAt).localeCompare(String(a.data.createdAt)))
    .map(({ id, data }) => toRequestView(id, data, masters));

  // 신청 화면에는 이 사람에게 배정된 작업만 띄웁니다.
  const allowed = masters.employees.get(caller.empNo)?.allowedWorkCodes;

  return NextResponse.json({
    requests,
    workCodes: toWorkCodes(masters, Array.isArray(allowed) ? allowed : null),
    sites: toSites(masters),
    me: caller,
  });
}

/** 새 작업 승인 요청. */
export async function POST(request: Request) {
  const caller = await requireCaller(request);
  if (isResponse(caller)) return caller;

  if (!canRequestWork(caller.role)) {
    return NextResponse.json(
      { error: "이 계정은 작업 신청을 할 수 없어요." },
      { status: 403 },
    );
  }

  let body: {
    workCode?: string;
    siteId?: string;
    scheduledAt?: string;
    reason?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON 형식이 아니에요." }, { status: 400 });
  }

  const db = adminDb();
  const masters = await loadMasters();

  if (!body.workCode || !masters.workCodes.has(body.workCode)) {
    return NextResponse.json(
      { error: "작업코드를 고르지 않았거나 없는 코드예요." },
      { status: 400 },
    );
  }
  const siteId = body.siteId ?? "site-b2";
  if (!masters.sites.has(siteId)) {
    return NextResponse.json({ error: "없는 작업장이에요." }, { status: 400 });
  }

  /* 작업 배정 확인. 관리자가 이 사람에게 허용한 작업만 신청할 수 있습니다.
   *
   * 자격과는 **별개의 조건**입니다 — 자격은 "할 줄 아는가", 배정은 "맡았는가"라
   * 둘 다 봐야 합니다. 자격 확인은 게이트(젯슨)가 하고, 여기서는 배정만 봅니다.
   * allowedWorkCodes 가 없으면(null) 배정 제한이 없다는 뜻이라 통과시킵니다. */
  const me = masters.employees.get(caller.empNo);
  const allowed = me?.allowedWorkCodes;
  if (Array.isArray(allowed) && !allowed.includes(body.workCode)) {
    return NextResponse.json(
      {
        error:
          "배정되지 않은 작업이에요. 안전관리팀에 작업 배정을 요청해주세요.",
      },
      { status: 403 },
    );
  }

  const now = new Date().toISOString();

  // 예정 시각은 화면이 보낸 값을 쓰되, 형식이 깨졌으면 지금으로 둡니다.
  const scheduledAt =
    body.scheduledAt && !Number.isNaN(Date.parse(body.scheduledAt))
      ? new Date(body.scheduledAt).toISOString()
      : now;

  const doc = {
    requesterId: caller.empNo,
    workCode: body.workCode,
    siteId,
    scheduledAt,
    reason: body.reason?.trim() || null,
    status: "pending" as const,
    approverId: null,
    decidedAt: null,
    rejectReason: null,
    createdAt: now,
  };

  const ref = await db.collection("approvalRequests").add(doc);
  return NextResponse.json(toRequestView(ref.id, doc, masters), { status: 201 });
}
