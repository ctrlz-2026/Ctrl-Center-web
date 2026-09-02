/* Firestore 컬렉션 생성 + 시드 + Auth 계정 발급.
 *
 *   node --env-file=.env.local scripts/seed.mjs
 *
 * 여러 번 돌려도 안전합니다. 진행중 세션은 실행 시점 기준으로 다시 만들어지므로
 * 시연 직전에 한 번 돌리면 관제 화면의 경과 시간이 그럴듯해집니다.
 *
 * 게이트 이벤트·검증 로그(gateEvents, verifications)는 젯슨이 만들 데이터라
 * 여기서 넣지 않습니다. */
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import {
  TEAM,
  employeeCards,
  employees,
  gates,
  ppeItems,
  qualifications,
  sites,
  workCodes,
} from "./seed-data.mjs";
import { closedSessions, liveSessions } from "./seed-sessions.mjs";
import { accessLogsFrom, gateEventsFrom } from "./seed-access.mjs";
import { workNotes } from "./seed-notes.mjs";

const app = initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  }),
});
const db = getFirestore(app);
const auth = getAuth(app);

const emailOf = (empNo) => `${empNo}@center.local`;

/** 초기 비밀번호는 **사번 뒤에 1234**. 계정을 나눠줄 때 따로 안내할 게 없고,
 *  사번만 알면 첫 로그인이 되기 때문입니다.
 *  회원가입·비밀번호 변경 기능이 붙으면 이 규칙은 "초기 발급값"으로만 남습니다. */
const initialPassword = (empNo) => `${empNo}1234`;
const now = Date.now();
const at = (minutesAgo) => new Date(now - minutesAgo * 60_000).toISOString();

/* 승인 대기 요청. 승인자는 팀장(김병오)이므로 요청자에서 제외합니다 —
 * 본인이 올린 요청은 본인이 승인할 수 없기 때문입니다. */
const approvalRequests = [
  {
    id: "req-seed-1", requesterId: TEAM.jeong, workCode: "A", siteId: "site-b2",
    scheduledAt: at(-60),
    reason: "정기 점검 주기 도래로 사다리 상단 고정부 확인이 필요합니다",
    status: "pending", approverId: null, decidedAt: null, rejectReason: null,
    createdAt: at(28),
  },
  {
    id: "req-seed-2", requesterId: TEAM.park, workCode: "E", siteId: "site-c0",
    scheduledAt: at(-120), reason: null,
    status: "pending", approverId: null, decidedAt: null, rejectReason: null,
    createdAt: at(46),
  },
  {
    id: "req-seed-3", requesterId: "2017-0264", workCode: "J", siteId: "site-b2",
    scheduledAt: at(-180), reason: "천장크레인 와이어 정기 점검",
    status: "pending", approverId: null, decidedAt: null, rejectReason: null,
    createdAt: at(74),
  },
  {
    id: "req-seed-4", requesterId: "2022-0703", workCode: "B", siteId: "site-d5",
    scheduledAt: at(-45), reason: null,
    status: "pending", approverId: null, decidedAt: null, rejectReason: null,
    createdAt: at(12),
  },
];

async function seedCollection(name, docs, idKey) {
  const batch = db.batch();
  for (const doc of docs) {
    batch.set(db.collection(name).doc(String(doc[idKey])), doc, { merge: true });
  }
  await batch.commit();
  console.log(`  ${name.padEnd(18)} ${docs.length}건`);
}

/* 시연용 문서(scripts/seed-demo.mjs)는 정리 대상에서 뺍니다. 여기서 지우면
   seed 를 돌릴 때마다 A동 1층 라인2 시연 데이터가 날아가 매번 다시 심어야
   합니다. 지우는 건 seed-demo.mjs --clear 로 합니다. */
const isDemoDoc = (id) => id.startsWith("demo-") || id.startsWith("req-demo-");

