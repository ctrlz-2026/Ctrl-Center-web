import "server-only";

import { adminDb } from "./admin";
import { qualificationStatus, tenureOf } from "./user";
import type { ApprovalRequest, RequestStatus, WorkCode } from "@/lib/types";

/* 서버에서만 도는 조회 헬퍼.
 *
 * Firestore 는 조인이 없으므로 화면이 필요로 하는 모양을 서버가 만들어 내려줍니다.
 * 마스터(작업코드·직원·작업장·보호구)는 건수가 적어 통째로 읽고 메모리에서 맞춥니다 —
 * 요청마다 문서 수십 개를 개별 조회하는 것보다 훨씬 쌉니다. */

interface Masters {
  workCodes: Map<string, FirebaseFirestore.DocumentData>;
  employees: Map<string, FirebaseFirestore.DocumentData>;
  sites: Map<string, string>;
  ppeNames: Map<string, string>;
  qualNames: Map<string, string>;
}

export async function loadMasters(): Promise<Masters> {
  const db = adminDb();
  const [wc, emp, site, ppe, qual] = await Promise.all([
    db.collection("workCodes").get(),
    db.collection("employees").get(),
    db.collection("sites").get(),
    db.collection("ppeItems").get(),
    db.collection("qualifications").get(),
  ]);
  return {
    workCodes: new Map(wc.docs.map((d) => [d.id, d.data()])),
    employees: new Map(emp.docs.map((d) => [d.id, d.data()])),
    sites: new Map(site.docs.map((d) => [d.id, String(d.data().name)])),
    ppeNames: new Map(ppe.docs.map((d) => [d.id, String(d.data().name)])),
    qualNames: new Map(qual.docs.map((d) => [d.id, String(d.data().name)])),
  };
}

export interface SiteOption { id: string; name: string }

/** 작업장 선택지. */
export function toSites(m: Masters): SiteOption[] {
  return [...m.sites.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

/** 작업코드를 화면이 쓰는 모양으로. 보호구 코드는 사람이 읽는 이름으로 바꿉니다. */
export function toWorkCodes(m: Masters): WorkCode[] {
  return [...m.workCodes.entries()]
    .filter(([, w]) => w.active !== false)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, w]) => ({
      code,
      name: String(w.name),
      requiredHeadcount: Number(w.requiredHeadcount ?? 1),
      requiredPpe: (w.requiredPpe ?? []).map(
        (p: string) => m.ppeNames.get(p) ?? p,
      ),
      requiredQualification: (w.requiredQualifications ?? []).length
        ? (m.qualNames.get(w.requiredQualifications[0]) ??
          w.requiredQualifications[0])
        : undefined,
    }));
}

/** 작업코드가 요구하는 자격과 요청자의 보유 자격을 대조합니다.
 *  가설 3의 판정이며, 웹과 젯슨이 같은 결과를 봐야 하므로 서버에 둡니다. */
function checkQualification(
  workCode: FirebaseFirestore.DocumentData,
  employee: FirebaseFirestore.DocumentData | undefined,
  qualNames: Map<string, string>,
): { ok: boolean; note: string } {
  const required: string[] = workCode.requiredQualifications ?? [];
  if (required.length === 0) return { ok: true, note: "추가 자격 요건 없음" };

  const held: { code: string; expiresOn: string }[] =
    employee?.qualifications ?? [];

  for (const code of required) {
    const name = qualNames.get(code) ?? code;
    const has = held.find((q) => q.code === code);
    if (!has) return { ok: false, note: `${name} 미보유` };
    const { status, daysLeft } = qualificationStatus(has.expiresOn);
    if (status === "expired") return { ok: false, note: `${name} 만료` };
    if (status === "expiring")
      return { ok: true, note: `${name} D-${daysLeft} · 갱신 필요` };
  }
  return { ok: true, note: `${qualNames.get(required[0]) ?? required[0]} 유효` };
}

const hhmm = new Intl.DateTimeFormat("ko-KR", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Seoul",
});

/** Firestore 문서 → 화면이 쓰는 ApprovalRequest. */
export function toRequestView(
  id: string,
  d: FirebaseFirestore.DocumentData,
  m: Masters,
): ApprovalRequest {
  const emp = m.employees.get(String(d.requesterId));
  const wc = m.workCodes.get(String(d.workCode));
  const qual = checkQualification(wc ?? {}, emp, m.qualNames);

  return {
    id,
    requestedAt: hhmm.format(new Date(d.createdAt)),
    requesterId: String(d.requesterId),
    requesterName: String(emp?.name ?? "알 수 없음"),
    requesterRank: String(emp?.rank ?? ""),
    requesterTenure: emp?.hiredOn ? tenureOf(String(emp.hiredOn)) : "",
    code: String(d.workCode),
    title: String(wc?.name ?? d.workCode),
    site: m.sites.get(String(d.siteId)) ?? String(d.siteId),
    headcount: Number(wc?.requiredHeadcount ?? 0),
    requiredPpe: (wc?.requiredPpe ?? []).map(
      (p: string) => m.ppeNames.get(p) ?? p,
    ),
    qualificationOk: qual.ok,
    qualificationNote: qual.note,
    status: d.status as RequestStatus,
    reason: d.reason ?? undefined,
    rejectReason: d.rejectReason ?? undefined,
  };
}
