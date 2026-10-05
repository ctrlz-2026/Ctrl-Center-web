/* ────────────────────────────────────────────────────────────────────────────
 * 젯슨 ↔ 웹 계약 (단일 출처)
 *
 * 이 파일이 상하 님과 맞추는 계약서입니다. 여기 타입이 바뀌면 젯슨 쪽도 바뀝니다.
 * 반대로 여기 없는 필드는 서버가 무시합니다.
 *
 * 원칙: **젯슨은 "관찰"을 보고하고 "상태"를 주장하지 않습니다.**
 *   보냄  → "카드 UID 04A2B3C4를 09:04:12에 읽었다"
 *   안 보냄 → "인원 충족됐으니 문 열어"
 * 인원 충족·PPE 통과·해정 여부는 서버가 계산해서 응답으로 돌려주고,
 * 젯슨은 그걸 화면에 반영만 합니다. 양쪽 구현이 어긋나도 상태가 깨지지 않게
 * 하려는 것이며, 화면 문구도 서버가 내려줍니다(웹/키오스크 문안 통일).
 *
 * 얼굴인식·PPE 판정 자체는 전부 젯슨에서 합니다. 웹은 **결과만** 받습니다.
 * ──────────────────────────────────────────────────────────────────────────── */

/** 젯슨이 보내는 관찰 종류. */
export type GateEventKind =
  | "card_tag" // NFC 사원증 태그
  | "face_match" // 얼굴 1:1 매칭 결과 (판정은 젯슨이 함)
  | "ppe_check" // PPE 착용 판정 결과 (판정은 젯슨이 함)
  | "entry" // 1인 입장
  | "exit"; // 1인 퇴장

export interface CardTagPayload {
  card_uid: string;
}

export interface FaceMatchPayload {
  emp_no: string;
  /** 0~1. 임계값 판단은 젯슨이 하고 서버는 결과와 근거를 기록만 합니다. */
  score: number;
  matched: boolean;
  /** liveness 통과 여부. 미구현이면 생략 가능합니다. */
  live?: boolean;
}

export interface PpeItemResult {
  /** ppe_items 의 code. YOLO 클래스명과 1:1 입니다. */
  code: string;
  worn: boolean;
  confidence?: number;
}

export interface PpeCheckPayload {
  emp_no: string;
  /** 몇 번째 시도인지. 3회 실패 시 서버가 팀장 알림을 만듭니다. */
  attempt: number;
  items: PpeItemResult[];
}

export interface EntryExitPayload {
  emp_no: string;
}

/** 입장이 막힌 이유 (「출입 및 인원관리 로직」 §14 "입장 차단").
 *
 *  판정은 서버가 하고 젯슨은 응답의 `message` 를 띄우기만 합니다. 그래도
 *  코드를 같이 내려주는 이유는, 기기가 사유별로 다른 소리·색을 낼 수 있게
 *  하기 위해서입니다. */
export type EntryBlockReason =
  | "card_unknown" // 등록되지 않은 카드
  | "card_revoked" // 폐기된 카드
  | "employee_inactive" // 비활성화된 직원
  | "not_assigned" // 이 작업에 참여할 수 없는 직원
  | "already_in_other_work" // 다른 작업에 이미 IN 상태 (§9)
  | "qualification" // 자격·교육 미충족
  | "face" // 얼굴인식 실패
  | "ppe"; // PPE 미착용

export type GateEventPayload =
  | CardTagPayload
  | FaceMatchPayload
  | PpeCheckPayload
  | EntryExitPayload;

export interface GateEvent {
  /**
   * 중복 방지 키. **필수입니다.**
   * NFC 리더는 한 번 태그에 이벤트를 두세 번 쏘는 일이 흔하고,
   * 네트워크 복구 후 재전송도 중복을 만듭니다. 같은 키는 서버가 조용히 무시합니다.
   * 권장 형식: `{gate_id}-{unix_ms}-{seq}`
   */
  idempotency_key: string;
  kind: GateEventKind;
  /** 젯슨 기준 발생 시각 (ISO 8601, UTC). 서버는 수신 시각을 따로 남깁니다. */
  occurred_at: string;
  payload: GateEventPayload;
}

