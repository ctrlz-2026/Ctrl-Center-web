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
  /** 배열로 보냅니다. 오프라인 복구 시 쌓인 이벤트를 한 번에 밀어올릴 수 있습니다. */
  events: GateEvent[];
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
