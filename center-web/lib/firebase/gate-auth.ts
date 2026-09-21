import "server-only";

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { adminDb } from "./admin";

/* 게이트 기기 인증.
 *
 * 젯슨에는 Firebase 키를 심지 않습니다. 기기가 현장 벽에 물리적으로 붙어 있어서
 * 키가 새면 DB 전체가 열립니다. 대신 **게이트마다 다른 기기 키**를 발급하고
 * `X-Gate-Key` 헤더로 받습니다. 한 대가 털려도 그 게이트 몫만 잃습니다.
 *
 * 키는 DB 가 아니라 환경변수에 둡니다 — DB 에 두면 DB 를 읽을 수 있는 쪽이
 * 모든 게이트를 사칭할 수 있게 되어, 키를 나눈 의미가 없어집니다.
 *
 *   gate-a1 → GATE_DEVICE_KEY_A1
 *   gate-b2 → GATE_DEVICE_KEY_B2
 */

export interface Gate {
  id: string;
  siteId: string;
  name: string;
}

/** 게이트 ID → 환경변수 이름. `gate-a1` → `GATE_DEVICE_KEY_A1` */
export function envNameFor(gateId: string): string {
  const suffix = gateId
    .replace(/^gate-/, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "_");
  return `GATE_DEVICE_KEY_${suffix}`;
}

/** 길이가 달라도 시간차로 정답을 유추당하지 않게 비교합니다. */
function sameSecret(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) {
    // 길이가 다르면 어차피 틀렸지만, 비교 자체는 수행해 시간을 맞춥니다.
    timingSafeEqual(ba, ba);
    return false;
  }
  return timingSafeEqual(ba, bb);
}

export function isResponse(v: unknown): v is NextResponse {
  return v instanceof NextResponse;
}

/**
 * 경로의 게이트 ID 와 `X-Gate-Key` 헤더를 대조합니다.
 * 통과하면 게이트 정보를, 아니면 그대로 응답으로 쓸 수 있는 NextResponse 를 돌려줍니다.
 */
export async function requireGate(
  request: Request,
  gateId: string,
): Promise<Gate | NextResponse> {
  const sent = request.headers.get("x-gate-key");
  if (!sent) {
    return NextResponse.json(
      { error: "X-Gate-Key 헤더가 필요해요." },
      { status: 401 },
    );
  }

  const expected = process.env[envNameFor(gateId)];
  if (!expected) {
    /* 키를 발급하지 않은 게이트입니다. 401 로 답하면 "키가 틀렸나" 하고
       계속 시도하게 되므로, 설정이 빠졌다는 걸 구분해서 알려줍니다. */
    return NextResponse.json(
      {
        error: `${gateId} 의 기기 키가 서버에 설정돼 있지 않아요. 환경변수 ${envNameFor(gateId)} 를 추가해 주세요.`,
      },
      { status: 503 },
    );
  }

  if (!sameSecret(sent, expected)) {
    return NextResponse.json({ error: "기기 키가 맞지 않아요." }, { status: 403 });
  }

  const snap = await adminDb().collection("gates").doc(gateId).get();
  if (!snap.exists) {
    return NextResponse.json({ error: "없는 게이트예요." }, { status: 404 });
  }
  const g = snap.data()!;
  return { id: gateId, siteId: String(g.siteId), name: String(g.name ?? gateId) };
}

/**
 * 경로에 게이트 ID 가 없는 요청(이벤트 수신구)에서, 키만 보고 어느 게이트인지 찾습니다.
 * 등록된 게이트를 순회하며 키가 맞는 것을 고릅니다.
 */
export async function resolveGateByKey(
  request: Request,
): Promise<Gate | NextResponse> {
  const sent = request.headers.get("x-gate-key");
  if (!sent) {
    return NextResponse.json(
      { error: "X-Gate-Key 헤더가 필요해요." },
      { status: 401 },
    );
  }

  const snap = await adminDb().collection("gates").get();
  for (const doc of snap.docs) {
    const expected = process.env[envNameFor(doc.id)];
    if (expected && sameSecret(sent, expected)) {
      const g = doc.data();
      return { id: doc.id, siteId: String(g.siteId), name: String(g.name ?? doc.id) };
    }
  }
  return NextResponse.json({ error: "기기 키가 맞지 않아요." }, { status: 403 });
}
