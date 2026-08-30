import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { isResponse, requireCaller } from "@/lib/firebase/auth-guard";
import { loadMasters } from "@/lib/firebase/queries";
import { canManageAccounts } from "@/lib/types";
import type { AccountProfile, AccountProfileOptions } from "@/lib/types";

/* 한 사람의 자격 · 사원증 · 얼굴등록 · 작업배정.
 *
 * **얼굴 사진과 특징값은 여기서 다루지 않습니다.** 얼굴인식 판정은 젯슨이
 * 전부 하고(lib/gate-contract.ts) 웹은 결과만 받습니다. 생체정보를 웹 DB 에
 * 두면 보관·파기 책임이 통째로 따라오므로, 웹은 "등록됐는지"만 대장으로 듭니다.
 * 실제 등록 작업은 젯슨 앞에서 하고 여기서는 그 사실을 기록만 합니다. */

const YMD = /^\d{4}-\d{2}-\d{2}$/;

async function guard(request: Request) {
  const caller = await requireCaller(request);
  if (isResponse(caller)) return { error: caller };
  if (!canManageAccounts(caller.role)) {
    return {
      error: NextResponse.json(
        { error: "계정 관리 권한이 없어요." },
        { status: 403 },
      ),
    };
  }
  return { caller };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ empNo: string }> },
) {
  const g = await guard(request);
  if (g.error) return g.error;

  const { empNo } = await params;
  const db = adminDb();
  const [masters, empSnap, cardSnap] = await Promise.all([
    loadMasters(),
    db.collection("employees").doc(empNo).get(),
    db.collection("employeeCards").where("empNo", "==", empNo).get(),
  ]);

  if (!empSnap.exists) {
    return NextResponse.json({ error: "없는 계정이에요." }, { status: 404 });
  }
  const e = empSnap.data()!;

  // 폐기되지 않은 카드가 현재 카드입니다. 옛 카드는 기록으로 남습니다.
  const live = cardSnap.docs.find((d) => !d.data().revokedAt);

  const profile: AccountProfile = {
    empNo,
    name: String(e.name),
    qualifications: (e.qualifications ?? []).map(
      (q: { code: string; expiresOn: string }) => ({
        code: q.code,
        name: masters.qualNames.get(q.code) ?? q.code,
        expiresOn: q.expiresOn,
      }),
    ),
    card: live
      ? {
          cardUid: live.id,
          issuedAt: String(live.data().issuedAt ?? ""),
          pending: live.data().pending === true,
        }
      : null,
    faceEnrolled: e.faceEnrolled === true,
    faceEnrolledAt: e.faceEnrolledAt ?? null,
    allowedWorkCodes: Array.isArray(e.allowedWorkCodes)
      ? e.allowedWorkCodes
      : null,
  };

  const options: AccountProfileOptions = {
    qualifications: [...masters.qualNames.entries()].map(([code, name]) => ({
      code,
      name,
    })),
    workCodes: [...masters.workCodes.entries()]
      .filter(([, w]) => w.active !== false)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, w]) => ({
        code,
        name: String(w.name),
        requiredQualifications: w.requiredQualifications ?? [],
      })),
  };

  return NextResponse.json({ profile, options });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ empNo: string }> },
) {
  const g = await guard(request);
  if (g.error) return g.error;
  const caller = g.caller!;

  let body: {
    qualifications?: { code?: unknown; expiresOn?: unknown }[];
    cardUid?: unknown;
    faceEnrolled?: unknown;
    allowedWorkCodes?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON 형식이 아니에요." }, { status: 400 });
  }

  const { empNo } = await params;
  const db = adminDb();
  const ref = db.collection("employees").doc(empNo);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ error: "없는 계정이에요." }, { status: 404 });
  }

  const masters = await loadMasters();
  const patch: Record<string, unknown> = {};

  // ── 자격 ─────────────────────────────────────────────────────────────
  if (body.qualifications !== undefined) {
    if (!Array.isArray(body.qualifications)) {
      return NextResponse.json(
        { error: "자격 목록 형식이 올바르지 않아요." },
        { status: 400 },
      );
    }
    const quals: { code: string; expiresOn: string }[] = [];
    for (const q of body.qualifications) {
      const code = String(q.code ?? "");
      const expiresOn = String(q.expiresOn ?? "");
      if (!masters.qualNames.has(code)) {
        return NextResponse.json(
          { error: `없는 자격이에요: ${code}` },
          { status: 400 },
        );
      }
      if (!YMD.test(expiresOn)) {
        return NextResponse.json(
          { error: "만료일은 YYYY-MM-DD 형식이어야 해요." },
          { status: 400 },
        );
      }
      // 같은 자격을 두 번 넣으면 나중 것만 남깁니다.
      const dup = quals.findIndex((x) => x.code === code);
      if (dup >= 0) quals[dup] = { code, expiresOn };
      else quals.push({ code, expiresOn });
    }
    patch.qualifications = quals;
  }

  // ── 작업 배정 ────────────────────────────────────────────────────────
  if (body.allowedWorkCodes !== undefined) {
    if (body.allowedWorkCodes === null) {
      patch.allowedWorkCodes = null; // 제한 없음 — 자격 요건만 봅니다
    } else if (Array.isArray(body.allowedWorkCodes)) {
      const codes = body.allowedWorkCodes.map(String);
      const unknown = codes.find((c) => !masters.workCodes.has(c));
      if (unknown) {
        return NextResponse.json(
          { error: `없는 작업코드예요: ${unknown}` },
          { status: 400 },
        );
      }
      patch.allowedWorkCodes = [...new Set(codes)];
    } else {
      return NextResponse.json(
        { error: "작업 배정 형식이 올바르지 않아요." },
        { status: 400 },
      );
    }
  }

  // ── 얼굴 등록 여부 ───────────────────────────────────────────────────
  if (body.faceEnrolled !== undefined) {
    const enrolled = body.faceEnrolled === true;
    patch.faceEnrolled = enrolled;
    patch.faceEnrolledAt = enrolled ? new Date().toISOString() : null;
    patch.faceEnrolledBy = enrolled ? caller.empNo : null;
  }

  if (Object.keys(patch).length > 0) await ref.update(patch);

  // ── 사원증 ───────────────────────────────────────────────────────────
  /* 카드는 employees 가 아니라 employeeCards 에 있습니다(문서 ID = 카드 UID).
   * 카드를 바꿀 때 옛 문서를 지우지 않고 revokedAt 을 찍습니다 — 분실 카드로
   * 찍힌 과거 출입 기록을 추적할 수 있어야 하기 때문입니다. */
  if (body.cardUid !== undefined) {
    const raw = body.cardUid === null ? "" : String(body.cardUid).trim();
    const cards = await db
      .collection("employeeCards")
      .where("empNo", "==", empNo)
      .get();
    const now = new Date().toISOString();

    if (raw && cards.docs.some((d) => d.id === raw && !d.data().revokedAt)) {
      // 이미 이 사람의 현재 카드입니다. 할 일이 없습니다.
    } else {
      if (raw) {
        // 남의 카드로 등록하려는 경우를 막습니다.
        const taken = await db.collection("employeeCards").doc(raw).get();
        if (taken.exists && String(taken.data()?.empNo) !== empNo) {
          return NextResponse.json(
            { error: "다른 직원에게 등록된 사원증이에요." },
            { status: 409 },
          );
        }
      }
      const batch = db.batch();
      for (const d of cards.docs) {
        if (!d.data().revokedAt) batch.update(d.ref, { revokedAt: now });
      }
      if (raw) {
        batch.set(
          db.collection("employeeCards").doc(raw),
          {
            cardUid: raw,
            empNo,
            issuedAt: now.slice(0, 10),
            revokedAt: null,
            // 실물 UID 를 손으로 넣은 것이므로 더 이상 임시가 아닙니다.
            pending: false,
          },
          { merge: true },
        );
      }
      await batch.commit();
    }
  }

  return NextResponse.json({ ok: true });
}
