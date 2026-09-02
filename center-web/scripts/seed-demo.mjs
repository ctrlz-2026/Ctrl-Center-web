/* A동 1층 라인2 시연용 작업.
 *
 *   node --env-file=.env.local scripts/seed-demo.mjs          만들기
 *   node --env-file=.env.local scripts/seed-demo.mjs --clear   지우기
 *
 * 관제 화면 한 곳에 **작업 대기 · 작업중 · 인증실패**를 3건씩 올려서, 스크롤
 * 없이 세 상태를 한 번에 보여주기 위한 데이터입니다.
 *
 * 두 가지를 일부러 이렇게 했습니다.
 *
 * 1. **시간이 지나도 안 없어집니다.** 진행중 세션은 원래 예상시간을 3시간 넘기면
 *    서버가 자동 종료합니다(lib/firebase/dashboard.ts). 시연 도중 행이 저절로
 *    사라지면 곤란하므로 `demo: true` 를 달아 그 규칙에서 뺐습니다.
 *
 * 2. **지우는 건 버튼으로만 됩니다.** 작업중은 「업무 종료」, 인증실패는
 *    「확인 처리」, 작업 대기는 「임시 문열림」으로 진행시킨 뒤 종료하면 내려갑니다.
 *    시간이 아니라 사람이 눌러야 없어진다는 것이 이 화면의 규칙입니다.
 *
 * 시각은 실행 시점 기준 상대값입니다. 고정 시각으로 박으면 며칠 뒤 "경과"가
 * 몇천 분으로 뜹니다 — 시연 전에 다시 돌리면 그럴듯한 시간이 됩니다.
 *
 * 주의: `scripts/seed.mjs` 는 자기 목록에 없는 세션·요청을 지웁니다.
 * seed 를 다시 돌렸다면 이 스크립트도 다시 돌려야 합니다. */

import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { employees, employeeCards } from "./seed-data.mjs";

const db = getFirestore(
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  }),
);

const SITE = "site-a1";
const GATE = "gate-a1";

/* 이 시연에 나오는 사람들. 기존 가상인물은 이미 다른 작업장 세션에 배정돼
   있어서 재사용하면 한 사람이 두 곳에서 동시에 작업 중으로 보입니다.
   정의는 seed-data.mjs 에 있고 여기서는 이 6명만 골라 넣습니다 —
   seed.mjs 전체를 돌리면 승인요청·특이사항까지 초기화되기 때문입니다. */
const DEMO_EMP_NOS = [
  "2015-0177", // 노경수 차장
  "2016-0208", // 서동현 주임 — 전기 자격 만료 (차단 시연)
  "2019-0733", // 문가영 주임
  "2020-0345", // 임하늘 사원
  "2021-0882", // 배시우 사원
  "2023-0491", // 오재민 사원
];

const now = Date.now();
/** 분 단위 상대 시각. 음수를 넣으면 미래입니다. */
const at = (minutesAgo) => new Date(now - minutesAgo * 60_000).toISOString();

/* ── 작업 대기 ──────────────────────────────────────────────────────────────
 * 승인은 났는데 아직 게이트 세션이 없는 상태입니다. 관제 표에 「승인됨」으로
 * 뜨고 「임시 문열림」 버튼이 붙습니다. 세션이 아니라 승인 요청이라서
 * 자동 종료와는 애초에 무관합니다. */
const requests = [
  {
    id: "req-demo-a1-1", requesterId: "2015-0177", workCode: "D", siteId: SITE,
    scheduledAt: at(-20), reason: "라인2 컨베이어 소음 점검",
    status: "approved", approverId: "202533690", decidedAt: at(35),
    rejectReason: null, createdAt: at(52), demo: true,
  },
  {
    id: "req-demo-a1-2", requesterId: "2019-0733", workCode: "B", siteId: SITE,
    scheduledAt: at(-45), reason: null,
    status: "approved", approverId: "202533690", decidedAt: at(18),
    rejectReason: null, createdAt: at(40), demo: true,
  },
  {
    id: "req-demo-a1-3", requesterId: "2021-0882", workCode: "C", siteId: SITE,
    // 예정 시각이 이미 지났는데 아직 안 들어갔습니다. 예정 시각은 진입을
    // 막지 않으므로, 늦게 시작해도 그대로 통과하고 기록만 남습니다.
    scheduledAt: at(15), reason: "3번 밸브 누수 확인 후 교체",
    status: "approved", approverId: "202533690", decidedAt: at(60),
    rejectReason: null, createdAt: at(95), demo: true,
  },
];

/* ── 작업중 ────────────────────────────────────────────────────────────────
 * 「업무 종료」 버튼으로만 내려갑니다. */
const working = [
  {
    id: "demo-a1-work-1", siteId: SITE, gateId: GATE, workCode: "B",
    state: "working", startedAt: at(12), endedAt: null,
    members: ["2015-0177", "2021-0882"], enteredCount: 2,
    scheduledAt: at(14), demo: true,
  },
  {
    id: "demo-a1-work-2", siteId: SITE, gateId: GATE, workCode: "C",
    // 예상 75분인데 88분째 — 「예상시간 초과」 경고가 같이 뜹니다.
    state: "working", startedAt: at(88), endedAt: null,
    members: ["2019-0733", "2020-0345"], enteredCount: 2,
    scheduledAt: at(85), demo: true,
  },
  {
    id: "demo-a1-work-3", siteId: SITE, gateId: GATE, workCode: "D",
    // 2명 필요한데 1명만 남았습니다 — 「작업 중 인원 미달」 경고가 뜹니다.
    // 문서대로 경고만 하고 작업을 끝내지는 않습니다.
    state: "working", startedAt: at(34), endedAt: null,
    members: ["2016-0208", "2023-0491"], enteredCount: 1,
    scheduledAt: at(36), demo: true,
  },
];

