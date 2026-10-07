import type { KioskStatus } from "./kiosk-types";

/** Use existing status data only; no additional network or DB calls. */
export function nextPersonNotice(status: KioskStatus) {
  const verified = status.verified ?? 0;
  if (status.phase !== "ready" || (status.step ?? "tagging") !== "tagging" ||
      verified <= 0 || verified >= status.required) return null;
  return {
    title: "얼굴·보호구 확인 완료!",
    instruction: "다음 작업자는 사원증을 태그해 주세요.",
    progress: `검증 통과 ${verified}/${status.required}명 · 추가 ${status.required - verified}명 확인이 필요합니다.`,
  };
}
