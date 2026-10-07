"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { GateSimulation } from "@/components/GateSimulation";
import { playSignal, soundReady, unlockSound } from "@/lib/kiosk-sound";
import { preloadVoice, promptFor, say, voiceFor } from "@/lib/kiosk-voice";
import type { KioskSignal, KioskStatus } from "@/lib/kiosk-types";
import styles from "../../../page.module.css";

/* 키오스크 진행 화면 (클라이언트).
 *
 * 벽에 붙은 화면이라 **한 번에 한 가지 일**만 보여줍니다 — 지금 단계에서
 * 사람이 할 일 하나와, 그 일을 하는 큰 버튼 하나.
 *
 * 상태는 몇 초마다 서버에 묻습니다. 관제 화면처럼 SSE 로 받지 않는 이유:
 * 키오스크는 로그인 없는 화면이라 관제 스트림(토큰 필요)을 쓸 수 없고, 몇 초
 * 늦게 바뀌어도 되는 화면이라 폴링으로 충분합니다.
 *
 * **폴링은 아껴 씁니다** (2026-09-28 장애). 처음엔 3초마다 무조건 물었는데,
 * 이 화면을 밤새 열어둔 것만으로 Firestore 무료 일일 한도를 다 써서 배포
 * 사이트까지 멈췄습니다. 그래서
 *   - 화면이 안 보이면(탭 숨김·화면 꺼짐) 묻지 않습니다
 *   - 대기 중엔 4초, 작업 중엔 15초 — 작업 중에는 상태가 거의 안 바뀝니다
 *   - 작업이 끝나면 멈춥니다
 *   - 20분 동안 아무것도 안 바뀌면 멈추고 "눌러서 다시 확인"을 띄웁니다 */

interface Task {
  requestId: string;
  code: string;
  title: string;
  headcount: number;
  requiredPpe: string[];
}

const POLL_READY_MS = 4_000;
const POLL_WORKING_MS = 15_000;
/** 검증이 한창일 때(방금 뭔가 바뀌었을 때)만 잠깐 빨리 묻습니다. 사원증을 찍고
 *  소리가 4초 뒤에 나면 고장난 줄 압니다. 30초 조용하면 다시 느려집니다. */
const POLL_ACTIVE_MS = 1_500;
const ACTIVE_WINDOW_MS = 30_000;
const IDLE_STOP_MS = 20 * 60_000;
/** 리더가 치는 글자 사이의 간격. 리더는 한 글자에 0.01~0.03초, 사람 손은 0.1초
 *  이상이라 이 값으로 둘을 가릅니다 — 사람이 키보드로 친 것을 사원증으로 보내면
 *  "등록되지 않은 사원증"으로 작업이 막힙니다. */
const READER_MS_PER_CHAR = 60;

/** 눌린 **자리**로 글자를 정합니다. 젯슨의 입력기가 한글 상태면 `A` 가 `ㅁ` 으로
 *  들어와 번호가 깨지는데, 자리(code)는 입력기와 상관없이 같습니다. */
function charOfKey(code: string): string | null {
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(code);
  if (digit) return digit[1];
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1];
  return code === "Minus" || code === "NumpadSubtract" ? "-" : null;
}

/** 알림음이 끝난 뒤에 말을 시작합니다. 가장 긴 알림음(문 열림 · 차단)이 0.6초쯤입니다. */
const VOICE_AFTER_BEEP_MS = 650;

/** 문 앞 단계별 안내. 서버 문구(message)가 있으면 그걸 본문에 씁니다. */
const STEP_TITLE: Record<NonNullable<KioskStatus["step"]>, string> = {
  tagging: "사원증을 대주세요",
  face: "카메라를 봐주세요",
  verifying: "보호구를 확인하고 있어요",
  unlocking: "문이 열렸어요 · 들어가세요",
};

