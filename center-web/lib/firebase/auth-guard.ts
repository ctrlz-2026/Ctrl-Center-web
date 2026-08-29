import "server-only";

import { NextResponse } from "next/server";
import { adminAuth, isAdminReady } from "./admin";
import type { Role } from "@/lib/types";

export interface Caller {
  empNo: string;
  role: Role;
}

/** 요청자의 신원을 ID 토큰에서 확인합니다.
 *
 *  역할은 **토큰의 커스텀 클레임**에서만 읽습니다. 요청 본문이나 헤더로 넘어온
 *  역할을 믿으면 누구나 자기를 팀장이라고 주장할 수 있습니다.
 *
 *  실패하면 그대로 응답으로 쓸 수 있는 NextResponse 를 돌려줍니다. */
export async function requireCaller(
  request: Request,
): Promise<Caller | NextResponse> {
  if (!isAdminReady) {
    return NextResponse.json(
      { error: "서버에 Firebase 설정이 없어요." },
      { status: 503 },
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return NextResponse.json({ error: "인증이 필요해요." }, { status: 401 });
  }

  try {
    const decoded = await adminAuth().verifyIdToken(token);
    const empNo = String(decoded.empNo ?? "");
    const role = decoded.role as Role | undefined;
    if (!empNo || !role) {
      return NextResponse.json(
        { error: "계정에 사번이나 역할이 연결돼 있지 않아요." },
        { status: 403 },
      );
    }
    return { empNo, role };
  } catch {
    return NextResponse.json({ error: "인증이 필요해요." }, { status: 401 });
  }
}

export function isResponse(v: Caller | NextResponse): v is NextResponse {
  return v instanceof NextResponse;
}
