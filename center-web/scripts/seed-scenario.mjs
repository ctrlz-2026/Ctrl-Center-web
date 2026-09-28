/* 오늘 하루 시나리오 — 가상의 공장 하루를 "지금" 기준으로 깝니다.
 *
 *   npm run scenario            오늘 시나리오 깔기 (전에 깔린 것은 치우고)
 *   npm run scenario:clear      치우기만
 *
 * 예전 시연 데이터(seed-demo.mjs)는 한 작업장에 세 상태를 3건씩 몰아넣은
 * "보여주기용 그림"이었습니다. 그러다 보니 한 작업장에 같은 작업이 동시에
 * 여러 번 돌고, 이상 상황이 열 개 넘게 뜨고, 며칠 지나면 "331시간째 진행중"이
 * 남았습니다. 실제 공장처럼 보이지 않았습니다.
 *
 * 이 시나리오는 반대로 **규칙을 전부 지키는 하루**입니다.
 *   - 작업 내용·인원·보호구·자격은 「작업 기준 설계」(지윤 님) 표 그대로
 *   - 참여자는 그 작업의 자격이 실제로 유효한 사람만, 한 사람은 한 곳에만
 *   - 시각은 실행 시점 기준 상대값 (시연 전에 한 번 돌리면 그럴듯한 시간)
 *
 * 그 안에서 저절로 생기는 "확인할 일"은 두 건뿐입니다.
 *   - A동: 전기 자격이 만료된 서동현 님이 문 앞에서 막힘 (서버의 실제 자격 판정)
 *   - D동: 천장 조명기구 교체가 예상 30분을 조금 넘김
 *
 *   오전 (끝남)   A3 공조기 벨트 · F0 펌프 점검 · B2 사다리 점검(김병오·정천호)
 *   지금 (작업중) A1 컨베이어 · D5 조명 교체(초과) · C0 밀폐공간 정비(3명)
 *   입장 대기     B2 배관 밸브 · F0 펌프 점검(정천호) · A1 조명 교체(서동현, 막혔던 것)
 *   결재 대기     D5 사다리 점검 · C0 밀폐공간(박상하 — 자격 만료) · A3 공조기 벨트
 *
 * 키오스크(/kiosk)에서 입장 대기 작업을 골라 시연 모드로 문을 열고 닫으면
 * 관제 화면이 실시간으로 따라옵니다.
 *
 * 치우는 범위: 시나리오 문서(demo) · 옛 시드의 진행중 세션(live-*) · 옛 시드
 * 결재 대기(req-seed-*) · 끝나지 않은 모든 세션 · 키오스크 선택. 지난 작업
 * 이력(ses-*)과 특이사항은 건드리지 않습니다. */

import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { TEAM, employeeCards, employees } from "./seed-data.mjs";
import { accessLogsFrom } from "./seed-access.mjs";

const db = getFirestore(
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  }),
);

const now = Date.now();
/** 분 단위 상대 시각. 음수를 넣으면 미래입니다. */
const at = (minutesAgo) => new Date(now - minutesAgo * 60_000).toISOString();
const gateOf = (siteId) => `gate-${siteId.replace("site-", "")}`;
const LEADER = TEAM.kim; // 결재권자

// ── 승인 요청 ───────────────────────────────────────────────────────────────
/** [id, 작업장, 코드, 요청자, 예정(분 전), 상태, 신청(분 전), 결재(분 전), 사유, 전달사항] */
const REQUESTS = [
  // 오전에 끝난 작업들의 요청
  ["req-demo-done-1", "site-a3", "H", "2017-0264", 240, "approved", 300, 270, "공조기 벨트 마모 — 정기 교체", null],
  ["req-demo-done-2", "site-f0", "F", "2013-0055", 210, "approved", 280, 250, null, null],
  ["req-demo-done-3", "site-b2", "A", TEAM.jeong, 175, "approved", 260, 230,
    "정기 점검 주기 도래로 사다리 상단 고정부 확인", "상단 고정부 볼트 상태 꼭 봐주세요"],
  // 지금 작업 중인 것들의 요청
  ["req-demo-work-1", "site-a1", "D", "2015-0177", 40, "approved", 120, 95, "라인2 컨베이어 소음 점검", null],
  ["req-demo-work-2", "site-d5", "B", "2019-0733", 45, "approved", 110, 80, null, "옥상 출입문 도어클로저 고장 — 문 받쳐두고 작업"],
  ["req-demo-work-3", "site-c0", "E", "2014-0132", 30, "approved", 150, 60,
    "배수조 펌프 흡입구 정비", "산소농도 측정 후 입장, 감시인은 입구에서 대기"],
  // 입장 대기 (승인됨, 아직 안 들어감)
  ["req-demo-wait-1", "site-b2", "C", "2022-0703", -25, "approved", 70, 35,
    "3번 밸브 누수 확인 후 교체", "상류 차단밸브 잠금 확인 후 작업 시작하세요"],
  ["req-demo-wait-2", "site-f0", "F", TEAM.jeong, -80, "approved", 50, 20, "펌프 2호기 진동 재확인", null],
  // 서동현 님 — 승인은 났지만 전기 자격이 만료돼 문 앞에서 막혔습니다
  ["req-demo-wait-3", "site-a1", "B", "2016-0208", 55, "approved", 130, 100, "라인2 조명 2개 교체", null],
  // 결재 대기
  ["req-demo-pend-1", "site-d5", "A", "2023-0491", -150, "pending", 15, null, "옥상 점검 사다리 고정 확인", null],
  ["req-demo-pend-2", "site-c0", "E", TEAM.park, -180, "pending", 32, null, null, null],
  ["req-demo-pend-3", "site-a3", "H", "2020-0345", -120, "pending", 8, null, "2호기 벨트 소음", null],
];

