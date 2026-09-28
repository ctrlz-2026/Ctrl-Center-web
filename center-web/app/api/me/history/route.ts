import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { isResponse, requireCaller } from "@/lib/firebase/auth-guard";
import { scheduleNote } from "@/lib/firebase/dashboard";
import { loadMasters } from "@/lib/firebase/queries";
import { NOTE_DUE_DAYS } from "@/lib/types";
import type { NoteState, WorkHistory } from "@/lib/types";

/* 내 작업 이력 + 특이사항.
 *
 * 이력은 별도 테이블이 아니라 **내가 참여한 게이트 세션**입니다. 젯슨(또는
 * 키오스크)이 세션을 만들면 같은 컬렉션에 쌓이고 이 경로는 그대로 동작합니다.
 *
 * 문 앞에서 막힌 시도(blocked)는 작업을 한 게 아니라 이력에 넣지 않습니다.
 *
 * 특이사항 상태(noteState)를 서버가 정해서 내려줍니다 — "작성 필요"와
 * "작성 안 함"을 가르는 기준(7일)이 화면마다 다르면 안 되기 때문입니다. */

const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  const fmt = (o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("ko-KR", { ...o, timeZone: "Asia/Seoul" }).format(d);

  const dayDiff = Math.floor(
    (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) -
      Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) /
      86_400_000,
  );
  const time = fmt({ hour: "2-digit", minute: "2-digit", hour12: false });
  if (dayDiff === 0) return `오늘 ${time}`;
  if (dayDiff === 1) return `어제 ${time}`;
  return fmt({ month: "long", day: "numeric" });
};

const duration = (minutes: number) =>
  minutes >= 60
    ? minutes % 60 === 0
      ? `${Math.floor(minutes / 60)}시간`
      : `${Math.floor(minutes / 60)}시간 ${minutes % 60}분`
    : `${minutes}분`;

export async function GET(request: Request) {
  const caller = await requireCaller(request);
  if (isResponse(caller)) return caller;

  const db = adminDb();
  const [masters, sessions, notes, access] = await Promise.all([
    loadMasters(),
    db
      .collection("gateSessions")
      .where("members", "array-contains", caller.empNo)
      .get(),
    db.collection("workNotes").where("empNo", "==", caller.empNo).get(),
    // 개인별 출입 기록. 세션 단위가 아니라 사람 단위라 따로 읽습니다.
    db.collection("accessLogs").where("empNo", "==", caller.empNo).get(),
  ]);

  const noteBySession = new Map(
    notes.docs.map((d) => {
      const n = d.data();
      return [
        String(n.sessionId),
        {
          text: String(n.note ?? "").trim(),
          none: n.none === true,
          savedAt: String(n.updatedAt ?? n.createdAt ?? ""),
        },
      ];
    }),
  );
  const accessBySession = new Map(
    access.docs.map((d) => {
      const a = d.data();
      return [
        String(a.sessionId),
        {
          taggedAt: a.taggedAt ?? null,
          enteredAt: a.enteredAt ?? null,
          exitedAt: a.exitedAt ?? null,
          faceScore: a.faceScore ?? null,
          ppeAttempts: Number(a.ppeAttempts ?? 0),
        },
      ];
    }),
  );

  const dueMs = NOTE_DUE_DAYS * 86_400_000;
  const now = Date.now();

  const history: WorkHistory[] = sessions.docs
    .map((d) => ({ id: d.id, s: d.data() }))
    .filter(({ s }) => s.state !== "blocked")
    .sort((a, b) => String(b.s.startedAt).localeCompare(String(a.s.startedAt)))
    .map(({ id, s }) => {
      const closed = s.state === "closed";
      const note = noteBySession.get(id);
      const endedAt = String(s.endedAt ?? s.startedAt);
      const noteState: NoteState = note?.text
        ? "written"
        : note?.none
          ? "none"
          : !closed
            ? "open"
            : now - new Date(endedAt).getTime() > dueMs
              ? "lapsed"
              : "todo";

      return {
        id,
        closed,
        noteState,
        noteSavedLabel: note?.savedAt ? dayLabel(note.savedAt) : undefined,
        startedAt: String(s.startedAt),
        when: dayLabel(String(s.startedAt)),
        code: String(s.workCode),
        title: String(masters.workCodes.get(String(s.workCode))?.name ?? s.workCode),
        // 진행중이면 확정된 소요시간이 없으므로 지금까지의 경과를 씁니다.
        duration: closed
          ? duration(Number(s.durationMinutes ?? 0))
          : duration(
              Math.max(
                0,
                Math.floor((now - new Date(String(s.startedAt)).getTime()) / 60_000),
              ),
            ),
        // 참여인원은 사번으로 저장하고 표시할 때 이름으로 바꿉니다.
        members: (s.members ?? []).map(
          (empNo: string) => String(masters.employees.get(empNo)?.name ?? empNo),
        ),
        verification: String(s.verification ?? ""),
        passedFirstTry: Boolean(s.passedFirstTry),
        scheduleNote: scheduleNote(s.scheduledAt, s.startedAt),
        note: note?.text || undefined,
        access: accessBySession.get(id),
      };
    });

  return NextResponse.json({ history });
}
