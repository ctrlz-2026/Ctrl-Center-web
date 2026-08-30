/** 상태 → 색 매핑은 스펙상 고정입니다. 같은 상태에 다른 색을 쓰지 않기 위해
 *  화면이 직접 색을 고르지 못하게 하고, 상태값만 넘기도록 타입을 좁혀 둡니다. */
export type StatusTone =
  | "pending" // 대기중            primary / primary 8%
  | "success" // 승인됨 · 통과      green-50 / green 8%
  | "danger" // 반려됨 · 차단      red-50 / red 8%
  | "warning" // 시간 초과 · 만료 임박 orange-50 / orange 8%
  | "active" // 진행중            primary / inset 2px primary
  | "neutral"; // 대기 · 비활성      label-alternative / fill-normal

export type RequestStatus = "draft" | "pending" | "approved" | "rejected";

export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  draft: "작성중",
  pending: "대기중",
  approved: "승인됨",
  rejected: "반려됨",
};

export const REQUEST_STATUS_TONE: Record<RequestStatus, StatusTone> = {
  draft: "neutral",
  pending: "pending",
  approved: "success",
  rejected: "danger",
};

/** 게이트 세션 상태. 키오스크(Jetson)가 진행시키고 웹은 수신만 합니다. */
export type GateSessionState =
  | "selecting"
  | "confirming"
  | "tagging"
  | "face"
  | "verifying"
  | "unlocking"
  | "working"
  | "closed";

export type QualificationStatus = "valid" | "expiring" | "expired";

export const QUALIFICATION_TONE: Record<QualificationStatus, StatusTone> = {
  valid: "success",
  expiring: "warning",
  expired: "danger",
};

/** 역할 3종.
 *  - worker       생산 작업자. 작업 신청을 올림
 *  - leader       팀장급. 작업자의 신청을 승인·반려함
 *  - safety_admin 안전관리자. **작업 신청·승인을 하지 않고** 관제만 봄.
 *                 안전이 잘 지켜지고 있는지 확인하는 감독 역할입니다. */
export type Role = "worker" | "leader" | "safety_admin";

export const ROLE_LABEL: Record<Role, string> = {
  worker: "작업자",
  leader: "팀장",
  safety_admin: "안전관리자",
};

/** 권한은 화면마다 흩어놓지 않고 여기 한 곳에서만 정합니다.
 *  나중에 권한 규칙이 바뀌어도 이 함수들만 고치면 됩니다. */

/** 작업 신청은 **작업자만** 합니다.
 *
 *  결재권자(팀장)를 제외하는 이유: 본인이 올린 요청은 본인이 승인할 수 없는데,
 *  팀에 승인자가 한 명이면 그 요청은 처리할 사람이 없어 영원히 대기로 남습니다.
 *  승인자가 여러 명인 조직으로 바뀌면 이 규칙을 풀 수 있습니다. */
export function canRequestWork(role: Role) {
  return role === "worker";
}

export function canApprove(role: Role) {
  return role === "leader";
}

/* 관제(전체 현황)는 역할 함수가 없습니다 — 전원이 봅니다.
   안전관리자는 관제'만' 봅니다. */

export function canViewMyPage(role: Role) {
  // 안전관리자는 본인이 작업을 하지 않으므로 작업이력·특이사항이 없습니다.
  return role !== "safety_admin";
}

/** 개인별 출입 기록. 세션(작업) 단위가 아니라 **사람 단위**입니다.
 *  누가 어느 카드로 태그해서 언제 들어가고 언제 나왔는지 — 사후 추적의 핵심이며,
 *  입장 수 = 퇴장 수 대조도 이 기록으로 합니다 (PRD 플로우 9번). */
export interface AccessLog {
  id: string;
  sessionId: string;
  empNo: string;
  name: string;
  gateId: string;
  siteId: string;
  workCode: string;
  /** 어느 사원증으로 태그했는지. 대리 태그 추적에 필요합니다. */
  cardUid: string;
  taggedAt: string;
  /** 얼굴 1:1 매칭 결과. 판정은 젯슨이 하고 여기엔 결과만 남습니다. */
  faceMatched: boolean;
  faceScore: number | null;
  /** PPE 검증 통과 여부와 시도 횟수. 3회 실패는 팀장 알림 대상입니다. */
  ppePassed: boolean;
  ppeAttempts: number;
  enteredAt: string | null;
  exitedAt: string | null;
}

export interface WorkCode {
  /** 작업코드. 게이트 검증 기준의 1차 키입니다. */
  code: string;
  name: string;
  /** 필수인원. 작업자가 입력하지 않고 코드에서 자동으로 채워집니다. */
  requiredHeadcount: number;
  requiredPpe: string[];
  /** 이 자격이 없으면 게이트가 검증 단계 진입 전에 차단합니다(키오스크 16번). */
  requiredQualification?: string;
}

