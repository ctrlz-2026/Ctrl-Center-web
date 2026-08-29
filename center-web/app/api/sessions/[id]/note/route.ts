import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { isResponse, requireCaller } from "@/lib/firebase/auth-guard";

/* 특이사항 저장.
 *
 * 문서 ID 를 `{세션}_{사번}` 으로 고정합니다. 같은 세션에 여러 명이 각자 메모를
 * 남길 수 있고, 같은 사람이 여러 번 저장하면 덮어써야 하기 때문입니다.
 * add() 로 만들면 저장할 때마다 새 문서가 쌓입니다.
 *
 * 스펙: 특이사항은 작업 중에도, 끝난 뒤에도 쓸 수 있습니다. 그래서 세션 상태는
 * 보지 않고, 본인이 그 작업에 참여했는지만 확인합니다. */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const caller = await requireCaller(request);
  if (isResponse(caller)) return caller;

  let body: { note?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON 형식이 아니에요." }, { status: 400 });
  }

  const note = body.note?.trim() ?? "";
  if (!note) {
    return NextResponse.json(
      { error: "특이사항 내용을 적어주세요." },
      { status: 400 },
    );
  }

  const { id } = await params;
  const db = adminDb();
  const session = await db.collection("gateSessions").doc(id).get();

  if (!session.exists) {
    return NextResponse.json({ error: "없는 작업이에요." }, { status: 404 });
  }

  // 남의 작업에 메모를 남길 수는 없습니다.
  const members: string[] = session.data()?.members ?? [];
  if (!members.includes(caller.empNo)) {
    return NextResponse.json(
      { error: "참여하지 않은 작업이에요." },
      { status: 403 },
    );
  }

  const now = new Date().toISOString();
  await db
    .collection("workNotes")
    .doc(`${id}_${caller.empNo}`)
    .set(
      {
        sessionId: id,
        empNo: caller.empNo,
        note,
        updatedAt: now,
        createdAt: now,
      },
      { merge: true },
    );

  return NextResponse.json({ ok: true, note });
}
