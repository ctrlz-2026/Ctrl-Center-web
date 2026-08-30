"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Logo } from "@/components/Logo";
import { useSession, useUser } from "@/lib/session";
import { useRequests } from "@/lib/store";
import { ROLE_LABEL, canApprove, canRequestWork, canViewMyPage } from "@/lib/types";
import type { Role } from "@/lib/types";
import styles from "./TopNav.module.css";

/** 메뉴는 역할이 정합니다. 안전관리자에게는 관제와 특이사항만 남습니다.
 *  전체 현황이 맨 앞입니다 — 역할과 상관없이 전원이 보는 유일한 화면이고,
 *  로고를 눌렀을 때 돌아올 기본 화면이기도 합니다.
 *
 *  특이사항도 전원이 봅니다. 다음에 그 장소에 들어갈 사람이 읽어야 하는
 *  내용이라 역할로 막을 이유가 없습니다. */
const MENU: { href: string; label: string; allow: (r: Role) => boolean }[] = [
  { href: "/dashboard", label: "전체 현황", allow: () => true },
  { href: "/notes", label: "특이사항", allow: () => true },
  { href: "/requests/new", label: "작업 승인 요청", allow: canRequestWork },
  { href: "/approvals", label: "승인함", allow: canApprove },
  { href: "/me", label: "마이페이지", allow: canViewMyPage },
];

/** 스펙상 네비 우측 부속물은 화면마다 다릅니다 — 승인함은 "새 요청 N건" 배지,
 *  레이아웃에서 슬롯으로 넘기는 대신 네비가 경로를 보고 직접 고릅니다.
 *  대기 건수는 서버 push 로 실시간 갱신됩니다.
 *
 *  갱신 시각 표시는 네비에 두지 않습니다 — 관제 화면 카드 헤더에 실제 연결 상태와
 *  함께 있고, 두 군데에 두면 한쪽이 가짜가 됩니다. */
export function TopNav() {
  const pathname = usePathname();
  const { pendingCount } = useRequests();
  const user = useUser();
  const { signOut } = useSession();
  const router = useRouter();
  const menu = MENU.filter((m) => m.allow(user.role));

  return (
    <nav className={styles.nav} aria-label="주요 메뉴">
      <div className={styles.inner}>
        <div className={styles.left}>
          {/* 로고는 첫 화면으로 돌아가는 문이기도 합니다 — 역할마다 갈 수 있는
              화면이 달라, 메뉴에 남아 있는 첫 항목으로 보냅니다. */}
          <Link
            href={menu[0]?.href ?? "/dashboard"}
            className={styles.logo}
            aria-label="Center 홈"
          >
            <Logo size="sm" />
          </Link>
          <ul className={styles.menu}>
            {menu.map((m) => {
              const active = pathname.startsWith(m.href);
              return (
                <li key={m.href}>
                  <Link
                    href={m.href}
                    className={`${styles.item} ${active ? styles.active : ""}`}
                    aria-current={active ? "page" : undefined}
                  >
                    {m.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>

        <div className={styles.right}>
          {pathname.startsWith("/approvals") && pendingCount > 0 ? (
            <span className={styles.alertBadge}>새 요청 {pendingCount}건</span>
          ) : null}
          <span className={styles.account}>
            {user.name} {user.rank}
            {user.rank === ROLE_LABEL[user.role]
              ? ""
              : ` · ${ROLE_LABEL[user.role]}`}
          </span>
          <span className={styles.avatar} aria-hidden="true">
            {user.name.slice(1)}
          </span>
          <button
            type="button"
            className={styles.signOut}
            onClick={() => {
              signOut();
              router.push("/login");
            }}
          >
            로그아웃
          </button>
        </div>
      </div>
    </nav>
  );
}
