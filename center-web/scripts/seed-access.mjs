/* 출입 기록 생성.
 *
 * gateSessions 는 "작업" 단위, accessLogs 는 "사람" 단위입니다.
 * 작업 하나에 여러 명이 각자 태그하고 각자 들어가고 나오므로 분리해야 합니다.
 * 이게 있어야 대리 태그 추적, 입장 수 = 퇴장 수 대조, 개인별 검증 이력이 됩니다.
 *
 * gateEvents 는 젯슨이 보낸 **원시 관찰**을 그대로 쌓는 곳입니다.
 * accessLogs 는 그걸 사람 단위로 정리한 결과라, 둘 다 필요합니다 —
 * 정리된 결과가 이상하면 원시 로그로 되짚어야 하기 때문입니다. */

const ms = (iso, minutes) =>
  new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();

/** 세션 목록에서 개인별 출입 기록을 만듭니다. */
export function accessLogsFrom(sessions) {
  const logs = [];

  for (const s of sessions) {
    const closed = s.state === "closed";
    const blocked = s.state === "blocked";
    // 아직 아무도 안 들어간 단계
    const preEntry = ["tagging", "face", "verifying"].includes(s.state);

    s.members.forEach((empNo, i) => {
      // 태그는 순서대로 몇 초씩 차이나게 — 실제로도 한 명씩 찍습니다.
      const taggedAt = ms(s.startedAt, i * 0.5);

      // 차단된 세션은 얼굴인식까지 가지 못합니다 (자격 미달은 그 전에 걸림).
      const faceMatched = !blocked;

      // 1차 실패는 첫 번째 사람에게 몰아줍니다 — 세션 요약의 "안전벨트 1회 미착용
      // → 재검증 통과"와 앞뒤가 맞아야 하기 때문입니다.
      // 재검증으로 결국 통과했으므로 최종 결과는 통과이고, 흔적은 시도 횟수에 남습니다.
      const failedFirstTry = closed && !s.passedFirstTry && i === 0;
      const ppePassed = !blocked;
      const ppeAttempts = blocked ? 0 : failedFirstTry ? 2 : 1;

      logs.push({
        id: `${s.id}_${empNo}`,
        sessionId: s.id,
        empNo,
        gateId: s.gateId,
        siteId: s.siteId,
        workCode: s.workCode,
        cardUid: `TEMP-${empNo}`,
        taggedAt,
        faceMatched,
        faceScore: faceMatched ? Number((0.91 + i * 0.02).toFixed(2)) : null,
        ppePassed,
        ppeAttempts,
        enteredAt:
          blocked || preEntry ? null : ms(s.startedAt, 1 + i * 0.5),
        exitedAt: closed ? ms(s.startedAt, s.durationMinutes) : null,
      });
    });
  }

  return logs;
}

/** 원시 이벤트 로그. 젯슨이 보낸 관찰을 그대로 남긴 모양입니다. */
export function gateEventsFrom(logs) {
  const events = [];
  let seq = 0;

  for (const l of logs) {
    const push = (kind, occurredAt, payload) => {
      seq += 1;
      events.push({
        // 실제로는 젯슨이 만든 키를 그대로 씁니다. 중복 방지의 근거입니다.
        idempotencyKey: `${l.gateId}-${new Date(occurredAt).getTime()}-${seq}`,
        sessionId: l.sessionId,
        kind,
        payload,
        occurredAt,
        receivedAt: occurredAt,
      });
    };

    push("card_tag", l.taggedAt, { cardUid: l.cardUid });

    if (l.faceMatched) {
      push("face_match", ms(l.taggedAt, 0.2), {
        empNo: l.empNo,
        score: l.faceScore,
        matched: true,
      });
      push("ppe_check", ms(l.taggedAt, 0.5), {
        empNo: l.empNo,
        attempt: l.ppeAttempts,
        passed: l.ppePassed,
      });
    }

    if (l.enteredAt) push("entry", l.enteredAt, { empNo: l.empNo });
    if (l.exitedAt) push("exit", l.exitedAt, { empNo: l.empNo });
  }

  return events;
}