export function KioskLive({
  gateId,
  siteName,
  task,
  initial,
}: {
  gateId: string;
  siteName: string;
  task: Task;
  initial: KioskStatus;
}) {
  const [status, setStatus] = useState<KioskStatus>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  /* 마지막으로 상태가 바뀐 시각. 오래 안 바뀌면 폴링을 멈춥니다. */
  const [changedAt, setChangedAt] = useState(() => Date.now());
  const [paused, setPaused] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  /* 직전 상태. 무엇이 바뀌었는지 보고 소리를 냅니다. */
  const prevRef = useRef<KioskStatus>(initial);

  useEffect(() => {
    // 「입장 시작」을 누르고 넘어온 경우 이미 소리가 풀려 있습니다.
    const ready = soundReady();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSoundOn(ready);
    void preloadVoice();
    // 화면이 열리면 지금 할 일을 먼저 말합니다 ("사원증을 대주세요").
    const line = promptFor(initial);
    if (ready && line) say(line, 300);
    // 처음 한 번만. initial 은 서버가 그려준 첫 상태라 바뀌지 않습니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/kiosk/${gateId}/status?request=${task.requestId}`, {
      cache: "no-store",
    });
    if (!res.ok) return;
    const next = (await res.json()) as KioskStatus;
    const prev = prevRef.current;
    prevRef.current = next;

    const changed =
      prev.phase !== next.phase ||
      prev.sessionId !== next.sessionId ||
      prev.step !== next.step ||
      prev.signal?.at !== next.signal?.at;
    if (changed) setChangedAt(Date.now());

    /* 소리. 젯슨 판정은 서버가 "방금 일어난 일"(signal)을 알려주고, 키오스크
       시연은 그런 신호가 없어 단계가 바뀐 것으로 판단합니다. */
    let sound: KioskSignal | null = null;
    if (next.signal && next.signal.at !== prev.signal?.at) sound = next.signal.kind;
    else if (prev.phase !== next.phase) {
      if (next.phase === "working") sound = "unlock";
      else if (next.phase === "blocked") sound = "blocked";
      else if (next.phase === "closed") sound = "exit";
    }
    if (sound) playSignal(sound);

    /* 말. 알림음이 "됐다 / 안 됐다"라면 말은 "그래서 이제 무엇을 하면 되는가"입니다. */
    const line = voiceFor(prev, next);
    if (line) say(line, sound ? VOICE_AFTER_BEEP_MS : 0);

    setStatus(next);
  }, [gateId, task.requestId]);

  const phaseNow = status.phase;
  useEffect(() => {
    if (paused || phaseNow === "closed") return;
    const active = Date.now() - changedAt < ACTIVE_WINDOW_MS;
    const every =
      phaseNow === "working"
        ? POLL_WORKING_MS
        : active
          ? POLL_ACTIVE_MS
          : POLL_READY_MS;
    const t = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - changedAt > IDLE_STOP_MS) {
        setPaused(true);
        return;
      }
      void refresh();
    }, every);
    /* 빠른 주기는 조용해지면 풀려야 합니다. 주기를 고르는 건 이 effect 가 다시
       돌 때뿐이라, 30초 뒤에 한 번 깨워 느린 주기로 갈아탑니다. */
    const calm = active
      ? setTimeout(() => setChangedAt((c) => c - 1), ACTIVE_WINDOW_MS)
      : null;
    return () => {
      clearInterval(t);
      if (calm) clearTimeout(calm);
    };
  }, [refresh, phaseNow, paused, changedAt]);

  async function enableSound() {
    const ok = await unlockSound();
    setSoundOn(ok);
    if (!ok) return;
    // 켜졌다는 것을 바로 알 수 있게, 지금 할 일을 말합니다. 말할 것이 없는
    // 단계(작업 중)에서는 짧은 알림음으로 대신합니다.
    const line = promptFor(status);
    if (line) say(line);
    else playSignal("card_ok");
  }

  async function resume() {
    setChangedAt(Date.now());
    setPaused(false);
    await refresh();
  }

  async function post(path: string, body: unknown) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/kiosk/${gateId}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(j?.error ?? "처리하지 못했어요.");
    }
    await refresh();
    setBusy(false);
    setConfirmEnd(false);
  }

  /* ── 사원증 리더 ────────────────────────────────────────────────────────
     현장의 USB 리더는 **키보드처럼** 동작합니다. 카드를 대면 번호를 빠르게 치고
     Enter 를 누릅니다. 입력 칸을 따로 두지 않고 화면 어디서든 받습니다 — 장갑 낀
     손으로 칸을 먼저 눌러야 한다면 아무도 누르지 않습니다. */
  const tagBusy = useRef(false);
  const onCard = useCallback(
    async (uid: string) => {
      const now = prevRef.current;
      if (now.phase !== "ready" || tagBusy.current) return;
      if (now.step === "unlocking") {
        setError("문이 열려 있어요. 들어가세요.");
        return;
      }
      if ((now.step ?? "tagging") !== "tagging") {
        setError("앞 사람 확인이 끝난 뒤에 사원증을 대주세요.");
        return;
      }
      tagBusy.current = true;
      setError(null);
      const res = await fetch(`/api/kiosk/${gateId}/tag`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId: task.requestId, cardUid: uid }),
      }).catch(() => null);
      if (!res?.ok) {
        const j = (await res?.json().catch(() => null)) as { error?: string } | null;
        setError(j?.error ?? "사원증을 확인하지 못했어요. 다시 대주세요.");
      }
      // 결과(얼굴 확인으로 넘어감 · 막힘)는 상태를 다시 읽어 화면과 소리로 알립니다.
      await refresh();
      tagBusy.current = false;
    },
    [gateId, task.requestId, refresh],
  );

  useEffect(() => {
    const typed = { text: "", first: 0, last: 0 };
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const now = performance.now();
      if (e.key === "Enter" || e.code === "NumpadEnter") {
        const uid = typed.text;
        typed.text = "";
        const fromReader =
          uid.length >= 4 && now - typed.first <= uid.length * READER_MS_PER_CHAR + 100;
        if (!fromReader) return;
        // 버튼에 초점이 가 있으면 리더의 Enter 가 그 버튼을 누릅니다 (「작업 종료」 등).
        e.preventDefault();
        e.stopPropagation();
        void onCard(uid);
        return;
      }
      const ch = charOfKey(e.code);
      if (!ch) return; // Shift 같은 보조 키는 흐름을 끊지 않습니다
      if (now - typed.last > 300) {
        typed.text = "";
        typed.first = now;
      }
      typed.text = (typed.text + ch).slice(-32);
      typed.last = now;
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCard]);

  /* 다시 시도 = 이 게이트에서 이 작업을 다시 "검증할 작업"으로 올립니다.
     서버는 선택 시각보다 앞선 차단을 지난 시도로 보고 대기 화면을 돌려줍니다. */
  async function retry() {
    await post("select", { requestId: task.requestId });
  }

  const phase = status.phase;

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <span className={styles.eyebrow}>{siteName}</span>
        <h1 className={styles.title}>
          {task.code} {task.title}
        </h1>
      </div>

      <Steps phase={phase} step={status.step} blockedReason={status.blockedReason} />

      {phase === "ready" ? (
        <div className={`${styles.stage} ${status.step === "unlocking" ? styles.stageWorking : ""}`}>
          <span className={styles.stageIcon} aria-hidden="true">
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none">
              <rect x="2.5" y="5" width="19" height="14" rx="2.5" stroke="#8FB0FF" strokeWidth="1.6" />
              <path d="M2.5 9.5h19" stroke="#8FB0FF" strokeWidth="1.6" />
              <path d="M6 14.5h4" stroke="#8FB0FF" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </span>
          <span className={styles.stageTitle}>{STEP_TITLE[status.step ?? "tagging"]}</span>
          {/* 검증이 시작되면 서버가 정한 문구를 그대로 띄웁니다 — 기기와 화면이
              같은 말을 해야 합니다. 시작 전에는 무엇을 하면 되는지 안내합니다. */}
          {status.message && (status.tagged ?? 0) > 0 ? (
            <p className={styles.stageBody}>
              <strong>{status.message}</strong>
            </p>
          ) : (
            <p className={styles.stageBody}>
              한 명씩 사원증을 대고 카메라를 봐주세요. 얼굴과 보호구(
              {task.requiredPpe.join(", ")})를 확인합니다.{" "}
              <strong>{task.headcount}명이 모두 통과하면 문이 열려요.</strong>
            </p>
          )}
          {(status.tagged ?? 0) > 0 ? (
            <div className={styles.stats}>
              <span className={styles.stat}>
                <span className={styles.statValue}>{status.tagged}</span>
                <span className={styles.statLabel}>사원증 확인</span>
              </span>
              <span className={styles.stat}>
                <span className={styles.statValue}>
                  {status.verified ?? 0}/{status.required}
                </span>
                <span className={styles.statLabel}>검증 통과</span>
              </span>
              <span className={styles.stat}>
                <span className={styles.statValue}>
                  {status.entered}/{status.required}
                </span>
                <span className={styles.statLabel}>입장</span>
              </span>
            </div>
          ) : null}
          {status.members.length > 0 ? (
            <p className={styles.stageBody}>{status.members.join(" · ")}</p>
          ) : null}
          {!status.selected && (status.tagged ?? 0) === 0 ? (
            <p className={styles.stageWarn}>
              이 게이트에 선택된 작업이 바뀌었어요. 다시 고르려면 아래
              「다른 작업 고르기」를 눌러주세요.
            </p>
          ) : null}
        </div>
      ) : null}

      {phase === "blocked" ? (
        <div className={`${styles.stage} ${styles.stageBlocked}`}>
          <span className={styles.stageTitle}>입장이 막혔어요</span>
          <p className={styles.stageBody}>
            <strong>{status.blockedReason}</strong>
            <br />
            {status.members.length > 0 ? `${status.members.join(", ")} 님 · ` : ""}
            {status.blockedAtLabel}
          </p>
          <p className={styles.stageBody}>
            보호구를 갖추고 다시 시도하거나, 자격 문제라면 팀장에게 알려주세요.
            이 기록은 관제 화면에 올라갔어요.
          </p>
          <button type="button" className={styles.primary} onClick={retry} disabled={busy}>
            다시 시도
          </button>
        </div>
      ) : null}

      {phase === "working" ? (
        <div className={`${styles.stage} ${styles.stageWorking}`}>
          <span className={styles.stageTitle}>문이 열렸어요 · 작업 중</span>
          <div className={styles.stats}>
            <span className={styles.stat}>
              <span className={styles.statValue}>
                {status.entered}/{status.required}
              </span>
              <span className={styles.statLabel}>안에 있는 인원</span>
            </span>
            <span className={styles.stat}>
              <span className={`${styles.statValue} ${status.overtime ? styles.overtime : ""}`}>
                {status.elapsed}
              </span>
              <span className={styles.statLabel}>경과</span>
            </span>
            <span className={styles.stat}>
              <span className={styles.statValue}>{status.expectedEndLabel ?? "—"}</span>
              <span className={styles.statLabel}>예정 종료</span>
            </span>
          </div>
          <p className={styles.stageBody}>{status.members.join(" · ")}</p>

          {confirmEnd ? (
            <div className={styles.confirm}>
              <span>모두 나왔나요? 작업을 종료합니다.</span>
              <div className={styles.confirmRow}>
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => setConfirmEnd(false)}
                  disabled={busy}
                >
                  아니요
                </button>
                <button
                  type="button"
                  className={styles.primary}
                  onClick={() => post("end", { sessionId: status.sessionId })}
                  disabled={busy}
                >
                  네, 종료
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={styles.primary}
              onClick={() => setConfirmEnd(true)}
              disabled={busy}
            >
              작업 종료
            </button>
          )}
        </div>
      ) : null}

      {phase === "closed" ? (
        <div className={`${styles.stage} ${styles.stageClosed}`}>
          <span className={styles.stageTitle}>작업이 끝났어요</span>
          <p className={styles.stageBody}>
            {status.startedAtLabel} 시작 · {status.durationLabel} 걸렸어요.
            <br />
            다음 사람에게 전할 말은 웹 <strong>마이페이지 → 특이사항</strong>에
            남겨주세요.
          </p>
        </div>
      ) : null}

      {error ? <p className={styles.error}>{error}</p> : null}

      {/* 브라우저가 소리를 막고 있을 때만 보입니다. 한 번 누르면 풀립니다. */}
      {!soundOn && phase !== "closed" ? (
        <button type="button" className={styles.soundButton} onClick={enableSound}>
          소리 켜기 — 음성 안내와 알림음이 나와요
        </button>
      ) : null}

      {paused ? (
        <button type="button" className={styles.secondary} onClick={resume}>
          한동안 변화가 없어 확인을 멈췄어요 · 눌러서 다시 확인
        </button>
      ) : null}

      {/* 문 열림을 보여주는 3D 장면 (천호 님의 Unity 빌드) — **참고용이라 맨 아래**.

          이 화면에서 사람이 봐야 하는 것은 "지금 무엇을 하면 되는가"(사원증 ·
          얼굴 · 보호구 단계와 결과)입니다. 처음엔 장면을 단계 바로 아래에 뒀는데,
          그림이 화면 한가운데를 차지해 정작 할 일이 밀렸습니다. 장면은 서버가
          이미 내린 결과를 다시 보여주는 것이라 아래로 내렸습니다.

          단계별 화면(ready · blocked · working) **바깥**에 한 번만 둡니다.
          단계가 바뀔 때마다 새로 그리면 장면을 처음부터 다시 받아야 하고(약 11MB),
          걸어 들어가던 사람도 끊깁니다. 작업이 끝나면 내립니다. */}
      {phase !== "closed" ? (
        <div className={styles.reference}>
          <span className={styles.referenceLabel}>현장 모습 · 참고용</span>
          <GateSimulation
            bare
            state={
              phase === "working"
                ? "working"
                : phase === "blocked"
                  ? "blocked"
                  : status.step === "unlocking"
                    ? "unlocked"
                    : "verifying"
            }
            siteName={siteName}
            work={`${task.code} ${task.title}`}
            required={status.required}
            entered={status.entered}
            members={status.members}
            crew={status.crew}
            elapsed={status.elapsed ?? ""}
            progress={null}
          />
        </div>
      ) : null}

      <div className={styles.actions}>
        <Link href={`/kiosk/${gateId}`} className={styles.back}>
          {phase === "closed" ? "처음으로" : "다른 작업 고르기"}
        </Link>
      </div>
    </div>
  );
}

