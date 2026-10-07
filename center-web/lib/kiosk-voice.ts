import { soundContext } from "./kiosk-sound";
import type { KioskStatus } from "./kiosk-types";
import lines from "./kiosk-voice-lines.json";

/* 키오스크 음성 안내.
 *
 * 알림음(kiosk-sound.ts)은 "됐다 / 안 됐다"만 알립니다. 음성은 **다음에 무엇을
 * 하면 되는지**를 말합니다 — "사원증을 대주세요", "카메라를 봐주세요",
 * "확인되었습니다. 문이 열렸습니다". 문 앞에 선 사람은 장갑을 끼고 짐을 든 채
 * 화면을 계속 읽고 있지 않습니다.
 *
 * ── 왜 브라우저의 읽어주기(speechSynthesis)가 아니라 파일인가 ──────────────
 * 알림음은 파일 없이 그 자리에서 만들지만 음성은 그럴 수 없습니다. 브라우저의
 * 읽어주기는 **그 기기에 깔린 목소리**를 쓰는데, 키오스크 화면이 뜨는 젯슨
 * (리눅스 크로미움)에는 한국어 목소리가 보통 없습니다. 개발 PC 에서는 나고
 * 현장에서는 안 나는 기능이 됩니다. 그래서 문장을 미리 녹음해 두고(11개,
 * scripts/make-kiosk-voice.ps1), 파일을 못 받았을 때만 읽어주기로 물러납니다.
 *
 * 문장은 kiosk-voice-lines.json 한 곳에만 있습니다. 고치면 스크립트를 다시
 * 돌려 파일을 새로 만드세요.
 *
 * 소리 잠금(자동재생 정책)은 알림음과 같은 AudioContext 를 쓰므로 따로 풀
 * 필요가 없습니다. */

export type VoiceLine = keyof typeof lines;

const KEYS = Object.keys(lines) as VoiceLine[];
const buffers = new Map<VoiceLine, AudioBuffer>();
let loading: Promise<void> | null = null;
let playing: AudioBufferSourceNode | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
/** 가장 최근 요청의 번호. 파일을 기다리는 사이 다음 안내가 오면 앞의 것은 버립니다. */
let turn = 0;

/** 음성 파일을 미리 받아 둡니다. 진행 화면이 열릴 때 한 번 부릅니다. */
export function preloadVoice(): Promise<void> {
  const a = soundContext();
  if (!a) return Promise.resolve();
  loading ??= Promise.all(
    KEYS.map(async (key) => {
      try {
        const res = await fetch(`/kiosk-voice/${key}.wav`);
        if (!res.ok) return;
        buffers.set(key, await a.decodeAudioData(await res.arrayBuffer()));
      } catch {
        // 못 받은 문장은 읽어주기로 대신합니다 (say 참고).
      }
    }),
  ).then(() => undefined);
  return loading;
}

function stop() {
  if (timer) clearTimeout(timer);
  timer = null;
  try {
    playing?.stop();
  } catch {
    // 이미 끝난 소리
  }
  playing = null;
  if (typeof window !== "undefined") window.speechSynthesis?.cancel();
}

/** 한 문장을 말합니다. 말하던 것이 있으면 끊고 새 것을 말합니다 — 문 앞에서는
 *  지난 안내보다 **지금 상태**가 중요합니다.
 *  @param delayMs 알림음이 먼저 나야 할 때 그만큼 기다립니다. */
export function say(line: VoiceLine, delayMs = 0) {
  const a = soundContext();
  if (!a || a.state !== "running") return;
  stop();
  const mine = ++turn;
  timer = setTimeout(async () => {
    await preloadVoice();
    if (mine !== turn || a.state !== "running") return;
    const buffer = buffers.get(line);
    if (!buffer) {
      const u = new SpeechSynthesisUtterance(lines[line]);
      u.lang = "ko-KR";
      window.speechSynthesis?.speak(u);
      return;
    }
    const src = a.createBufferSource();
    src.buffer = buffer;
    src.connect(a.destination);
    src.start();
    playing = src;
  }, delayMs);
}

/** 화면을 열었을 때(또는 소리를 방금 켰을 때) 지금 단계에서 할 말. */
export function promptFor(status: KioskStatus): VoiceLine | null {
  if (status.phase !== "ready") return null;
  switch (status.step) {
    case "face":
      return "face";
    case "verifying":
      return "ppe";
    case "unlocking":
      return "unlock";
    default:
      return "tag";
  }
}

/** 상태가 prev → next 로 바뀌었을 때 할 말. 없으면 null.
 *
 *  젯슨이 이벤트를 몰아서 보내면 화면이 중간 단계를 못 보고 건너뛸 수 있습니다
 *  (사원증 → 얼굴 → 보호구가 한 번의 조회 사이에 끝남). 그래서 단계 이름만 보지
 *  않고 **검증 통과 인원이 늘었는지**도 같이 봅니다. */
export function voiceFor(prev: KioskStatus, next: KioskStatus): VoiceLine | null {
  const signal =
    next.signal && next.signal.at !== prev.signal?.at ? next.signal.kind : null;

  if (prev.phase !== next.phase) {
    if (next.phase === "working") {
      // 젯슨 흐름은 "문 열림 → 전원 입장" 두 번에 걸쳐 오고, 시연 버튼은 한 번에 옵니다.
      return prev.step === "unlocking" ? "working" : "unlock";
    }
    if (next.phase === "blocked") return "blocked";
    if (next.phase === "closed") return "closed";
    return "tag"; // 막혔다가 「다시 시도」
  }
  if (next.phase !== "ready") return null;

  if (signal === "face_fail") return "face_fail";
  if (signal === "ppe_fail") return "ppe_fail";

  if (next.step === "unlocking" && prev.step !== "unlocking") return "unlock";
  if ((next.verified ?? 0) > (prev.verified ?? 0)) return "verified_next";
  if (prev.step !== next.step) {
    if (next.step === "face") return "face";
    if (next.step === "verifying") return "ppe";
    if (next.step === "tagging") return "tag";
  }
  if (signal === "entry") return "entry";
  return null;
}
