import type { KioskStatus } from "./kiosk-types";

export function kioskGuidance(status: KioskStatus) {
  if (status.phase === "blocked") {
    const reason = status.blockedReason ?? "확인 조건을 충족하지 못했습니다.";
    const action = /얼굴/.test(reason)
      ? "태그한 사원증의 본인이 정면을 보고 다시 시도해 주세요."
      : /보호구|미착용/.test(reason)
        ? "필수 보호구를 착용하고 카메라에 보이도록 한 뒤 다시 시도해 주세요."
        : "작업 배정·자격·사원증 정보를 안전관리자에게 확인해 주세요.";
    return { title: "입장할 수 없습니다", action, completed: "통과 처리되지 않았습니다." };
  }
  if (status.phase === "working")
    return { title: "입장 확인 완료 · 작업을 시작하세요", action: "작업이 끝나고 모두 나온 뒤 아래 ‘작업 종료’를 눌러 주세요.", completed: "필요한 인원의 입장 정보가 모두 확인됐습니다." };
  if (status.phase === "closed")
    return { title: "작업 종료 완료", action: "다음 작업은 ‘작업 목록으로’를 눌러 새로 선택하세요.", completed: "이 작업의 입장 확인은 끝났습니다." };
  switch (status.step ?? "tagging") {
    case "face":
      return { title: "2단계 · 본인 얼굴을 확인합니다", action: "태그한 본인이 카메라 정면을 봐주세요. 얼굴 네모 안에 혼자 서고 잠시 움직이지 마세요.", completed: "사원증 확인 완료 · 지금은 다른 사람의 카드를 대지 마세요." };
    case "verifying":
      return { title: "3단계 · 보호구를 확인합니다", action: "아래 필수 보호구를 모두 착용하고 카메라에 보이도록 서 주세요.", completed: "얼굴 확인 완료! 이제 보호구를 확인합니다." };
    case "unlocking":
      return { title: "검증 완료 · 입장 안내를 따라 주세요", action: "한 명씩 입장하세요. 모든 인원의 입장이 확인되면 작업 중으로 바뀝니다.", completed: "얼굴·보호구 확인을 마쳤습니다. 카드를 다시 태그하지 마세요." };
    default:
      return { title: (status.verified ?? 0) > 0 ? "다음 작업자의 차례입니다" : "1단계 · 사원증을 태그하세요", action: "한 사람씩 리더기에 사원증을 대주세요. 인식되면 얼굴 확인으로 넘어갑니다.", completed: "진행 순서: 사원증 → 얼굴 → 보호구 → 입장" };
  }
}
