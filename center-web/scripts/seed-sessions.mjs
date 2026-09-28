/* 게이트 세션 생성.
 *
 * 진행중인 세션은 **실행 시점 기준 상대 시각**으로 만듭니다.
 * 고정 시각으로 박아두면 며칠 뒤 관제 화면의 "경과"가 몇천 분이 됩니다.
 * 시연 전에 seed 나 reset 을 돌리면 다시 그럴듯한 시간이 됩니다.
 *
 * 끝난 세션(closed)이 곧 마이페이지의 "작업 이력"입니다. */

import { TEAM } from "./seed-data.mjs";

const iso = (minutesAgo) =>
  new Date(Date.now() - minutesAgo * 60_000).toISOString();

/** 지금 현장에서 돌아가고 있는 작업들.
 *
 *  **비어 있습니다** (2026-09-27). "오늘" 은 scripts/seed-scenario.mjs 가
 *  통째로 맡습니다 — 두 곳에서 진행중 작업을 만들면 한 사람이 두 작업장에
 *  동시에 들어가 있는 그림이 생깁니다. */
export function liveSessions() {
  return [];
}

/** 끝난 작업 = 이력. 최근 것부터 과거로. */
export function closedSessions() {
  const day = 60 * 24;
  return [
    { id: "ses-1", siteId: "site-b2", gateId: "gate-b2", workCode: "A",
      startedAt: iso(day * 1 + 300), durationMinutes: 43,
      members: [TEAM.kim, TEAM.jeong],
      passedFirstTry: false, verification: "안전벨트 1회 미착용 → 재검증 통과" },

    { id: "ses-2", siteId: "site-a1", gateId: "gate-a1", workCode: "C",
      startedAt: iso(day * 1 + 60), durationMinutes: 72,
      members: [TEAM.kim, "2023-0128", "2019-0417"],
      passedFirstTry: true, verification: "전 항목 1차 통과" },

    { id: "ses-3", siteId: "site-a1", gateId: "gate-a1", workCode: "D",
      startedAt: iso(day * 2 + 180), durationMinutes: 28,
      members: [TEAM.jeong, "2022-0703"],
      passedFirstTry: true, verification: "전 항목 1차 통과" },

    { id: "ses-4", siteId: "site-d5", gateId: "gate-d5", workCode: "B",
      startedAt: iso(day * 3 + 420), durationMinutes: 19,
      members: [TEAM.jeong],
      passedFirstTry: true, verification: "전 항목 1차 통과" },

    { id: "ses-5", siteId: "site-f0", gateId: "gate-f0", workCode: "F",
      startedAt: iso(day * 3 + 120), durationMinutes: 51,
      members: ["2013-0055", "2014-0132"],
      passedFirstTry: true, verification: "전 항목 1차 통과" },

    { id: "ses-6", siteId: "site-b2", gateId: "gate-b2", workCode: "C",
      startedAt: iso(day * 4 + 240), durationMinutes: 64,
      members: [TEAM.kim, TEAM.park],
      passedFirstTry: false, verification: "안전모 1회 미착용 → 재검증 통과" },

    { id: "ses-7", siteId: "site-e1", gateId: "gate-e1", workCode: "G",
      startedAt: iso(day * 4 + 90), durationMinutes: 38,
      members: ["2014-0132", "2021-0619"],
      passedFirstTry: true, verification: "전 항목 1차 통과" },

    { id: "ses-8", siteId: "site-a3", gateId: "gate-a3", workCode: "H",
      startedAt: iso(day * 5 + 300), durationMinutes: 33,
      members: ["2017-0264", "2018-0511"],
      passedFirstTry: true, verification: "전 항목 1차 통과" },

    { id: "ses-9", siteId: "site-b2", gateId: "gate-b2", workCode: "J",
      startedAt: iso(day * 6 + 200), durationMinutes: 68,
      members: ["2013-0055", TEAM.kim],
      passedFirstTry: false, verification: "안전벨트 2회 미착용 → 재검증 통과" },

    { id: "ses-10", siteId: "site-a1", gateId: "gate-a1", workCode: "D",
      startedAt: iso(day * 7 + 150), durationMinutes: 55,
      members: [TEAM.jeong, "2023-0128"],
      passedFirstTry: true, verification: "전 항목 1차 통과" },
  ].map((s) => ({
    ...s,
    state: "closed",
    endedAt: new Date(
      new Date(s.startedAt).getTime() + s.durationMinutes * 60_000,
    ).toISOString(),
    enteredCount: s.members.length,
  }));
}