export interface GateEventsRequest {
  /**
   * 키오스크에서 사용자가 선택한 게이트. Jetson 한 대를 한 게이트에 고정하지
   * 않아도 되도록, 각 검증 묶음의 문맥을 명시합니다.
   */
  gate_id: string;
  /** 승인된 작업 선택 화면에서 넘어온 요청 ID. */
  approval_request_id: string;
  /** 배열로 보냅니다. 오프라인 복구 시 쌓인 이벤트를 한 번에 밀어올릴 수 있습니다. */
  events: GateEvent[];
}

/**
 * 키오스크에서 고른 작업 — 젯슨이 "지금 어느 작업의 검증인지" 아는 방법.
 *
 *   GET /api/gate/{gate_id}/context   (X-Gate-Key 필요)
 *
 * 키오스크에서 작업을 누르면 서버가 게이트별로 적어 둡니다. 젯슨은 이 값을
 * 읽어 검증을 시작하고, 이벤트를 보낼 때 `approval_request_id` 를 그대로
 * 돌려줍니다 (GateEventsRequest). 아무것도 안 골랐으면 null 입니다.
 * 문이 열리면(또는 자격 미달로 막히면) 선택은 비워집니다.
 */
export interface GateContext {
  gate_id: string;
  approval_request_id: string | null;
  work_code: string | null;
  required_headcount: number;
  required_ppe: BundlePpe[];
  selected_at: string | null;
}

/** 서버가 판정한 세션 상태. 젯슨은 이걸 그대로 화면에 반영합니다.
 *
 * `unlocking` 다음은 항상 `working` 입니다 — 팀 결정으로, 문이 열리면 곧
 * 작업 시작이고 "문은 열렸지만 아직 작업 전"이라는 중간 상태는 두지 않습니다
 * (docs/backend-design.md §7). 상태 계산 로직을 붙일 때 이 순서를 지켜주세요. */
export interface GateStateResponse {
  session_id: string;
  state:
    | "selecting"
    | "confirming"
    | "tagging"
    | "face"
    | "verifying"
    | "blocked"
    | "unlocking"
    | "working"
    | "closed";
  /** 인원은 **네 가지를 따로** 셉니다 (「출입 및 인원관리 로직」 §6).
   *
   *  하나로 합치면 "3명 찍혔는데 왜 문이 안 열리지"를 설명할 수 없습니다.
   *  태그한 사람과 검증을 통과한 사람과 안에 있는 사람은 다 다른 수입니다.
   *
   *  - `required` 작업에 필요한 최소 인원 (작업코드에서 옴)
   *  - `tagged`   NFC 를 찍은 **서로 다른** 작업자 수. 같은 사람이 세 번 찍어도 1
   *  - `verified` 자격·얼굴·PPE 를 **모두** 통과한 작업자 수
   *  - `entered`  지금 실제로 안에 있는 사람 수 (입장 후 퇴장하면 줄어듦)
   *
   *  문을 여는 기준은 `tagged` 가 아니라 **`verified >= required`** 입니다 (§7). */
  headcount: {
    required: number;
    tagged: number;
    verified: number;
    entered: number;
  };
  last_verification?: {
    emp_no: string;
    passed: boolean;
    failed_items: string[];
    attempt: number;
    /** 통과하지 못했다면 무엇 때문인지. 기기가 사유별로 다르게 안내할 수 있습니다. */
    block_reason?: EntryBlockReason;
  };
  /** 방금 태그가 **퇴장**으로 처리됐는지 (§4).
   *
   *  같은 NFC 태그가 상태에 따라 입장도 되고 퇴장도 되므로, 기기가 "들어갑니다"와
   *  "나갑니다" 중 무엇을 띄울지 알아야 합니다. 퇴장은 얼굴·PPE 를 다시 보지
   *  않고 기록만 남깁니다. */
  last_exit?: { emp_no: string };
  /** 작업 시작 후 현재 인원이 최소인원 아래로 떨어졌는지 (§11).
   *
   *  **이 값이 true 여도 서버는 작업을 끝내지 않습니다.** 경고만 올리고,
   *  현장을 확인하는 건 팀장·관리자 몫이라고 문서가 못박고 있습니다. */
  understaffed?: boolean;
  /** 문을 열어도 되는지. 젯슨은 이 값만 보고 해정 애니메이션을 재생합니다. */
  unlock: boolean;
  /** 화면에 띄울 문구. 젯슨에 하드코딩하지 않기 위해 서버가 내려줍니다. */
  message: string;
  /** 서버가 처리한 이벤트 수 / 중복이라 무시한 수. */
  accepted: number;
  duplicated: number;
}

