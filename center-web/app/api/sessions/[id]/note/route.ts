import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { isResponse, requireCaller } from "@/lib/firebase/auth-guard";

/* 특이사항 저장.
 *
 *   PUT { note: "..." }     내용을 남김
 *   PUT { none: true }      "특이사항 없음"으로 표시
 *
 * "없음"을 따로 받는 이유: 남길 말이 없는 작업도 많은데, 그걸 "아직 안 쓴 것"과
 * 섞으면 작성할 목록이 영원히 줄지 않습니다. 빈 글을 저장하게 하는 대신
 * **없다는 사실을 명시**하게 했습니다. 나중에 내용을 쓰면 없음 표시는 풀립니다.
 *
 * 문서 ID 를 `{세션}_{사번}` 으로 고정합니다. 같은 세션에 여러 명이 각자 메모를
 * 남길 수 있고, 같은 사람이 여러 번 저장하면 덮어써야 하기 때문입니다.
 *
 * 스펙: 특이사항은 작업 중에도, 끝난 뒤에도 쓸 수 있습니다. 그래서 세션 상태는
 * 보지 않고, 본인이 그 작업에 참여했는지만 확인합니다. */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const caller = await requireCaller(request);
  if (isResponse(caller)) return caller;

  let body: { note?: string; none?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON 형식이 아니에요." }, { status: 400 });
  }

  const none = body.none === true;
  const note = none ? "" : (body.note?.trim() ?? "");
  if (!none && !note) {
    return NextResponse.json(
      { error: "특이사항 내용을 적거나 '남길 말 없음'을 골라주세요." },
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

  const ref = db.collection("workNotes").doc(`${id}_${caller.empNo}`);
  const now = new Date().toISOString();
  const existing = await ref.get();
  await ref.set({
    sessionId: id,
    empNo: caller.empNo,
    note,
    none,
    updatedAt: now,
    // 처음 남긴 시각은 고칠 때마다 덮어쓰지 않습니다.
    createdAt: existing.exists ? (existing.data()?.createdAt ?? now) : now,
  });

  return NextResponse.json({ ok: true, note, none, savedAt: now });
}
