/* 얼굴 특징 벡터 파일 읽기.
 *
 * 젯슨이 얼굴을 찍어 만든 **특징 벡터**(숫자 배열)를 파일로 내보내면, 안전관리자가
 * 계정 관리 화면에서 그 파일을 올려 등록합니다. 이 파일은 그 내용을 읽어
 * "숫자 배열 몇 개"로 바꾸는 일만 합니다. 저장·암호화는 lib/firebase/face-templates.ts.
 *
 * 받는 형식
 *   - JSON   `[0.12, -0.03, …]` · `[[…], […]]` · `{ "embedding": […] }` 등
 *   - .npy   NumPy 가 `np.save` 로 내보낸 파일 (float32 / float64, 1차원 또는 2차원)
 *   - 텍스트 한 줄에 벡터 하나, 쉼표나 공백으로 구분
 *
 * 받지 않는 것
 *   - **사진** — 얼굴 사진은 여전히 서버로 오지 않습니다. 벡터만 받습니다
 *   - pickle(.pkl) — 읽는 것만으로 코드가 실행될 수 있는 형식이라 받지 않습니다
 *
 * 벡터 길이는 모델마다 다릅니다(128 · 512 가 흔합니다). 어느 모델인지 서버는
 * 몰라도 됩니다 — 비교는 젯슨이 하고, 서버는 보관했다가 그대로 돌려줄 뿐입니다. */

export const FACE_DIM_MIN = 64;
export const FACE_DIM_MAX = 2048;
/** 한 사람당 벡터 수. 각도를 달리해 여러 장 등록하는 경우를 받습니다. */
export const FACE_MAX_SAMPLES = 10;
export const FACE_MAX_BYTES = 1_000_000;

export class FaceTemplateError extends Error {}

export interface ParsedFaceTemplate {
  /** 벡터들. 한 장만 등록했으면 길이 1 입니다. */
  vectors: number[][];
  dim: number;
  format: "json" | "npy" | "text";
  /** 파일 안에 적혀 있던 모델 이름 (있을 때만). */
  model?: string;
  /** 파일 안에 적혀 있던 사번 (있을 때만). 올리는 대상과 다르면 거절합니다. */
  empNo?: string;
}

const VECTOR_KEYS = [
  "embedding",
  "embeddings",
  "vector",
  "vectors",
  "descriptor",
  "descriptors",
  "encoding",
  "encodings",
  "feature",
  "features",
  "data",
];

function isNumberArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "number");
}

/** 값 하나를 "벡터 목록"으로 읽습니다. 벡터 하나여도, 여러 개여도 됩니다. */
function toVectors(v: unknown): number[][] | null {
  if (isNumberArray(v)) return [v];
  if (Array.isArray(v) && v.length > 0 && v.every(isNumberArray)) return v as number[][];
  return null;
}

function fromJson(text: string): ParsedFaceTemplate {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    throw new FaceTemplateError("JSON 형식이 올바르지 않아요.");
  }

  let vectors = toVectors(root);
  let model: string | undefined;
  let empNo: string | undefined;

  if (!vectors && root && typeof root === "object" && !Array.isArray(root)) {
    const o = root as Record<string, unknown>;
    for (const key of VECTOR_KEYS) {
      vectors = toVectors(o[key]);
      if (vectors) break;
    }
    if (typeof o.model === "string") model = o.model;
    else if (typeof o.model_name === "string") model = o.model_name;
    const id = o.emp_no ?? o.empNo ?? o.employee_id;
    if (typeof id === "string" || typeof id === "number") empNo = String(id);
  }

  if (!vectors) {
    throw new FaceTemplateError(
      `벡터를 찾지 못했어요. 숫자 배열이거나 ${VECTOR_KEYS.slice(0, 4).join(" · ")} 같은 키 아래에 있어야 해요.`,
    );
  }
  return { vectors, dim: vectors[0].length, format: "json", model, empNo };
}

function fromText(text: string): ParsedFaceTemplate {
  const vectors = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split(/[\s,;]+/).filter(Boolean).map(Number));
  if (vectors.length === 0) throw new FaceTemplateError("파일이 비어 있어요.");
  return { vectors, dim: vectors[0].length, format: "text" };
}