/* ────────────────────────────────────────────────────────────────────────────
 * 일일 번들 — 네트워크가 끊겨도 현장이 돌아가게 하는 장치
 *
 * 2차 멘토링에서 받은 조언입니다. 지금 구조는 젯슨이 관찰을 보내고 **서버가
 * 판정**해 응답을 내려주는데, 그러면 인터넷이 끊긴 순간 문을 열 수 없습니다.
 * 멘토님 답은 "서버가 **내일 쓸 자료를 매일 미리 젯슨으로 옮겨놓으면** 끊겨도
 * 쓸 수 있다"였고, 그 자료 묶음이 이 번들입니다.
 *
 *   평소(온라인)  : 젯슨 관찰 → 서버 판정 → 응답대로 표시   (기존 그대로)
 *   끊겼을 때     : 받아둔 번들로 젯슨이 스스로 판정, 기록은 쌓아두었다가
 *                  복구되면 /api/gate/events 로 한 번에 올려보냄
 *
 * 온라인일 때는 **서버 판정이 항상 우선**입니다. 번들은 대비책이지 평소 경로가
 * 아닙니다 — 둘 다 판정하게 두면 어느 쪽이 맞는지 다투게 됩니다.
 *
 * 받는 곳: GET /api/gate/{gate_id}/bundle?date=YYYY-MM-DD   (X-Gate-Key 필요)
 * 바뀐 게 없으면 ETag 로 304 를 돌려주므로, 매일 받아도 낭비가 없습니다.
 * ──────────────────────────────────────────────────────────────────────────── */

/** 번들에 담기는 보호구. `yolo_class` 는 학습 클래스명과 1:1 입니다. */
export interface BundlePpe {
  code: string;
  name: string;
  yolo_class: string | null;
}

export interface BundleQualification {
  code: string;
  name: string;
}

/** 작업코드가 요구하는 기준. 젯슨이 오프라인에서 이 값으로 판정합니다. */
export interface BundleWorkCode {
  code: string;
  name: string;
  required_headcount: number;
  required_ppe: BundlePpe[];
  required_qualifications: BundleQualification[];
  estimated_minutes: number;
}

/** 그날 그 게이트에서 열릴 수 있는 작업 (= 승인이 끝난 것만). */
export interface BundleWork {
  request_id: string;
  work_code: string;
  scheduled_at: string | null;
  requester_emp_no: string;
  /** 팀장이 승인하며 남긴 전달사항. 키오스크 작업 카드에 그대로 띄웁니다. */
  note: string | null;
}

/**
 * 그 게이트에 들어올 수 있는 사람.
 *
 * **얼굴 사진·특징값은 담지 않습니다.** 생체정보를 웹 DB 에 두지 않는다는 원칙이
 * 그대로 적용됩니다 — 등록을 마쳤는지(`face_enrolled`)만 알려주고, 실제 템플릿은
 * 젯슨이 자기 안에 가지고 있습니다.
 */
export interface BundleWorker {
  emp_no: string;
  name: string;
  team: string;
  rank: string;
  /** 폐기되지 않은 사원증 UID. 재발급 중이면 여러 장일 수 있습니다. */
  card_uids: string[];
  qualifications: { code: string; name: string; expires_on: string }[];
  /** 배정된 작업코드. null 이면 전 작업 가능(별도 제한 없음)입니다. */
  allowed_work_codes: string[] | null;
  face_enrolled: boolean;
}

export interface GateBundle {
  /** 형식이 바뀌면 올립니다. 젯슨이 모르는 버전이면 받지 않게 하려는 값입니다. */
  bundle_version: number;
  gate_id: string;
  site_id: string;
  site_name: string;
  /** 이 번들이 쓰일 날짜 (YYYY-MM-DD, 한국 시각 기준). */
  valid_for: string;
  generated_at: string;
  /** 내용이 같으면 같은 값. 젯슨이 다시 받을지 판단하는 데 씁니다. */
  bundle_hash: string;
  works: BundleWork[];
  work_codes: BundleWorkCode[];
  workers: BundleWorker[];
}
