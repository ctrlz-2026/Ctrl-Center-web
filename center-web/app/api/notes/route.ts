import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { isResponse, requireCaller } from "@/lib/firebase/auth-guard";
import { loadMasters } from "@/lib/firebase/queries";
import type { SiteNotes } from "@/lib/types";

/* 작업장별 특이사항.
 *
 * 마이페이지의 특이사항은 **내가 쓴 것**만 보여줍니다. 그런데 특이사항은 원래
 * 다음에 그 장소에 들어갈 사람이 읽어야 쓸모가 있습니다 — "여기 바닥이 미끄럽다"는
 * 메모는 쓴 사람이 아니라 다음 사람에게 필요합니다.
 * 그래서 장소를 기준으로 다시 묶어 전원에게 열어둡니다.
 *
 * 역할 제한이 없습니다. 안전관리자도 봐야 하고(감독), 작업자도 봐야 합니다(예방). */

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

export async function GET(request: Request) {
  const caller = await requireCaller(request);
  if (isResponse(caller)) return caller;

  const db = adminDb();
  const [masters, noteSnap, sessionSnap] = await Promise.all([
    loadMasters(),
    db.collection("workNotes").get(),
    db.collection("gateSessions").get(),
  ]);

  // 특이사항은 세션에 달려 있고 장소는 세션이 압니다. Firestore 는 조인이
  // 없으므로 세션을 통째로 읽어 메모리에서 맞춥니다 (건수가 적습니다).
  const sessionById = new Map(sessionSnap.docs.map((d) => [d.id, d.data()]));

  const bySite = new Map<string, SiteNotes["notes"]>();

  for (const doc of noteSnap.docs) {
    const n = doc.data();
    const session = sessionById.get(String(n.sessionId));
    // 세션이 지워졌으면 어느 장소 메모인지 알 수 없어 건너뜁니다.
    if (!session) continue;

    const siteId = String(session.siteId);
    const emp = masters.employees.get(String(n.empNo));
    const workCode = String(session.workCode);
    const at = String(n.updatedAt ?? n.createdAt ?? session.startedAt);

    const list = bySite.get(siteId) ?? [];
    list.push({
      id: doc.id,
      note: String(n.note),
      authorName: String(emp?.name ?? n.empNo),
      authorRank: String(emp?.rank ?? ""),
      workCode,
      workTitle: String(masters.workCodes.get(workCode)?.name ?? workCode),
      when: dayLabel(at),
      at,
    });
    bySite.set(siteId, list);
  }

  /* 장소는 메모가 없는 곳도 전부 내려줍니다 — 목록에서 빠지면 "아직 아무도 안
     남겼다"와 "그런 장소가 없다"를 구분할 수 없습니다. */
  const sites: SiteNotes[] = [...masters.sites.entries()]
    .map(([id, name]) => ({
      siteId: id,
      siteName: name,
      notes: (bySite.get(id) ?? []).sort((a, b) => b.at.localeCompare(a.at)),
    }))
    // 최근 메모가 있는 장소부터. 손이 가야 할 곳이 위로 옵니다.
    .sort((a, b) => {
      if (a.notes.length === 0 !== (b.notes.length === 0)) {
        return a.notes.length === 0 ? 1 : -1;
      }
      if (a.notes.length === 0) return a.siteName.localeCompare(b.siteName, "ko");
      return b.notes[0].at.localeCompare(a.notes[0].at);
    });

  return NextResponse.json({ sites, viewerEmpNo: caller.empNo });
}
