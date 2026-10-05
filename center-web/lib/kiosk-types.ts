/* 키오스크 화면 ↔ 웹 서버 사이의 모양. 브라우저에서도 쓰므로 server-only 가
 * 아닙니다.
 *
 * 젯슨 ↔ 웹 계약(lib/gate-contract.ts)과는 **다른 파일**입니다. 그쪽은 기기가
 * 관찰을 보내는 경로이고, 이쪽은 벽에 붙은 화면이 "지금 어떻게 됐나"를 묻는
 * 경로입니다. 상하 님 쪽 키오스크 상태 조회가 들어오면 이 파일과 합칩니다. */

/** 키오스크가 보는 이 작업의 현재 단계.
 *  - `ready`   아직 문이 안 열림. 사원증 태그를 기다립니다
 *  - `blocked` 마지막 시도가 검증에서 막힘. 다시 시도할 수 있습니다
 *  - `working` 문이 열려 작업 중
 *  - `closed`  작업이 끝남 */
export type KioskPhase = "ready" | "blocked" | "working" | "closed";

export interface KioskStatus {
  phase: KioskPhase;
  sessionId: string | null;
  required: number;
  entered: number;
  members: string[];
  /** HH:mm */
  startedAtLabel?: string;
  expectedEndLabel?: string;
  elapsed?: string;
  overtime?: boolean;
  /** 끝난 작업의 소요시간 ("41분") */
  durationLabel?: string;
  blockedReason?: string;
  /** 막힌 시각 (HH:mm). 같은 화면에서 "방금 막힌 것"인지 구분하는 데 씁니다. */
  blockedAtLabel?: string;
  /** 서버가 이 게이트에서 지금 이 작업을 "선택된 작업"으로 들고 있는지.
   *  젯슨은 이 선택을 보고 어느 작업의 검증인지 압니다. */
  selected: boolean;

  /* ── 아래는 젯슨이 검증을 진행할 때만 채워집니다 ─────────────────────── */

  /** 문 앞 검증이 어디까지 왔는지. `phase` 가 "ready" 일 때의 세부 단계입니다.
   *  - `tagging`   사원증을 기다림
   *  - `face`      얼굴 확인 중
   *  - `verifying` 보호구 확인 중
   *  - `unlocking` 검증 인원이 차서 문이 열림 — 들어가면 됩니다 */
  step?: "tagging" | "face" | "verifying" | "unlocking";
  /** 서버가 정한 안내 문구. 기기와 화면이 같은 말을 하게 하려고 서버가 내려줍니다. */
  message?: string;
  /** 사원증을 찍은 사람 수 / 검증을 통과한 사람 수. */
  tagged?: number;
  verified?: number;
  /** 방금 일어난 일. `at` 이 바뀌면 화면이 소리를 냅니다. */
  signal?: { kind: KioskSignal; at: string };
}

/** 키오스크가 소리로 알리는 일들. 서버(app/api/gate/events)가 정합니다. */
export type KioskSignal =
  | "card_ok" // 사원증 인식
  | "face_ok" // 얼굴 일치
  | "face_fail" // 얼굴 불일치 — 다시 시도
  | "ppe_ok" // 보호구 통과 (아직 인원이 더 필요)
  | "ppe_fail" // 보호구 미착용 — 다시 시도
  | "unlock" // 검증 인원 충족 — 문 열림
  | "entry" // 입장
  | "exit" // 퇴장
  | "blocked"; // 입장 차단
