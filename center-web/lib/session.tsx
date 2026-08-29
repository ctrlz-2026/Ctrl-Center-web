"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
} from "firebase/auth";
import { getFirebaseAuth, isFirebaseReady } from "./firebase/client";
import { emailOf } from "./firebase/user";
import type { Role, User } from "./types";

/* 로그인 세션. Firebase Auth 를 진실 공급원으로 씁니다.
 *
 * - 신원·비밀번호 검증 → Firebase Auth
 * - 역할(role) → 커스텀 클레임. 서버도 같은 값을 보고 권한을 판정합니다
 * - 프로필(이름·팀·자격) → Firestore employees/{사번}
 *
 * 자격의 유효/임박/만료는 저장된 상태가 아니라 expiresOn 에서 매번 파생합니다.
 */

interface SessionValue {
  user: User | null;
  loading: boolean;
  /** 성공하면 그 계정의 역할, 실패하면 null.
   *  로그인 직후 어느 화면으로 보낼지는 **어느 문으로 들어왔나가 아니라 역할**이 정합니다. */
  signIn: (employeeId: string, password: string) => Promise<Role | null>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  // Firebase 설정이 없으면 기다릴 것도 없으므로 로딩으로 시작하지 않습니다.
  const [loading, setLoading] = useState(isFirebaseReady);

  useEffect(() => {
    const auth = getFirebaseAuth();
    // .env.local 이 비어 있으면 loading 이 이미 false 라 그대로 둡니다.
    if (!auth) return;

    return onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) {
        setUser(null);
        setLoading(false);
        return;
      }
      // 인증은 끝났지만 프로필(이름·팀·자격)은 아직입니다. 이 구간을 loading 으로
      // 잡아두지 않으면 (app) 레이아웃 가드가 "로그인 안 된 상태"로 오해하고
      // 로그인 화면으로 되돌려보냅니다.
      setLoading(true);
      try {
        // Firestore 를 직접 읽지 않고 서버를 거칩니다 (규칙은 잠긴 채로 유지).
        const token = await fbUser.getIdToken();
        const res = await fetch("/api/me", {
          headers: { authorization: `Bearer ${token}` },
        });
        setUser(res.ok ? ((await res.json()) as User) : null);
      } catch {
        // 계정이 삭제됐거나 토큰이 무효한 경우입니다. 그냥 두면 Firebase SDK 가
        // 갱신을 계속 재시도하며 콘솔에 400 을 쌓습니다. 자격증명을 비웁니다.
        setUser(null);
        try {
          await fbSignOut(auth);
        } catch {
          // 이미 로그아웃된 경우
        }
      } finally {
        setLoading(false);
      }
    });
  }, []);

  const signIn = useCallback(async (employeeId: string, password: string) => {
    const auth = getFirebaseAuth();
    if (!auth) return null;
    try {
      const cred = await signInWithEmailAndPassword(
        auth,
        emailOf(employeeId),
        password,
      );
      // 역할은 토큰 클레임에서 읽습니다. 프로필(이름·팀·자격)은
      // 위 onAuthStateChanged 가 이어서 채웁니다.
      const token = await cred.user.getIdTokenResult();
      return (token.claims.role as Role) ?? null;
    } catch {
      return null;
    }
  }, []);

  const signOut = useCallback(async () => {
    const auth = getFirebaseAuth();
    if (auth) await fbSignOut(auth);
  }, []);

  const value = useMemo<SessionValue>(
    () => ({ user, loading, signIn, signOut }),
    [user, loading, signIn, signOut],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession 은 SessionProvider 안에서만 쓸 수 있어요.");
  }
  return ctx;
}

/** 로그인이 보장된 영역((app) 레이아웃 아래)에서 쓰는 훅. */
export function useUser(): User {
  const { user } = useSession();
  if (!user) {
    throw new Error("useUser 는 로그인된 화면에서만 쓸 수 있어요.");
  }
  return user;
}

export { isFirebaseReady };
