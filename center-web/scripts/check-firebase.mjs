// Admin SDK 가 실제로 Firestore 에 붙는지 확인합니다.
//   node --env-file=.env.local scripts/check-firebase.mjs
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

const app = initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\n/g, "\n"),
  }),
});

const db = getFirestore(app);
const ref = db.collection("_healthcheck").doc("ping");

await ref.set({ at: new Date().toISOString(), from: "check-firebase.mjs" });
const snap = await ref.get();
console.log("Firestore 쓰기/읽기 OK →", snap.data());
await ref.delete();
console.log("정리 완료 (_healthcheck 삭제)");

const users = await getAuth(app).listUsers(1);
console.log("Auth 연결 OK · 현재 사용자 수:", users.users.length);