/* ── 인증실패 ──────────────────────────────────────────────────────────────
 * 「확인 처리」 버튼으로만 내려갑니다. 시간으로는 안 사라집니다 — 막힌 사람이
 * 있었다는 사실은 누군가 보고 조치해야 하는 것이기 때문입니다. */
const blocked = [
  {
    id: "demo-a1-block-1", siteId: SITE, gateId: GATE, workCode: "B",
    state: "blocked", startedAt: at(8), endedAt: null,
    members: ["2016-0208"], enteredCount: 0,
    blockedReason: "전기작업 안전 자격 만료", demo: true,
  },
  {
    id: "demo-a1-block-2", siteId: SITE, gateId: GATE, workCode: "D",
    state: "blocked", startedAt: at(21), endedAt: null,
    members: ["2020-0345"], enteredCount: 0,
    blockedReason: "안전모 미착용 (3회 재시도 후 차단)", demo: true,
  },
  {
    id: "demo-a1-block-3", siteId: SITE, gateId: GATE, workCode: "C",
    state: "blocked", startedAt: at(3), endedAt: null,
    members: ["2023-0491"], enteredCount: 0,
    blockedReason: "얼굴인식 불일치 (3회 재시도 후 차단)", demo: true,
  },
];

const sessions = [...working, ...blocked];

if (process.argv.includes("--clear")) {
  const batch = db.batch();
  for (const s of sessions) batch.delete(db.collection("gateSessions").doc(s.id));
  for (const r of requests) batch.delete(db.collection("approvalRequests").doc(r.id));

  /* 「임시 문열림」으로 생긴 세션도 같이 지웁니다. 그건 서버가 자동 ID 로 만들어서
     위의 고정 ID 목록에 안 걸립니다. 남겨두면 그 승인 요청은 "세션이 이미 있는"
     상태가 돼, 다시 심어도 「작업 대기」로 안 돌아옵니다. */
  const demoReqIds = requests.map((r) => r.id);
  const spawned = await db
    .collection("gateSessions")
    .where("approvalRequestId", "in", demoReqIds)
    .get();
  for (const d of spawned.docs) batch.delete(d.ref);
  // 임시 문열림으로 만들어진 출입 기록도 같이 치웁니다.
  const logs = await db
    .collection("accessLogs")
    .where("siteId", "==", SITE)
    .get();
  let removedLogs = 0;
  for (const l of logs.docs) {
    if (String(l.id).startsWith("demo-a1-")) {
      batch.delete(l.ref);
      removedLogs += 1;
    }
  }
  await batch.commit();
  console.log(
    `시연 데이터 삭제 — 세션 ${sessions.length + spawned.size}건 · 승인요청 ${requests.length}건 · 출입기록 ${removedLogs}건`,
  );
} else {
  const batch = db.batch();

  // 시연에 나오는 사람들. 이름이 표에 뜨려면 employees 에 있어야 합니다.
  for (const e of employees.filter((x) => DEMO_EMP_NOS.includes(x.empNo))) {
    batch.set(db.collection("employees").doc(e.empNo), e, { merge: true });
  }
  for (const c of employeeCards.filter((x) => DEMO_EMP_NOS.includes(x.empNo))) {
    batch.set(db.collection("employeeCards").doc(c.cardUid), c, { merge: true });
  }

  for (const s of sessions) {
    batch.set(db.collection("gateSessions").doc(s.id), s, { merge: true });
  }
  for (const r of requests) {
    batch.set(db.collection("approvalRequests").doc(r.id), r, { merge: true });
  }

  /* 진행중 세션의 개인별 출입 기록. 이게 없으면 작업 상세를 열었을 때
     "누가 언제 들어갔는지"가 비어 있습니다. 실제 태그·얼굴인식을 거치지
     않았으므로 판정값은 null 로 두고 manual 로 표시합니다 — 하지 않은 검증을
     통과했다고 적으면 통과율이 부풀려집니다. */
  for (const s of working) {
    for (const empNo of s.members) {
      batch.set(db.collection("accessLogs").doc(`${s.id}_${empNo}`), {
        sessionId: s.id, empNo, gateId: GATE, siteId: SITE,
        workCode: s.workCode, cardUid: `TEMP-${empNo}`,
        taggedAt: s.startedAt, faceMatched: null, faceScore: null,
        ppePassed: null, ppeAttempts: 0,
        enteredAt: s.startedAt, exitedAt: null,
        manual: true, demo: true,
      });
    }
  }
  await batch.commit();

  console.log(`A동 1층 라인2 시연 데이터 (${SITE})`);
  console.log(`  작업 대기  ${requests.length}건 — 임시 문열림으로 진행`);
  console.log(`  작업중     ${working.length}건 — 업무 종료로 내림`);
  console.log(`  인증실패   ${blocked.length}건 — 확인 처리로 내림`);
  console.log("");
  console.log("자동 종료 대상에서 빠져 있어 시간이 지나도 사라지지 않습니다.");
  console.log("지우려면: node --env-file=.env.local scripts/seed-demo.mjs --clear");
}
