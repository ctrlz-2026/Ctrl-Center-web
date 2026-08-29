import type { User, WorkCode } from "./types";

/** 작업코드가 요구하는 자격과 본인 보유 자격을 대조합니다.
 *
 *  이 판정이 가설 3의 연결 고리입니다 — 여기서 걸리면 키오스크가 검증 단계에
 *  들어가기 전에 차단하고(참조 화면 16번) 팀장에게 대체 인원 배정을 유도합니다.
 *  실제 구현에서는 서버가 판정하고 웹·키오스크는 결과만 받습니다. */
export function checkQualification(
  code: WorkCode,
  user: User,
): { ok: boolean; note: string } {
  if (!code.requiredQualification) {
    return { ok: true, note: "추가 자격 요건 없음" };
  }

  const held = user.qualifications.find(
    (q) => q.name === code.requiredQualification,
  );

  if (!held || held.status === "expired") {
    return { ok: false, note: `${code.requiredQualification} 만료` };
  }

  if (held.status === "expiring") {
    return { ok: true, note: `${held.name} ${held.badgeLabel} · 갱신 필요` };
  }

  return { ok: true, note: `${held.name} 유효` };
}

/** 승인 요청 화면에 쓰는 표시용 포맷. 숫자에는 단위를 붙이는 게 문안 규칙입니다. */
export function formatHeadcount(n: number) {
  return `${n}명`;
}

export function formatPpe(ppe: string[]) {
  return ppe.join(", ");
}
