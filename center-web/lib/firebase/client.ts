"use client";

import { getApp, getApps, initializeApp } from "firebase/app";
import type { FirebaseApp, FirebaseOptions } from "firebase/app";
import { getAuth } from "firebase/auth";
import type { Auth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import type { Firestore } from "firebase/firestore";

/* 브라우저에서 쓰는 Firebase.
 *
 * .env.local 이 아직 비어 있어도 앱이 죽지 않게 막아뒀습니다.
 * 값이 하나라도 없으면 isFirebaseReady 가 false 이고, 그동안 화면은
 * 기존 목업(lib/data.ts + lib/store.tsx)으로 계속 동작합니다.
 *
 * NEXT_PUBLIC_ 값들은 브라우저로 나갑니다. 원래 공개되는 값이라 괜찮습니다 —
 * 실제 보호는 Firestore 보안 규칙과 서버(Route Handler)가 합니다. */

const config: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const isFirebaseReady = Boolean(
  config.apiKey && config.projectId && config.appId,
);

let app: FirebaseApp | null = null;

function getFirebaseApp(): FirebaseApp | null {
  if (!isFirebaseReady) return null;
  if (app) return app;
  app = getApps().length ? getApp() : initializeApp(config);
  return app;
}

export function getFirebaseAuth(): Auth | null {
  const a = getFirebaseApp();
  return a ? getAuth(a) : null;
}

export function getDb(): Firestore | null {
  const a = getFirebaseApp();
  return a ? getFirestore(a) : null;
}
