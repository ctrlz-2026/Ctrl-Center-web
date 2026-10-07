import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { isResponse, requireCaller } from "@/lib/firebase/auth-guard";
import { deleteFaceTemplate, saveFaceTemplate } from "@/lib/firebase/face-templates";
import { invalidateMasters } from "@/lib/firebase/queries";
import { FACE_MAX_BYTES, FaceTemplateError, parseFaceTemplate } from "@/lib/face-template";
import { canManageAccounts } from "@/lib/types";

/* 얼굴 등록 상태 · 특징 벡터 등록 · 삭제 (안전관리자 전용).
 *
 *   GET    /api/admin/accounts/{사번}/face-template   등록 상태만 (벡터는 없음)
 *   PUT    /api/admin/accounts/{사번}/face-template   multipart, file=<벡터 파일>
 *   DELETE /api/admin/accounts/{사번}/face-template
 *
 * 젯슨이 얼굴을 찍어 만든 벡터를 파일로 내보내면, 안전관리자가 그 파일을 올려
 * 등록합니다. 올라온 벡터는 암호화해 보관하고 **게이트 기기만** 내려받습니다
 * (/api/gate/{gateId}/face-templates). 브라우저로는 다시 나가지 않습니다 —
 * 이 응답에도 벡터는 없고 "몇 차원 · 몇 개"만 있습니다.
 *
 * **사진은 받지 않습니다.** 파일 내용을 보고 사진이면 거절합니다. */

async function guard(request: Request) {
  const caller = await requireCaller(request);
  if (isResponse(caller)) return { error: caller };
  if (!canManageAccounts(caller.role)) {
    return {
      error: NextResponse.json({ error: "계정 관리 권한이 없어요." }, { status: 403 }),
    };
  }
  return { caller };
}

function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

/** 얼굴 등록 상태. 정보 관리 창이 **젯슨에서 등록이 끝나기를 기다리는 동안**
 *  몇 초마다 묻는 곳이라 문서 하나만 읽습니다 — 프로필 전체를 다시 읽게 하면
 *  기다리는 것만으로 읽기 한도를 씁니다. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ empNo: string }> },
) {
  const g = await guard(request);
  if (g.error) return g.error;
  const { empNo } = await params;

  const snap = await adminDb().collection("employees").doc(empNo).get();
  if (!snap.exists) return fail(404, "없는 계정이에요.");
  const e = snap.data()!;
  return NextResponse.json({
    faceEnrolled: e.faceEnrolled === true,
    faceEnrolledAt: e.faceEnrolledAt ?? null,
    faceEnrolledBy: e.faceEnrolledBy ?? null,
    faceTemplate: e.faceTemplate
      ? {
          dim: Number(e.faceTemplate.dim),
          count: Number(e.faceTemplate.count),
          model: e.faceTemplate.model ?? null,
          fileName: e.faceTemplate.fileName ?? null,
          uploadedAt: String(e.faceTemplate.uploadedAt),
        }
      : null,
  });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ empNo: string }> },
) {
  const g = await guard(request);
  if (g.error) return g.error;
  const { empNo } = await params;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, "파일을 multipart/form-data 의 file 칸에 담아 보내주세요.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return fail(400, "file 칸에 벡터 파일이 없어요.");
  if (file.size > FACE_MAX_BYTES) {
    return fail(413, "파일이 너무 커요 (1MB 까지). 벡터 파일이 맞는지 확인해 주세요.");
  }

  const emp = await adminDb().collection("employees").doc(empNo).get();
  if (!emp.exists) return fail(404, "없는 직원이에요.");
  if (emp.data()?.active === false) return fail(409, "비활성화된 직원은 등록할 수 없어요.");

  let parsed;
  try {
    parsed = parseFaceTemplate(new Uint8Array(await file.arrayBuffer()));
  } catch (e) {
    if (e instanceof FaceTemplateError) return fail(400, e.message);
    throw e;
  }

  /* 파일 안에 사번이 적혀 있는데 지금 올리는 사람과 다르면 막습니다.
     남의 얼굴이 이 사람 이름으로 등록되면, 그 사람이 이 사원증으로 통과합니다. */
  if (parsed.empNo && parsed.empNo !== empNo) {
    return fail(
      400,
      `이 파일은 ${parsed.empNo} 의 벡터예요. ${empNo} (${String(emp.data()?.name ?? "")}) 에게는 올릴 수 없어요.`,
    );
  }

  const model = typeof form.get("model") === "string" ? String(form.get("model")).trim() : "";
  const summary = await saveFaceTemplate(
    empNo,
    { ...parsed, model: parsed.model ?? (model || undefined) },
    { uploadedBy: g.caller!.empNo, fileName: file.name || null },
  );
  invalidateMasters();
  return NextResponse.json({ ok: true, emp_no: empNo, ...summary, format: parsed.format });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ empNo: string }> },
) {
  const g = await guard(request);
  if (g.error) return g.error;
  const { empNo } = await params;

  const emp = await adminDb().collection("employees").doc(empNo).get();
  if (!emp.exists) return fail(404, "없는 직원이에요.");

  const existed = await deleteFaceTemplate(empNo);
  invalidateMasters();
  return NextResponse.json({ ok: true, emp_no: empNo, deleted: existed });
}
