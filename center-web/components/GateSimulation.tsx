import styles from "./GateSimulation.module.css";

/* ────────────────────────────────────────────────────────────────────────────
 * 게이트 시뮬레이션 자리 (천호 님 담당)
 *
 * 멘토링에서 "실제 문 대신 화면으로 열림·닫힘을 보여주는 것도 좋다"는 답을
 * 받았고, 그 화면은 천호 님이 만듭니다. 이 파일은 **끼울 자리와 넘겨줄 데이터**
 * 만 정해 둔 것입니다.
 *
 * 붙이는 방법
 *   1. 이 파일의 GateSimulation 본문을 천호 님 컴포넌트로 바꿉니다.
 *      (다른 파일로 만들었다면 여기서 import 해서 그대로 렌더해도 됩니다)
 *   2. 아래 GateSimulationProps 는 **바꾸지 않습니다.** 관제의 세션 상세가 이
 *      모양으로 값을 넘깁니다. 더 필요한 값이 있으면 필드를 추가만 합니다.
 *   3. 값은 관제 실시간 스트림(SSE)에서 오므로, 키오스크에서 문이 열리거나
 *      작업이 끝나면 이 컴포넌트가 새 props 로 다시 그려집니다. 폴링을 따로
 *      할 필요가 없습니다.
 *
 * 상태 흐름 (lib/gate-contract.ts 와 같은 순서)
 *   tagging → face → verifying → unlocking → working → closed
 *   문 열림은 곧 작업 시작입니다. unlocking 은 해정 애니메이션용 짧은 상태입니다.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface GateSimulationProps {
  /** 관제 화면 상태. "waiting"(태그 대기) · "verifying" · "unlocked" · "working" */
  state: "waiting" | "verifying" | "unlocked" | "working" | "approved" | "blocked";
  siteName: string;
  /** "D 컨베이어 벨트 점검" */
  work: string;
  /** 작업에 필요한 최소 인원 */
  required: number;
  /** 지금 안에 들어가 있는 인원 */
  entered: number;
  /** 참여자 이름 (입장 순) */
  members: string[];
  /** 경과 표시 ("38분") */
  elapsed: string;
  /** 경과 / 예상시간. 1 을 넘으면 초과. 예상시간이 없으면 null */
  progress: number | null;
}

export function GateSimulation(props: GateSimulationProps) {
  return (
    <div className={styles.placeholder}>
      <span className={styles.title}>🚧 준비 중인 자리</span>
      <p className={styles.body}>
        문이 열리면 작업자가 한 명씩 들어가 작업하는 모습을 여기서 화면으로
        보여줄 예정이에요 (천호 님 담당). 라우팅과 실시간 데이터 연결은 끝나
        있어서, 화면만 붙이면 아래 값이 그대로 들어갑니다.
      </p>
      {/* 지금 이 자리로 들어오고 있는 값. 붙일 때 확인용으로 남겨 둡니다. */}
      <dl className={styles.props}>
        <dt>state</dt>
        <dd>{props.state}</dd>
        <dt>인원</dt>
        <dd>
          {props.entered} / {props.required}명
        </dd>
        <dt>참여자</dt>
        <dd>{props.members.join(", ") || "—"}</dd>
        <dt>경과</dt>
        <dd>
          {props.elapsed}
          {props.progress !== null ? ` (${Math.round(props.progress * 100)}%)` : ""}
        </dd>
      </dl>
    </div>
  );
}