const requests = REQUESTS.map(
  ([id, siteId, workCode, requesterId, schedAgo, status, createdAgo, decidedAgo, reason, note]) => ({
    id,
    requesterId,
    workCode,
    siteId,
    scheduledAt: at(schedAgo),
    reason,
    status,
    approverId: status === "approved" ? LEADER : null,
    // 셀프 승인은 기록에 남습니다 (types.ts canRequestWork 참고)
    ...(status === "approved" && requesterId === LEADER ? { selfApproved: true } : {}),
    decidedAt: decidedAgo === null ? null : at(decidedAgo),
    rejectReason: null,
    ...(note ? { approveNote: note } : {}),
    createdAt: at(createdAgo),
    demo: true,
  }),
);

// ── 게이트 세션 ─────────────────────────────────────────────────────────────
const closedToday = [
  { id: "demo-done-1", req: "req-demo-done-1", siteId: "site-a3", workCode: "H",
    started: 235, minutes: 33, members: ["2017-0264", "2018-0511"],
    passedFirstTry: true, verification: "전 항목 1차 통과" },
  { id: "demo-done-2", req: "req-demo-done-2", siteId: "site-f0", workCode: "F",
    started: 205, minutes: 48, members: ["2013-0055", "2021-0619"],
    passedFirstTry: true, verification: "전 항목 1차 통과" },
  { id: "demo-done-3", req: "req-demo-done-3", siteId: "site-b2", workCode: "A",
    started: 170, minutes: 41, members: [TEAM.jeong, TEAM.kim],
    passedFirstTry: false, verification: "안전대 1회 미착용 → 재검증 통과" },
].map((s) => ({
  id: s.id,
  siteId: s.siteId,
  gateId: gateOf(s.siteId),
  workCode: s.workCode,
  approvalRequestId: s.req,
  scheduledAt: requests.find((r) => r.id === s.req).scheduledAt,
  state: "closed",
  startedAt: at(s.started),
  endedAt: at(s.started - s.minutes),
  durationMinutes: s.minutes,
  members: s.members,
  enteredCount: 0,
  passedFirstTry: s.passedFirstTry,
  verification: s.verification,
  demo: true,
}));

const working = [
  // 예상 60분 중 38분째
  { id: "demo-work-1", req: "req-demo-work-1", siteId: "site-a1", workCode: "D",
    started: 38, members: ["2015-0177", "2021-0882"] },
  // 예상 30분인데 41분째 — "예상시간 초과" 경고 한 건
  { id: "demo-work-2", req: "req-demo-work-2", siteId: "site-d5", workCode: "B",
    started: 41, members: ["2019-0733", "2018-0511"] },
  // 밀폐공간: 작업자 2 + 감시인 1 = 3명, 셋 다 밀폐공간 특별교육 유효
  { id: "demo-work-3", req: "req-demo-work-3", siteId: "site-c0", workCode: "E",
    started: 25, members: ["2014-0132", "2013-0055", "2023-0128"] },
].map((s) => ({
  id: s.id,
  siteId: s.siteId,
  gateId: gateOf(s.siteId),
  workCode: s.workCode,
  approvalRequestId: s.req,
  scheduledAt: requests.find((r) => r.id === s.req).scheduledAt,
  state: "working",
  startedAt: at(s.started),
  endedAt: null,
  members: s.members,
  enteredCount: s.members.length,
  passedFirstTry: true,
  verification: "전 항목 1차 통과",
  demo: true,
}));

