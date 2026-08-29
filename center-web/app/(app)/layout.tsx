"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import type { ReactNode } from "react";
import { TopNav } from "@/components/TopNav";
import { useSession } from "@/lib/session";
import { RequestsProvider } from "@/lib/store";
import styles from "./layout.module.css";

/** 로그인이 확인된 뒤에만 아래 화면들을 그립니다.
 *  이 아래에서는 useUser() 가 항상 사용자를 돌려준다고 가정할 수 있습니다.
 *
 *  클라이언트 가드라 UX 용입니다. 실제 차단은 서버(Route Handler)가
 *  ID 토큰을 검증해서 합니다. */
export default function AppLayout({ children }: { children: ReactNode }) {
  const { user, loading } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading || !user) {
    // 인증 확인 중에는 빈 셸만 둡니다. 스피너를 넣으면 대부분의 경우
    // 깜빡임만 만들어서 오히려 거슬립니다.
    return <main className={styles.main} aria-busy="true" />;
  }

  return (
    <RequestsProvider>
      <TopNav />
      <main className={styles.main}>{children}</main>
    </RequestsProvider>
  );
}
