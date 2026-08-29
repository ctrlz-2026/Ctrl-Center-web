import "server-only";

import { cert, getApp, getApps, initializeApp } from "firebase-admin/app";
import type { App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import type { Auth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import type { Firestore } from "firebase-admin/firestore";

/* 서버(Route Handler)에서만 쓰는 Firebase Admin.
 *
 * 이 자격증명은 보안 규칙을 전부 우회합니다. 절대 브라우저로 나가면 안 되므로
 * `server-only` 를 걸어뒀습니다 — 클라이언트 컴포넌트에서 실수로 import 하면
 * 빌드가 실패합니다.
 *
 * .env.local 이 비어 있어도 앱이 죽지 않게 막아뒀습니다. 값이 없으면
 * isAdminReady 가 false 이고, 이걸 확인하지 않고 쓰면 명확한 에러를 냅니다. */

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
// .env 파일 안에서는 줄바꿈이 \n 두 글자로 들어옵니다. 실제 줄바꿈으로 되돌립니다.
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

export const isAdminReady = Boolean(projectId && clientEmail && privateKey);

let adminApp: App | null = null;

function getAdminApp(): App {
  if (!isAdminReady) {
    throw new Error(
      "Firebase Admin 설정이 없어요. center-web/.env.local 의 FIREBASE_PROJECT_ID · FIREBASE_CLIENT_EMAIL · FIREBASE_PRIVATE_KEY 를 채워주세요.",
    );
  }
  if (adminApp) return adminApp;
  adminApp = getApps().length
    ? getApp()
    : initializeApp({
        credential: cert({
          projectId,
          clientEmail,
          privateKey,
        }),
      });
  return adminApp;
}

export function adminDb(): Firestore {
  return getFirestore(getAdminApp());
}

export function adminAuth(): Auth {
  return getAuth(getAdminApp());
}
