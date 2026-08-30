"use client";

import type { ReactNode } from "react";
import { Card, CardTitle } from "./Card";
import { Stack } from "./Layout";
import { useUser } from "@/lib/session";
import { ROLE_LABEL } from "@/lib/types";
import type { Role } from "@/lib/types";

/** 권한 없는 화면에 들어왔을 때. 네비에서 이미 숨기지만 주소로 직접 들어올 수
 *  있으므로 화면에서도 한 번 더 막습니다. 진짜 차단은 Firebase 붙일 때
 *  서버(Route Handler)에서 합니다 — 클라이언트 검사는 UX 용입니다. */
export function RequireRole({
  allow,
  children,
}: {
  allow: (role: Role) => boolean;
  children: ReactNode;
}) {
  const user = useUser();

  if (allow(user.role)) return <>{children}</>;

  return (
    <Stack>
      <Card padding={24} gap={12}>
        <CardTitle>이 화면은 열 수 없어요</CardTitle>
        <p
          style={{
            fontSize: 15,
            lineHeight: 1.467,
            fontWeight: 500,
            color: "var(--label-alternative)",
          }}
        >
          {`${ROLE_LABEL[user.role]} 계정으로는 열 수 없는 화면이에요. 상단 메뉴의 전체 현황과 특이사항은 누구나 볼 수 있어요.`}
        </p>
      </Card>
    </Stack>
  );
}