const blocked = [
  {
    id: "demo-block-1",
    siteId: "site-a1",
    gateId: "gate-a1",
    workCode: "B",
    approvalRequestId: "req-demo-wait-3",
    scheduledAt: requests.find((r) => r.id === "req-demo-wait-3").scheduledAt,
    state: "blocked",
    startedAt: at(52),
    endedAt: null,
    members: ["2016-0208"],
    enteredCount: 0,
    blockedReason: "전기작업 유자격 만료",
    demo: true,
  },
];

const sessions = [...closedToday, ...working, ...blocked];

// ── 치우기 ──────────────────────────────────────────────────────────────────
async function clear() {
  const [sessSnap, reqSnap, ctxSnap] = await Promise.all([
    db.collection("gateSessions").get(),
    db.collection("approvalRequests").get(),
    db.collection("kioskContexts").get(),
  ]);

  // 끝나지 않은 세션은 전부 시나리오가 다시 정합니다. 끝난 이력은 시나리오 것만.
  const goneSessions = sessSnap.docs.filter((d) => {
    const s = d.data();
    return s.demo === true || d.id.startsWith("live-") || s.state !== "closed";
  });
  const goneIds = new Set(goneSessions.map((d) => d.id));
  const goneRequests = reqSnap.docs.filter(
    (d) => d.data().demo === true || d.id.startsWith("req-seed-"),
  );

  const [logSnap, noteSnap] = await Promise.all([
    db.collection("accessLogs").get(),
    db.collection("workNotes").get(),
  ]);
  const goneLogs = logSnap.docs.filter((d) => goneIds.has(String(d.data().sessionId)));
  const goneNotes = noteSnap.docs.filter((d) => goneIds.has(String(d.data().sessionId)));

  const refs = [
    ...goneSessions,
    ...goneRequests,
    ...goneLogs,
    ...goneNotes,
    ...ctxSnap.docs,
  ].map((d) => d.ref);
  // 배치는 500건 제한이 있어 나눠서 지웁니다.
  for (let i = 0; i < refs.length; i += 400) {
    const batch = db.batch();
    for (const ref of refs.slice(i, i + 400)) batch.delete(ref);
    await batch.commit();
  }
  console.log(
    `치움 — 세션 ${goneSessions.length} · 요청 ${goneRequests.length} · 출입기록 ${goneLogs.length} · 특이사항 ${goneNotes.length} · 키오스크 선택 ${ctxSnap.size}`,
  );
}

await clear();

if (!process.argv.includes("--clear")) {
  const batch = db.batch();

  // 시나리오에 나오는 사람들 — 자격이 바뀌었을 수 있어 최신 정의로 덮습니다.
  const people = new Set([
    ...requests.map((r) => r.requesterId),
    ...sessions.flatMap((s) => s.members),
  ]);
  for (const e of employees.filter((x) => people.has(x.empNo))) {
    batch.set(db.collection("employees").doc(e.empNo), e, { merge: true });
  }
  for (const c of employeeCards.filter((x) => people.has(x.empNo))) {
    batch.set(db.collection("employeeCards").doc(c.cardUid), c, { merge: true });
  }
  for (const r of requests) batch.set(db.collection("approvalRequests").doc(r.id), r);
  for (const s of sessions) batch.set(db.collection("gateSessions").doc(s.id), s);

  // 사람 단위 출입 기록 (seed.mjs 와 같은 규칙으로 만듭니다)
  const logs = accessLogsFrom(
    // accessLogsFrom 은 끝난 세션의 퇴장 시각을 durationMinutes 로 계산합니다
    sessions.map((s) => ({ ...s, durationMinutes: s.durationMinutes ?? 0 })),
  );
  for (const l of logs) {
    batch.set(db.collection("accessLogs").doc(l.id), { ...l, demo: true });
  }
  await batch.commit();

  console.log("");
  console.log("오늘 시나리오를 깔았어요.");
  console.log(`  끝난 작업   ${closedToday.length}건`);
  console.log(`  작업 중     ${working.length}건 (현장 ${working.reduce((n, s) => n + s.members.length, 0)}명)`);
  console.log(`  입장 대기   ${requests.filter((r) => r.id.startsWith("req-demo-wait")).length}건`);
  console.log(`  결재 대기   ${requests.filter((r) => r.status === "pending").length}건`);
  console.log(`  입장 차단   ${blocked.length}건`);
}