export interface Qualification {
  name: string;
  status: QualificationStatus;
  /** 만료 임박일 때 남은 일수 표기용 (예: "D-6"). */
  badgeLabel: string;
}

export interface User {
  employeeId: string;
  name: string;
  team: string;
  rank: string;
  role: Role;
  tenure: string;
  completedCount: number;
  qualifications: Qualification[];
}

export interface WorkHistory {
  id: string;
  /** 끝난 작업인지. 스펙상 특이사항은 작업 중에도 쓸 수 있어 진행중 작업도
   *  이 목록에 나옵니다 — 대신 소요시간·검증결과가 아직 없습니다. */
  closed: boolean;
  when: string;
  code: string;
  title: string;
  duration: string;
  members: string[];
  /** 검증결과 요약. 1차 통과 여부가 가설 2의 지표입니다. */
  verification: string;
  passedFirstTry: boolean;
  note?: string;
  /** 예정 시각 대비 시작 시점. 늦거나 일러도 막지 않고 기록만 남깁니다. */
  scheduleNote?: string;
  /** 이 작업에서의 내 출입 기록. 입·퇴장 시각과 검증 결과. */
  access?: {
    taggedAt: string | null;
    enteredAt: string | null;
    exitedAt: string | null;
    faceScore: number | null;
    ppeAttempts: number;
  };
}

export interface ApprovalRequest {
  id: string;
  requestedAt: string;
  /** 요청자 사번. 자기 요청을 자기가 승인하지 못하게 막는 데 씁니다. */
  requesterId: string;
  requesterName: string;
  requesterRank: string;
  requesterTenure: string;
  code: string;
  title: string;
  site: string;
  headcount: number;
  requiredPpe: string[];
  qualificationOk: boolean;
  qualificationNote: string;
  status: RequestStatus;
  /** 작업자가 적은 요청 사유 (선택). */
  reason?: string;
  /** 팀장이 적은 반려 사유. 스펙 권장상 사유 없이는 반려할 수 없습니다. */
  rejectReason?: string;
}

export type SiteStatusState =
  | "working"
  | "verifying"
  | "waiting"
  | "blocked"
  | "approved"
  | "unlocked";

export const SITE_STATUS_LABEL: Record<SiteStatusState, string> = {
  approved: "승인됨",
  unlocked: "문 열림",
  working: "진행중",
  verifying: "검증중",
  waiting: "대기",
  blocked: "차단",
};

export const SITE_STATUS_TONE: Record<SiteStatusState, StatusTone> = {
  approved: "success",
  unlocked: "pending",
  working: "active",
  verifying: "pending",
  waiting: "neutral",
  blocked: "danger",
};

export interface SiteStatus {
  /** 표의 행 키. 같은 작업장에 승인 대기와 진행중이 동시에 있을 수 있어
   *  작업장+작업명 조합으로는 유일하지 않습니다. */
  id: string;
  site: string;
  state: SiteStatusState;
  elapsed: string;
  /** 예상 소요시간을 넘겼는지. 넘기면 경과를 orange-50 600 으로 표기합니다.
   *  작업 "예정 시각"과는 다른 값입니다 — 이쪽은 얼마나 걸리느냐입니다. */
  overtime: boolean;
  headcount: string;
  work: string;
  /** 젯슨이 없는 동안 웹에서 수동으로 진행시키기 위한 버튼.
   *  문 열림은 곧 작업 시작이라 별도 "start" 단계는 없습니다.
   *  젯슨이 붙으면 이 필드는 null 이 되고 기기가 상태를 밀어 올립니다. */
  control: "unlock" | "end" | null;
  /** 수동 제어에 필요한 참조. */
  requestId?: string;
  sessionId?: string;
  /** 예정 시각 대비 언제 시작했는지. 진입을 막지는 않고 기록만 남깁니다. */
  scheduleNote?: string;
  /** 실제 시작 시각 (HH:mm). 세션이 생긴 것만 있습니다. */
  startedAtLabel?: string;
  /** 시작 시각 + 예상 소요시간 (HH:mm). 작업코드에 예상시간이 없으면 없습니다. */
  expectedEndLabel?: string;
}

export interface Anomaly {
  /** 같은 종류의 이상 상황이 동시에 여러 건 뜰 수 있어 제목은 키가 못 됩니다.
   *  세션 id 를 그대로 씁니다. */
  id: string;
  kind: "warning" | "blocked";
  title: string;
  detail: string;
}
