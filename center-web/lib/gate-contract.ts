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
  headcount: { tagged: number; entered: number; required: number };
  last_verification?: {
    emp_no: string;
    passed: boolean;
    failed_items: string[];
    attempt: number;
  };
  /** 문을 열어도 되는지. 젯슨은 이 값만 보고 해정 애니메이션을 재생합니다. */
  unlock: boolean;
  /** 화면에 띄울 문구. 젯슨에 하드코딩하지 않기 위해 서버가 내려줍니다. */
  message: string;
  /** 서버가 처리한 이벤트 수 / 중복이라 무시한 수. */
  accepted: number;
  duplicated: number;
}
