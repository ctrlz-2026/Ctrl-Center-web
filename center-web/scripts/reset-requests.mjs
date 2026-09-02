// 시연 전 승인 요청을 깨끗한 상태로 되돌립니다.
//   node --env-file=.env.local scripts/reset-requests.mjs
// 시드 3건은 pending 으로 초기화하고, 테스트하며 생긴 나머지는 지웁니다.
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const db = getFirestore(
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\n/g, "\n"),
    }),
  }),
);

const [snap, notes] = await Promise.all([
  db.collection("approvalRequests").get(),
  db.collection("workNotes").get(),
]);
const batch = db.batch();
let reset = 0;
let removed = 0;

// 특이사항도 지웁니다. 시연 때 빈 상태에서 시작해야 저장 동작을 보여줄 수 있습니다.
for (const n of notes.docs) batch.delete(n.ref);

let kept = 0;

for (const doc of snap.docs) {
  // 시연용 요청(scripts/seed-demo.mjs)은 건드리지 않습니다. 여기서 지워버리면
  // 리셋할 때마다 A동 1층 라인2 의 「작업 대기」가 사라져 다시 심어야 합니다.
  if (doc.id.startsWith("req-demo-")) {
    kept += 1;
  } else if (doc.id.startsWith("req-seed-")) {
    batch.update(doc.ref, {
      status: "pending",
      approverId: null,
      decidedAt: null,
      rejectReason: null,
    });
    reset += 1;
  } else {
    batch.delete(doc.ref);
    removed += 1;
  }
}
await batch.commit();
console.log(
  `승인요청 시드 ${reset}건 초기화 · 테스트 요청 ${removed}건 삭제 · 시연 요청 ${kept}건 유지 · 특이사항 ${notes.size}건 삭제`,
);
