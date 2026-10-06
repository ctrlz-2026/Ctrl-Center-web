import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { adminDb } from "./admin";
import type { ParsedFaceTemplate } from "@/lib/face-template";

/* 얼굴 특징 벡터 보관.
 *
 * ── 방침이 바뀌었습니다 (2026-10-06) ─────────────────────────────────────
 * 그동안은 "얼굴 사진·특징값은 웹에 저장하지 않는다"였습니다. 젯슨이 한 대일
 * 때는 그게 맞았는데, 등록을 **젯슨 앞이 아니라 관리자 화면에서** 하고, 등록한
 * 값을 **게이트 기기가 내려받아 쓰게** 하려면 서버가 벡터를 들고 있어야 합니다.
 * 그래서 팀 결정으로 벡터는 받기로 했습니다. **사진은 여전히 받지 않습니다.**
 *
 * 받는 대신 지키는 것
 *   1. **암호화해서 저장** — DB 를 읽을 수 있어도 벡터를 쓸 수 없습니다 (AES-256-GCM)
 *   2. **브라우저로 다시 내보내지 않음** — 관리자 화면도 "몇 차원 · 몇 개 · 언제"만 봅니다
 *   3. **게이트 기기만 내려받음** — 기기 키로 인증하고, 그날 그 게이트에 올 사람 것만
 *   4. **지우면 진짜 지움** — 다른 기록은 지우는 대신 무효화하지만, 생체정보는
 *      남겨둘 이유가 없습니다. 퇴사·재등록 때 문서를 삭제합니다
 *   5. 직원 문서(employees)와 **다른 컬렉션** — 직원 목록을 읽는 코드가 벡터를
 *      같이 끌고 다니지 않게 합니다
 *
 * ── 암호화 키 ───────────────────────────────────────────────────────────
 * 환경변수 FACE_TEMPLATE_KEY 가 있으면 그것을, 없으면 서버에만 있는 서비스 계정
 * 비밀키에서 유도한 키를 씁니다(HKDF). 새 비밀값을 배포 환경에 따로 넣지 않아도
 * 되게 하려는 것입니다.
 *
 * 주의 — **서비스 계정 키를 교체하면 이전에 올린 벡터는 풀 수 없게 됩니다.**
 * 그런 벡터는 조용히 넘기지 않고 "다시 올려야 함"으로 표시합니다. 키 교체가
 * 잦아지면 FACE_TEMPLATE_KEY 를 따로 두세요. */

const COLLECTION = "faceTemplates";
const KEY_INFO = "ctrl-center/face-template/v1";