/** 시드에 없는 문서를 지웁니다.
 *  사람이 바뀌었는데 옛 문서가 남으면 관제 화면에 유령이 뜹니다. */
async function pruneCollection(name, keepIds) {
  const snap = await db.collection(name).get();
  const stale = snap.docs.filter((d) => !keepIds.has(d.id) && !isDemoDoc(d.id));
  if (stale.length === 0) return;
  const batch = db.batch();
  for (const d of stale) batch.delete(d.ref);
  await batch.commit();
  console.log(`  ${name.padEnd(18)} 옛 문서 ${stale.length}건 삭제`);
}

const sessions = [...liveSessions(), ...closedSessions()];
const accessLogs = accessLogsFrom(sessions);
const gateEvents = gateEventsFrom(accessLogs);
const notes = workNotes();

console.log("Firestore 시드");
await seedCollection("ppeItems", ppeItems, "code");
await seedCollection("qualifications", qualifications, "code");
await seedCollection("workCodes", workCodes, "code");
await seedCollection("sites", sites, "id");
await seedCollection("gates", gates, "id");
await seedCollection("employees", employees, "empNo");
await seedCollection("employeeCards", employeeCards, "cardUid");
await seedCollection("gateSessions", sessions, "id");
await seedCollection("approvalRequests", approvalRequests, "id");
await seedCollection("accessLogs", accessLogs, "id");
await seedCollection("gateEvents", gateEvents, "idempotencyKey");
await seedCollection("workNotes", notes, "id");

console.log("\n정리");
// 작업코드도 정리 대상입니다. 코드를 바꾸면(A-3 → A) 옛 문서가 그대로 남아
// 작업 신청 화면에 같은 작업이 두 번 뜹니다.
await pruneCollection("workCodes", new Set(workCodes.map((w) => w.code)));
await pruneCollection("employees", new Set(employees.map((e) => e.empNo)));
await pruneCollection("employeeCards", new Set(employeeCards.map((c) => c.cardUid)));
await pruneCollection("gateSessions", new Set(sessions.map((s) => s.id)));
await pruneCollection("sites", new Set(sites.map((s) => s.id)));
await pruneCollection("gates", new Set(gates.map((g) => g.id)));
await pruneCollection("approvalRequests", new Set(approvalRequests.map((r) => r.id)));
await pruneCollection("accessLogs", new Set(accessLogs.map((l) => l.id)));
await pruneCollection("gateEvents", new Set(gateEvents.map((e) => e.idempotencyKey)));
await pruneCollection("workNotes", new Set(notes.map((n) => n.id)));

console.log("\nAuth 계정");
const loginable = employees.filter((e) => e.login);
for (const e of loginable) {
  const email = emailOf(e.empNo);
  const password = initialPassword(e.empNo);
  let user;
  try {
    user = await auth.getUserByEmail(email);
    await auth.updateUser(user.uid, { password, displayName: e.name });
  } catch {
    user = await auth.createUser({ email, password, displayName: e.name });
  }
  // 역할은 토큰 클레임에 박습니다. 서버가 이 값으로 권한을 판정합니다.
  await auth.setCustomUserClaims(user.uid, { role: e.role, empNo: e.empNo });
  console.log(
    `  ${e.empNo}  ${e.name.padEnd(4)} ${e.rank.padEnd(3)} ${e.role.padEnd(12)} ${password}`,
  );
}

// 사람이 바뀌었을 때 옛 로그인 계정을 지웁니다.
const keepEmails = new Set(loginable.map((e) => emailOf(e.empNo)));
const all = await auth.listUsers(100);
const staleUsers = all.users.filter((u) => u.email && !keepEmails.has(u.email));
if (staleUsers.length > 0) {
  await auth.deleteUsers(staleUsers.map((u) => u.uid));
  console.log(`  옛 계정 ${staleUsers.length}개 삭제`);
}

console.log("\n완료. 초기 비밀번호는 사번 뒤에 1234 입니다 (예: 2025336901234).");