const STEP_LABELS = ["사원증", "얼굴", "보호구", "문 열림"];

/** 막힌 이유가 어느 단계에서 걸린 것인지. 자격·배정은 사원증을 찍는 순간
 *  서버가 판정하므로 1단계, 얼굴은 2단계, 보호구는 3단계입니다. */
function failedStep(reason: string | undefined): number {
  if (!reason) return 2;
  if (reason.includes("얼굴")) return 1;
  if (reason.includes("미착용") || reason.includes("보호구")) return 2;
  return 0;
}

/** 지금 어디까지 왔는지. 문 앞 단계(step)까지 반영합니다. */
function Steps({
  phase,
  step,
  blockedReason,
}: {
  phase: KioskStatus["phase"];
  step?: KioskStatus["step"];
  blockedReason?: string;
}) {
  const fail = phase === "blocked" ? failedStep(blockedReason) : -1;
  const byStep = { tagging: 1, face: 2, verifying: 3, unlocking: 4 } as const;
  const reached =
    phase === "working" || phase === "closed"
      ? 4
      : phase === "blocked"
        ? fail + 1
        : byStep[step ?? "tagging"];
  return (
    <ol className={styles.progress}>
      {STEP_LABELS.map((label, i) => (
        <li
          key={label}
          className={`${styles.progressStep} ${
            i < reached ? styles.progressDone : ""
          } ${i === fail ? styles.progressFail : ""}`}
        >
          <span className={styles.progressDot}>{i + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}
