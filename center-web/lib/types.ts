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

/** 작업 신청은 **작업자와 팀장**이 합니다.
 *
 *  팀장도 현장 작업에 직접 들어갑니다(김병오 팀장의 작업 이력이 그 증거입니다).
 *  처음에는 팀장을 제외했었는데, 그건 "본인 요청은 본인이 승인 못 한다"는 규칙
 *  때문에 팀에 승인자가 한 명이면 그 요청이 영원히 대기로 남기 때문이었습니다.
 *
 *  그 데드락은 **셀프 승인을 허용**해서 풀었습니다 (2026-08-30). 팀장이
 *  키오스크를 통과하려면 승인된 작업이 있어야 하는데, 승인자가 한 명뿐인 팀에서
 *  막아두면 팀장은 자기 작업장에 못 들어갑니다. 대신 승인자가 요청자와 같으면
 *  `selfApproved` 로 기록에 남깁니다 — 허용하되 추적은 됩니다. */
export function canRequestWork(role: Role) {
  return role === "worker" || role === "leader";
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

/** 계정 관리(가입 승인·비밀번호 초기화·역할 변경·비활성화)는 안전관리자만 합니다.
 *
 *  팀장이 아니라 안전관리자인 이유: 팀장은 자기 팀원을 승인하는 사람이라
 *  계정까지 쥐면 한 사람이 "누구를 들여보낼지"와 "그 사람이 누구인지"를 모두
 *  정하게 됩니다. 출입통제에서는 이 둘을 갈라놓는 편이 안전합니다. */
export function canManageAccounts(role: Role) {
  return role === "safety_admin";
}

/** 가입 신청 상태. 승인되기 전에는 로그인 계정이 만들어지지 않습니다. */
export type SignupStatus = "pending" | "approved" | "rejected";

export const SIGNUP_STATUS_LABEL: Record<SignupStatus, string> = {
  pending: "대기중",
  approved: "승인됨",
  rejected: "거절됨",
};

export const SIGNUP_STATUS_TONE: Record<SignupStatus, StatusTone> = {
  pending: "pending",
  approved: "success",
  rejected: "danger",
};

/** 가입 신청 한 건. */
export interface SignupRequest {
  id: string;
  empNo: string;
  name: string;
  team: string;
  rank: string;
  status: SignupStatus;
  requestedAt: string;
  /** 거절 사유. 사유 없이 거절할 수 없습니다(반려 규칙과 같은 이유). */
  rejectReason?: string;
}

/** 관리자가 편집하는 한 사람의 상세.
 *
 *  **얼굴 데이터는 여기 없습니다.** 얼굴인식 판정은 전적으로 젯슨이 하고
 *  (lib/gate-contract.ts), 웹은 결과만 받습니다. 얼굴 사진·특징값은 생체정보라
 *  웹 DB 에 두면 보관·파기 책임이 통째로 따라옵니다. 그래서 웹은 **등록됐는지
 *  여부만** 대장으로 들고, 실제 템플릿은 기기에 남깁니다. */
export interface AccountProfile {
  empNo: string;
  name: string;
  /** 보유 자격 + 만료일. 유효/임박/만료는 저장하지 않고 만료일에서 파생합니다. */
  qualifications: { code: string; name: string; expiresOn: string }[];
  /** 사원증 NFC UID. 실물 발급 전에는 `TEMP-*` 이고 pending 입니다. */
  card: { cardUid: string; issuedAt: string; pending: boolean } | null;
  /** 얼굴이 등록됐는지. 벡터를 올렸거나, 젯슨이 "등록했다"고 알린 경우입니다. */
  faceEnrolled: boolean;
  faceEnrolledAt: string | null;
  /** 서버에 올라와 있는 얼굴 특징 벡터의 요약. **벡터 자체는 브라우저로 오지
   *  않습니다** — 몇 차원 · 몇 개 · 언제 올렸는지만 봅니다. 없으면 null. */
  faceTemplate: {
    dim: number;
    count: number;
    model: string | null;
    fileName: string | null;
    uploadedAt: string;
  } | null;
  /** 이 사람에게 배정된 작업코드.
   *  `null` = 배정 제한 없음(자격 요건만 봅니다). 배열이면 그 목록으로 제한됩니다.
   *  **자격과 별개의 조건입니다** — 자격이 있어도 배정되지 않으면 못 하고,
   *  배정돼 있어도 자격이 만료되면 게이트가 막습니다. */
  allowedWorkCodes: string[] | null;
}

/** 관리자 콘솔이 고를 수 있는 선택지 (자격 종류·작업코드). */
export interface AccountProfileOptions {
  qualifications: { code: string; name: string }[];
  workCodes: { code: string; name: string; requiredQualifications: string[] }[];
}

/** 관리자 콘솔의 계정 한 줄. */
export interface ManagedAccount {
  empNo: string;
  name: string;
  team: string;
  rank: string;
  role: Role;
  /** 퇴사·휴직 처리. 삭제가 아니라 비활성화입니다 — 지우면 과거 작업 이력의
   *  참여자 이름이 빈칸이 됩니다. */
  active: boolean;
  /** 로그인 계정이 실제로 있는지. 가상 인물은 employees 에만 있고 계정이 없습니다. */
  hasLogin: boolean;
  /** 사원증 상태. 게이트를 지나려면 실물 카드가 등록돼 있어야 합니다.
   *  - `issued` 실물 UID 등록됨  - `temp` 임시 UID (실물 미발급)  - `none` 없음 */
  card: "issued" | "temp" | "none";
  /** 젯슨에 얼굴 등록을 마쳤는지. 사진·특징값은 웹에 없습니다. */
  faceEnrolled: boolean;
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

/** 작업 한 건의 특이사항 상태. 이력이 쌓여도 "무엇을 아직 안 썼는지"가 보이게
 *  하려고 나눴습니다.
 *
 *  - `written`  내용을 남김
 *  - `none`     **"특이사항 없음"으로 직접 표시함** — 남길 말이 없는 작업도
 *               흔한데, 그걸 "아직 안 쓴 것"과 섞으면 목록이 영원히 안 줄어듭니다
 *  - `todo`     끝났는데 아직 아무것도 안 함 (최근 7일)
 *  - `lapsed`   7일이 지나도록 아무것도 안 함 — 이제 와서 쓰라고 조르지 않고
 *               "작성 안 함"으로 접어 둡니다. 원하면 지금도 쓸 수 있습니다
 *  - `open`     아직 진행중인 작업 (작업 중에도 쓸 수 있습니다) */
export type NoteState = "written" | "none" | "todo" | "lapsed" | "open";

/** "작성 안 함"으로 넘어가기까지의 기한. 기억이 생생할 때 쓰라는 기간입니다. */
export const NOTE_DUE_DAYS = 7;

export const NOTE_STATE_LABEL: Record<NoteState, string> = {
  written: "작성함",
  none: "특이사항 없음",
  todo: "작성 필요",
  lapsed: "작성 안 함",
  open: "진행중",
};

export const NOTE_STATE_TONE: Record<NoteState, StatusTone> = {
  written: "success",
  none: "neutral",
  todo: "warning",
  lapsed: "neutral",
  open: "active",
};

export interface WorkHistory {
  id: string;
  /** 끝난 작업인지. 스펙상 특이사항은 작업 중에도 쓸 수 있어 진행중 작업도
   *  이 목록에 나옵니다 — 대신 소요시간·검증결과가 아직 없습니다. */
  closed: boolean;
  /** 특이사항 상태. 위 NoteState 설명 참고. */
  noteState: NoteState;
  /** 마지막으로 특이사항을 저장(또는 "없음" 표시)한 때. 사람이 읽는 형식입니다. */
  noteSavedLabel?: string;
  /** 정렬용 시작 시각 ISO. */
  startedAt: string;
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
  /** 팀장이 **승인하면서** 남긴 한마디 (선택).
   *
   *  반려 사유와 따로 두는 이유: 반려 사유는 "왜 안 되는지"라 요청이 거기서
   *  끝나지만, 이건 "가되 이건 알고 가라"는 당부라 **작업자가 현장에서 읽어야**
   *  합니다. 그래서 키오스크 작업 카드에도 같이 내려갑니다. */
  approveNote?: string;
  /** 결재한 사람 이름. 누구 말인지 모르면 당부도 무게가 없습니다. */
  approverName?: string;
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

/** 표의 행 왼쪽에 세우는 상태색 띠. 배지를 읽지 않고도 빨강=차단,
 *  파랑=진행중이 눈에 먼저 들어오게 하려는 것입니다.
 *  대기·검증중은 손이 갈 일이 없어 띠를 주지 않습니다 — 전부 색을 칠하면
 *  아무것도 강조되지 않습니다. */
export const SITE_STATUS_ACCENT: Record<SiteStatusState, string | undefined> = {
  approved: "var(--green-50)",
  unlocked: "var(--primary-normal)",
  working: "var(--primary-normal)",
  verifying: undefined,
  waiting: undefined,
  blocked: "var(--red-50)",
};

/** 관제 표의 작업 한 줄.
 *
 *  **제어 버튼이 없습니다** (2026-09-27). 예전엔 젯슨 대역으로 여기서 「임시
 *  문열림」「업무 종료」「확인 처리」를 눌렀는데, 게이트 기기 인증이 들어가면서
 *  현장 진행은 **키오스크가 맡는 것**으로 옮겼습니다. 관제는 보는 화면이고,
 *  문을 여닫는 건 문 앞에서 합니다. */
/** 작업 참여자 한 명이 지금 문의 어느 쪽에 있는지. 게이트 3D 시뮬레이션이
 *  사람을 어디에 세울지 정하는 데 씁니다.
 *
 *  - `out` 아직 검증 전  - `verified` 검증 통과, 문 앞  - `in` 안에서 작업 중
 *  - `blocked` 검증에서 막힘 */
export type CrewPosition = "out" | "verified" | "in" | "blocked";

export interface CrewMember {
  name: string;
  position: CrewPosition;
}

export interface SiteStatus {
  /** 표의 행 키. 같은 작업장에 승인 대기와 진행중이 동시에 있을 수 있어
   *  작업장+작업명 조합으로는 유일하지 않습니다. */
  id: string;
  siteId: string;
  site: string;
  /** 이 작업장의 게이트. 키오스크 화면으로 이어주는 링크에 씁니다. */
  gateId: string | null;
  state: SiteStatusState;
  elapsed: string;
  /** 예상 소요시간을 넘겼는지. 넘기면 경과를 orange-50 600 으로 표기합니다.
   *  작업 "예정 시각"과는 다른 값입니다 — 이쪽은 얼마나 걸리느냐입니다. */
  overtime: boolean;
  /** 경과 / 예상시간. 1 을 넘으면 초과입니다. 진행 막대에 씁니다. */
  progress: number | null;
  headcount: string;
  work: string;
  /** 참여 인원 이름. 진행중 작업만 있습니다. */
  members: string[];
  /** 참여 인원별 위치 (members 와 같은 순서). 진행중 작업만 있습니다.
   *  저장된 값이 아니라 세션의 검증·입장 기록에서 매번 계산합니다. */
  crew?: CrewMember[];
  requestId?: string;
  sessionId?: string;
  /** 예정 시각 대비 언제 시작했는지. 진입을 막지는 않고 기록만 남깁니다. */
  scheduleNote?: string;
  /** 승인됐지만 아직 시작 안 한 작업의 예정 시각 (HH:mm). */
  scheduledLabel?: string;
  /** 실제 시작 시각 (HH:mm). 세션이 생긴 것만 있습니다. */
  startedAtLabel?: string;
  /** 시작 시각 + 예상 소요시간 (HH:mm). 작업코드에 예상시간이 없으면 없습니다. */
  expectedEndLabel?: string;
}

/** 작업장 보드의 칸 하나. 관제 화면 맨 위에서 **작업장 7곳을 한눈에** 봅니다.
 *
 *  표만 있을 때는 "지금 어디가 비어 있고 어디가 바쁜지"를 알려면 행을 다 읽어야
 *  했습니다. 작업장은 고정된 7곳이라, 자리를 고정해 두면 위치만 보고도 압니다. */
export type SiteBoardState = "alert" | "working" | "waiting" | "idle";

export const SITE_BOARD_LABEL: Record<SiteBoardState, string> = {
  alert: "확인 필요",
  working: "작업중",
  waiting: "입장 대기",
  idle: "비어 있음",
};

export interface SiteBoardTile {
  siteId: string;
  siteName: string;
  gateId: string | null;
  state: SiteBoardState;
  /** 진행중 작업. 보통 0~1건이지만 한 작업장에 둘이 겹칠 수도 있습니다. */
  working: {
    sessionId: string;
    work: string;
    headcount: string;
    elapsed: string;
    progress: number | null;
    overtime: boolean;
  }[];
  /** 승인됐는데 아직 안 들어간 작업 수 (오늘). */
  waitingCount: number;
  /** 가장 빠른 대기 작업의 예정 시각. */
  nextLabel?: string;
  /** 이 작업장에 걸린 확인 필요 건수. */
  alertCount: number;
}

/** 작업장별 특이사항. 마이페이지가 "내가 쓴 것"이라면 이쪽은 "여기서 나온 것"입니다
 *  — 다음에 그 장소에 들어갈 사람이 읽으라고 모아둔 화면의 데이터입니다. */
export interface SiteNotes {
  siteId: string;
  siteName: string;
  notes: {
    id: string;
    note: string;
    authorName: string;
    authorRank: string;
    workCode: string;
    workTitle: string;
    /** 사람이 읽는 날짜 ("어제 15:07"). */
    when: string;
    /** 정렬용 ISO. 화면에 직접 쓰지 않습니다. */
    at: string;
  }[];
}

export interface Anomaly {
  /** 같은 종류의 이상 상황이 동시에 여러 건 뜰 수 있어 제목은 키가 못 됩니다.
   *  세션 id 를 그대로 씁니다. */
  id: string;
  kind: "warning" | "blocked";
  title: string;
  detail: string;
  siteId: string;
  siteName: string;
  /** 언제 생긴 일인지 (HH:mm). 차단은 시각이 중요합니다. */
  atLabel?: string;
  /** 누르면 갈 곳. 진행중 작업이면 세션 상세입니다. */
  sessionId?: string;
}
