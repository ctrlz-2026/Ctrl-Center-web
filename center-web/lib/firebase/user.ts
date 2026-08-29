import type { Qualification, QualificationStatus, Role, User } from "@/lib/types";

/** 사번 → Auth 이메일. 사내 계정이라 실제 메일 주소가 없어 도메인을 붙여 씁니다. */
export const emailOf = (empNo: string) => `${empNo.trim()}@center.local`;

/** 만료 임박으로 볼 기간. 스펙의 "D-6" 배지가 이 구간입니다. */
const EXPIRING_DAYS = 30;

/** 자격 상태는 저장하지 않고 expiresOn 에서 파생합니다.
 *  상태를 컬럼으로 굳히면 배치를 돌리지 않는 한 반드시 썩습니다. */
export function qualificationStatus(
  expiresOn: string,
  now = new Date(),
): { status: QualificationStatus; daysLeft: number } {
  const end = new Date(`${expiresOn}T00:00:00+09:00`);
  const daysLeft = Math.ceil(
    (end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (daysLeft < 0) return { status: "expired", daysLeft };
  if (daysLeft <= EXPIRING_DAYS) return { status: "expiring", daysLeft };
  return { status: "valid", daysLeft };
}

function toQualification(
  name: string,
  expiresOn: string,
  now?: Date,
): Qualification {
  const { status, daysLeft } = qualificationStatus(expiresOn, now);
  const badgeLabel =
    status === "expired" ? "만료" : status === "expiring" ? `D-${daysLeft}` : "유효";
  return { name, status, badgeLabel };
}

/** 근속 기간 문자열. 입사일에서 계산합니다. */
export function tenureOf(hiredOn: string, now = new Date()): string {
  const start = new Date(`${hiredOn}T00:00:00+09:00`);
  let months =
    (now.getFullYear() - start.getFullYear()) * 12 +
    (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) months -= 1;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0) return `${rest}개월`;
  return rest === 0 ? `${years}년` : `${years}년 ${rest}개월`;
}

interface EmployeeDoc {
  empNo: string;
  name: string;
  team: string;
  rank: string;
  role: Role;
  hiredOn: string;
  completedCount: number;
  qualifications?: { code: string; expiresOn: string }[];
}

/** Firestore employees 문서 → 화면이 쓰는 User.
 *  자격 이름은 qualifications 컬렉션에서 온 code→name 맵으로 채웁니다. */
export function toUser(
  doc: EmployeeDoc,
  qualificationNames: Record<string, string>,
  now?: Date,
): User {
  return {
    employeeId: doc.empNo,
    name: doc.name,
    team: doc.team,
    rank: doc.rank,
    role: doc.role,
    tenure: tenureOf(doc.hiredOn, now),
    completedCount: doc.completedCount ?? 0,
    qualifications: (doc.qualifications ?? []).map((q) =>
      toQualification(qualificationNames[q.code] ?? q.code, q.expiresOn, now),
    ),
  };
}