/** NumPy .npy — 머리말(자료형 · 모양) 뒤에 숫자가 그대로 이어지는 단순한 형식입니다. */
function fromNpy(bytes: Uint8Array): ParsedFaceTemplate {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const major = bytes[6];
  const headerLen = major >= 2 ? view.getUint32(8, true) : view.getUint16(8, true);
  const headerStart = major >= 2 ? 12 : 10;
  const header = new TextDecoder("latin1").decode(
    bytes.subarray(headerStart, headerStart + headerLen),
  );

  const descr = /'descr'\s*:\s*'([^']+)'/.exec(header)?.[1] ?? "";
  const shape = (/'shape'\s*:\s*\(([^)]*)\)/.exec(header)?.[1] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);
  const fortran = /'fortran_order'\s*:\s*True/.test(header);

  const size = descr === "<f4" || descr === "=f4" ? 4 : descr === "<f8" || descr === "=f8" ? 8 : 0;
  if (!size) {
    throw new FaceTemplateError(
      `지원하지 않는 자료형이에요 (${descr || "알 수 없음"}). float32 또는 float64 로 저장해 주세요.`,
    );
  }
  if (shape.length < 1 || shape.length > 2 || shape.some((n) => !Number.isInteger(n) || n < 1)) {
    throw new FaceTemplateError("벡터는 1차원(길이 N) 또는 2차원(장 수 × N) 배열이어야 해요.");
  }
  if (fortran && shape.length === 2) {
    throw new FaceTemplateError("열 우선(Fortran) 순서 배열은 받지 않아요. np.ascontiguousarray 로 바꿔 주세요.");
  }

  const [count, dim] = shape.length === 1 ? [1, shape[0]] : shape;
  const offset = headerStart + headerLen;
  if (bytes.byteLength < offset + count * dim * size) {
    throw new FaceTemplateError("파일이 중간에 잘린 것 같아요.");
  }
  const vectors: number[][] = [];
  for (let r = 0; r < count; r++) {
    const row: number[] = [];
    for (let c = 0; c < dim; c++) {
      const at = offset + (r * dim + c) * size;
      row.push(size === 4 ? view.getFloat32(at, true) : view.getFloat64(at, true));
    }
    vectors.push(row);
  }
  return { vectors, dim, format: "npy" };
}

export function parseFaceTemplate(bytes: Uint8Array): ParsedFaceTemplate {
  if (bytes.byteLength === 0) throw new FaceTemplateError("파일이 비어 있어요.");
  if (bytes.byteLength > FACE_MAX_BYTES) {
    throw new FaceTemplateError("파일이 너무 커요 (1MB 까지). 벡터 파일이 맞는지 확인해 주세요.");
  }

  // 파일 이름이 아니라 **내용의 첫 바이트**로 종류를 가립니다. 확장자는 바꿀 수 있습니다.
  const b = bytes;
  const isJpeg = b[0] === 0xff && b[1] === 0xd8;
  const isPng = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  const isBmpOrGif = (b[0] === 0x42 && b[1] === 0x4d) || (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46);
  if (isJpeg || isPng || isBmpOrGif) {
    throw new FaceTemplateError(
      "얼굴 사진은 받지 않아요. 젯슨이 사진에서 뽑아낸 벡터 파일(JSON · .npy)을 올려 주세요.",
    );
  }
  if (b[0] === 0x80 && b[1] >= 2 && b[1] <= 5) {
    throw new FaceTemplateError(
      "pickle(.pkl) 파일은 받지 않아요. np.save 로 .npy 를 만들거나 JSON 으로 내보내 주세요.",
    );
  }

  const isNpy = b[0] === 0x93 && b[1] === 0x4e && b[2] === 0x55 && b[3] === 0x4d && b[4] === 0x50 && b[5] === 0x59;
  let parsed: ParsedFaceTemplate;
  if (isNpy) {
    parsed = fromNpy(bytes);
  } else {
    const text = new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "").trim();
    parsed = text.startsWith("[") || text.startsWith("{") ? fromJson(text) : fromText(text);
  }

  const { vectors } = parsed;
  if (vectors.length > FACE_MAX_SAMPLES) {
    throw new FaceTemplateError(`벡터는 한 사람당 ${FACE_MAX_SAMPLES}개까지 올릴 수 있어요 (${vectors.length}개가 들어 있어요).`);
  }
  const dim = vectors[0].length;
  if (dim < FACE_DIM_MIN || dim > FACE_DIM_MAX) {
    throw new FaceTemplateError(
      `벡터 길이가 ${dim} 이에요. 얼굴 특징 벡터는 보통 128 또는 512 입니다 (${FACE_DIM_MIN}~${FACE_DIM_MAX} 만 받아요).`,
    );
  }
  for (const v of vectors) {
    if (v.length !== dim) throw new FaceTemplateError("벡터마다 길이가 달라요.");
    if (!v.every(Number.isFinite)) throw new FaceTemplateError("숫자가 아닌 값(NaN · 무한대)이 들어 있어요.");
    if (v.every((x) => x === 0)) throw new FaceTemplateError("전부 0 인 벡터예요. 추출이 제대로 됐는지 확인해 주세요.");
  }
  return { ...parsed, dim };
}