function key(): Buffer {
  const own = process.env.FACE_TEMPLATE_KEY;
  if (own) return createHash("sha256").update(own).digest();
  const secret = process.env.FIREBASE_PRIVATE_KEY;
  if (!secret) throw new Error("서버 비밀키가 없어 얼굴 벡터를 암호화할 수 없어요.");
  /* 같은 비밀키라도 환경마다 **적힌 모양**이 다릅니다 — .env 파일에서는 줄바꿈이
     역슬래시+n 두 글자이고, 배포 환경 설정에서는 진짜 줄바꿈일 수 있습니다. 그대로 쓰면
     로컬에서 올린 벡터를 배포 서버가 풀지 못합니다. 머리말과 공백을 걷어내고
     내용(base64)만으로 키를 만듭니다. */
  const material = secret
    .replace(/\\n/g, "") // .env 에 글자로 적힌 줄바꿈
    .replace(/-----[A-Z ]+-----/g, "")
    .replace(/["'\s]+/g, "");
  return Buffer.from(hkdfSync("sha256", material, "ctrl-center", KEY_INFO, 32));
}

export interface FaceTemplateSummary {
  dim: number;
  count: number;
  model: string | null;
  fileName: string | null;
  uploadedAt: string;
  uploadedBy: string;
}

export interface FaceTemplate extends FaceTemplateSummary {
  empNo: string;
  vectors: number[][];
}

/** 벡터를 저장합니다. 같은 사람의 이전 벡터는 덮어씁니다 (재등록). */
export async function saveFaceTemplate(
  empNo: string,
  parsed: ParsedFaceTemplate,
  meta: { uploadedBy: string; fileName: string | null },
): Promise<FaceTemplateSummary> {
  // float32 로 통일합니다. 얼굴 모델의 출력이 원래 float32 이고, 크기가 절반입니다.
  const flat = new Float32Array(parsed.vectors.length * parsed.dim);
  parsed.vectors.forEach((v, r) => flat.set(v, r * parsed.dim));
  const plain = Buffer.from(flat.buffer, flat.byteOffset, flat.byteLength);

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);

  const summary: FaceTemplateSummary = {
    dim: parsed.dim,
    count: parsed.vectors.length,
    model: parsed.model ?? null,
    fileName: meta.fileName,
    uploadedAt: new Date().toISOString(),
    uploadedBy: meta.uploadedBy,
  };

  const db = adminDb();
  const batch = db.batch();
  batch.set(db.collection(COLLECTION).doc(empNo), {
    empNo,
    ...summary,
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  });
  /* 직원 문서에는 **요약만** 둡니다. 관리자 화면과 일일 번들이 "등록됐는가"를
     벡터 문서를 열지 않고 알 수 있게 하려는 것입니다. */
  batch.update(db.collection("employees").doc(empNo), {
    faceEnrolled: true,
    faceEnrolledAt: summary.uploadedAt,
    faceEnrolledBy: meta.uploadedBy,
    faceTemplate: summary,
  });
  await batch.commit();
  return summary;
}

/** 벡터를 **삭제**합니다. 무효화가 아니라 실제로 지웁니다. */
export async function deleteFaceTemplate(empNo: string): Promise<boolean> {
  const db = adminDb();
  const ref = db.collection(COLLECTION).doc(empNo);
  const existed = (await ref.get()).exists;
  const batch = db.batch();
  batch.delete(ref);
  batch.update(db.collection("employees").doc(empNo), {
    faceEnrolled: false,
    faceEnrolledAt: null,
    faceEnrolledBy: null,
    faceTemplate: null,
  });
  await batch.commit();
  return existed;
}

/** 여러 사람의 벡터를 풀어서 돌려줍니다. **게이트 기기에게만** 내려보내는 용도입니다.
 *  풀 수 없는 벡터(키가 바뀜)는 undecryptable 에 사번만 담아 알립니다. */
export async function loadFaceTemplates(
  empNos: string[],
): Promise<{ templates: FaceTemplate[]; undecryptable: string[] }> {
  if (empNos.length === 0) return { templates: [], undecryptable: [] };
  const db = adminDb();
  const snaps = await db.getAll(...empNos.map((e) => db.collection(COLLECTION).doc(e)));

  const k = key();
  const templates: FaceTemplate[] = [];
  const undecryptable: string[] = [];
  for (const snap of snaps) {
    if (!snap.exists) continue;
    const d = snap.data()!;
    try {
      const decipher = createDecipheriv("aes-256-gcm", k, Buffer.from(String(d.iv), "base64"));
      decipher.setAuthTag(Buffer.from(String(d.tag), "base64"));
      const plain = Buffer.concat([
        decipher.update(Buffer.from(String(d.data), "base64")),
        decipher.final(),
      ]);
      const flat = new Float32Array(plain.buffer, plain.byteOffset, plain.byteLength / 4);
      const dim = Number(d.dim);
      const vectors: number[][] = [];
      for (let r = 0; r < Number(d.count); r++) {
        // float32 를 그대로 JSON 에 쓰면 0.10000000149011612 처럼 길어집니다.
        vectors.push(Array.from(flat.subarray(r * dim, (r + 1) * dim), (x) => Number(x.toPrecision(8))));
      }
      templates.push({
        empNo: snap.id,
        vectors,
        dim,
        count: Number(d.count),
        model: d.model ?? null,
        fileName: d.fileName ?? null,
        uploadedAt: String(d.uploadedAt),
        uploadedBy: String(d.uploadedBy),
      });
    } catch {
      undecryptable.push(snap.id);
    }
  }
  return { templates, undecryptable };
}
