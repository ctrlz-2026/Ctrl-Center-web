import "server-only";

import { createHash } from "node:crypto";
import { adminDb } from "./admin";
import { loadMasters } from "./queries";
import type {
  BundleWork,
  BundleWorkCode,
  BundleWorker,
  GateBundle,
} from "@/lib/gate-contract";

/* 일일 번들 만들기.
 *
 * 네트워크가 끊겨도 현장이 돌아가도록, 그 게이트가 **그날 쓸 것만** 모아 보냅니다.
 * 계약과 설계 의도는 lib/gate-contract.ts 아래쪽에 적어두었습니다. */

export const BUNDLE_VERSION = 1;

/** 한국 시각 기준 날짜 문자열. 게이트는 현장 시각으로 움직입니다. */
export function seoulDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(d);
}

export function isDateString(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

export async function buildGateBundle(
  gateId: string,
  siteId: string,
  siteName: string,
  date: string,
): Promise<GateBundle> {
  const db = adminDb();

  const [masters, reqSnap, cardSnap] = await Promise.all([
    loadMasters(),
    db
      .collection("approvalRequests")
      .where("siteId", "==", siteId)
      .where("status", "==", "approved")
      .get(),
    db.collection("employeeCards").get(),
  ]);

  /* ── 그날 열릴 수 있는 작업 ──────────────────────────────────────────────
   * 승인된 것만 담습니다. 승인 전 작업이 기기에 내려가면, 네트워크가 끊긴
   * 동안 결재도 안 난 작업으로 문이 열릴 수 있습니다.
   *
   * 예정 시각이 없는 요청은 날짜를 특정할 수 없어 같이 담습니다 — 예정 시각은
   * 원래 진입을 막는 값이 아니라 기록용이라(늦게 와도 통과) 여기서도 같은
   * 기준을 지킵니다. */
  const works: BundleWork[] = reqSnap.docs
    .filter((d) => {
      const at = d.data().scheduledAt;
      return !at || seoulDate(new Date(String(at))) === date;
    })
    .map((d) => {
      const r = d.data();
      return {
        request_id: d.id,
        work_code: String(r.workCode),
        scheduled_at: r.scheduledAt ? String(r.scheduledAt) : null,
        requester_emp_no: String(r.requesterId),
        note: r.approveNote ? String(r.approveNote) : null,
      };
    })
    .sort((a, b) => (a.scheduled_at ?? "").localeCompare(b.scheduled_at ?? ""));

  // 그날 쓰이는 작업코드만 기준을 내려보냅니다.
  const usedCodes = [...new Set(works.map((w) => w.work_code))].sort();
  const work_codes: BundleWorkCode[] = usedCodes.map((code) => {
    const w = masters.workCodes.get(code);
    return {
      code,
      name: String(w?.name ?? code),
      required_headcount: Number(w?.requiredHeadcount ?? 1),
      required_ppe: (w?.requiredPpe ?? []).map((p: string) => ({
        code: p,
        name: masters.ppeNames.get(p) ?? p,
        yolo_class: masters.ppeYolo.get(p) ?? null,
      })),
      required_qualifications: (w?.requiredQualifications ?? []).map((q: string) => ({
        code: q,
        name: masters.qualNames.get(q) ?? q,
      })),
      estimated_minutes: Number(w?.estimatedMinutes ?? 0),
    };
  });

  /* ── 들어올 수 있는 사람 ─────────────────────────────────────────────────
   * 전 직원을 내려보내지 않습니다. 기기는 현장에 노출돼 있어서, 한 대가 털리면
   * 담긴 만큼 새어 나갑니다. 그래서 **그날 그 작업코드에 배정된 사람**으로만
   * 좁힙니다. 배정이 따로 없는 계정(allowedWorkCodes 미설정)은 전 작업 가능이라
   * 그대로 포함합니다.
   *
   * 요청자만 담지 않는 이유 — 작업은 2~3명이 함께 들어가는데 신청서에는 요청자
   * 한 명만 적힙니다. 나머지 참여자가 누구일지는 태그해봐야 알 수 있어서,
   * 그 작업을 할 수 있는 사람을 미리 담아둬야 오프라인에서 판정이 됩니다. */
  const cardsByEmp = new Map<string, string[]>();
  for (const c of cardSnap.docs) {
    const d = c.data();
    if (d.revokedAt) continue; // 폐기된 카드는 빼고, 기록으로만 남깁니다
    const list = cardsByEmp.get(String(d.empNo)) ?? [];
    list.push(c.id); // 문서 ID 가 곧 카드 UID
    cardsByEmp.set(String(d.empNo), list);
  }

  const workers: BundleWorker[] = [];
  /* 그날 그 게이트에 승인된 작업이 하나도 없으면 사람 정보를 아예 담지 않습니다.
     검증할 일이 없는데 명단만 기기에 내려가 있을 이유가 없습니다. */
  for (const [empNo, e] of usedCodes.length ? masters.employees : []) {
    if (e.active === false) continue;
    const allowed = Array.isArray(e.allowedWorkCodes) ? e.allowedWorkCodes : null;
    if (allowed && !usedCodes.some((c) => allowed.includes(c))) continue;

    workers.push({
      emp_no: empNo,
      name: String(e.name ?? empNo),
      team: String(e.team ?? ""),
      rank: String(e.rank ?? ""),
      card_uids: cardsByEmp.get(empNo) ?? [],
      qualifications: (e.qualifications ?? []).map(
        (q: { code: string; expiresOn: string }) => ({
          code: q.code,
          name: masters.qualNames.get(q.code) ?? q.code,
          expires_on: q.expiresOn,
        }),
      ),
      allowed_work_codes: allowed,
      face_enrolled: e.faceEnrolled === true,
    });
  }
  workers.sort((a, b) => a.emp_no.localeCompare(b.emp_no));

  const body = { works, work_codes, workers };
  /* 내용이 같으면 같은 해시가 나오게 만듭니다. 생성 시각은 매번 달라지므로
     해시 대상에서 뺍니다 — 넣으면 바뀐 게 없어도 매번 다른 값이 됩니다. */
  const bundle_hash = createHash("sha256")
    .update(JSON.stringify(body))
    .digest("hex")
    .slice(0, 16);

  return {
    bundle_version: BUNDLE_VERSION,
    gate_id: gateId,
    site_id: siteId,
    site_name: siteName,
    valid_for: date,
    generated_at: new Date().toISOString(),
    bundle_hash,
    ...body,
  };
}
