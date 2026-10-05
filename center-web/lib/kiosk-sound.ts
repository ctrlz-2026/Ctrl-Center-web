import type { KioskSignal } from "./kiosk-types";

/* 키오스크 알림음.
 *
 * 음원 파일을 쓰지 않고 브라우저(Web Audio)로 그 자리에서 만듭니다. 파일을
 * 받아오다 끊기는 일이 없고, 네트워크가 느린 현장에서도 즉시 납니다.
 *
 * 소리로 **통과와 실패를 구분**합니다. 공장은 시끄럽고 작업자는 화면을 계속
 * 보고 있지 않으므로, 듣기만 해도 결과를 알 수 있어야 합니다.
 *   통과 계열  높은 음, 올라가는 가락  (삑 / 띠-링 / 도-미-솔)
 *   실패 계열  낮은 음, 내려가는 가락  (부- / 부-부-)
 * 색각이 다르거나 보호경을 써서 화면 색을 못 읽는 사람에게도 같은 정보가 갑니다.
 *
 * 브라우저는 사용자가 화면을 한 번 건드리기 전에는 소리를 막습니다(자동재생
 * 정책). 키오스크는 「이 작업으로 입장 시작」을 누르고 이 화면에 오므로 보통은
 * 이미 풀려 있고, 주소로 바로 열었을 때를 위해 화면에 소리 버튼을 둡니다. */

type Tone = { freq: number; ms: number; gapMs?: number; type?: OscillatorType };

const UP: Tone[] = [
  { freq: 880, ms: 110 },
  { freq: 1175, ms: 160 },
];
const DOWN: Tone[] = [
  { freq: 330, ms: 220, type: "square" },
  { freq: 247, ms: 320, type: "square" },
];

const PATTERNS: Record<KioskSignal, Tone[]> = {
  card_ok: [{ freq: 1320, ms: 90 }],
  face_ok: UP,
  ppe_ok: UP,
  entry: [{ freq: 988, ms: 120 }],
  exit: [{ freq: 660, ms: 120 }],
  // 문 열림 — 가장 기다리던 소리라 셋으로 길게.
  unlock: [
    { freq: 784, ms: 120 },
    { freq: 988, ms: 120 },
    { freq: 1319, ms: 260 },
  ],
  // 다시 하면 되는 실패 — 짧게 한 번.
  face_fail: [{ freq: 294, ms: 260, type: "square" }],
  ppe_fail: [{ freq: 294, ms: 260, type: "square" }],
  // 차단 — 다시 해도 안 되는 실패라 두 번, 더 낮게.
  blocked: DOWN,
};

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx ??= new Ctor();
  return ctx;
}

/** 소리가 실제로 날 수 있는 상태인지. 막혀 있으면 화면에 켜기 버튼을 띄웁니다. */
export function soundReady(): boolean {
  return audio()?.state === "running";
}

/** 사용자가 화면을 건드렸을 때 부릅니다. 브라우저의 소리 잠금을 풉니다. */
export async function unlockSound(): Promise<boolean> {
  const a = audio();
  if (!a) return false;
  if (a.state !== "running") {
    try {
      await a.resume();
    } catch {
      return false;
    }
  }
  return a.state === "running";
}

export function playSignal(kind: KioskSignal) {
  const a = audio();
  if (!a || a.state !== "running") return;
  let t = a.currentTime + 0.02;
  for (const tone of PATTERNS[kind]) {
    const osc = a.createOscillator();
    const gain = a.createGain();
    osc.type = tone.type ?? "sine";
    osc.frequency.value = tone.freq;
    // 끝을 뚝 자르면 "틱" 소리가 납니다. 짧게 올리고 내립니다.
    const end = t + tone.ms / 1000;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.28, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(gain).connect(a.destination);
    osc.start(t);
    osc.stop(end + 0.02);
    t = end + (tone.gapMs ?? 40) / 1000;
  }
}
