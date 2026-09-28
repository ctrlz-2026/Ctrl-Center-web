"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { KioskStatus } from "@/lib/kiosk-types";
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
const IDLE_STOP_MS = 20 * 60_000;

export function KioskLive({
  gateId,
  siteName,
  task,
  initial,
  simulation,
}: {
  gateId: string;
  siteName: string;
  task: Task;
  initial: KioskStatus;
  simulation: boolean;
}) {
  const [status, setStatus] = useState<KioskStatus>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);
  /* 마지막으로 상태가 바뀐 시각. 오래 안 바뀌면 폴링을 멈춥니다. */
  const [changedAt, setChangedAt] = useState(() => Date.now());
  const [paused, setPaused] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/kiosk/${gateId}/status?request=${task.requestId}`, {
      cache: "no-store",
    });
    if (!res.ok) return;
    const next = (await res.json()) as KioskStatus;
    setStatus((prev) => {
      if (prev.phase !== next.phase || prev.sessionId !== next.sessionId) {
        setChangedAt(Date.now());
      }
      return next;
    });
  }, [gateId, task.requestId]);

  const phaseNow = status.phase;
  useEffect(() => {
    if (paused || phaseNow === "closed") return;
    const every = phaseNow === "working" ? POLL_WORKING_MS : POLL_READY_MS;
    const t = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - changedAt > IDLE_STOP_MS) {
        setPaused(true);
        return;
      }
      void refresh();
    }, every);
    return () => clearInterval(t);
  }, [refresh, phaseNow, paused, changedAt]);

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

      <Steps phase={phase} blockedReason={status.blockedReason} />

      {phase === "ready" ? (
        <div className={styles.stage}>
          <span className={styles.stageIcon} aria-hidden="true">
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none">
              <rect x="2.5" y="5" width="19" height="14" rx="2.5" stroke="#8FB0FF" strokeWidth="1.6" />
              <path d="M2.5 9.5h19" stroke="#8FB0FF" strokeWidth="1.6" />
              <path d="M6 14.5h4" stroke="#8FB0FF" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </span>
          <span className={styles.stageTitle}>사원증을 대주세요</span>
          <p className={styles.stageBody}>
            한 명씩 사원증을 대고 카메라를 봐주세요. 얼굴과 보호구(
            {task.requiredPpe.join(", ")})를 확인합니다.{" "}
            <strong>{task.headcount}명이 모두 통과하면 문이 열려요.</strong>
          </p>
          {!status.selected && !simulation ? (
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
            {status.members.join(", ")} 님 · {status.blockedAtLabel}
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

      {paused ? (
        <button type="button" className={styles.secondary} onClick={resume}>
          한동안 변화가 없어 확인을 멈췄어요 · 눌러서 다시 확인
        </button>
      ) : null}

      {/* 젯슨 대역. KIOSK_SIMULATION=on 일 때만 보입니다. 실제 기기가 붙으면
          이 칸은 사라지고, 위 화면이 기기의 검증 결과를 따라 바뀝니다. */}
      {simulation && phase === "ready" ? (
        <div className={styles.sim}>
          <span className={styles.simLabel}>시연 모드 · 젯슨 대신 검증 결과 보내기</span>
          <div className={styles.simRow}>
            <button
              type="button"
              className={styles.simPass}
              onClick={() => post("simulate", { requestId: task.requestId, outcome: "pass" })}
              disabled={busy}
            >
              검증 통과 → 문 열기
            </button>
            <button
              type="button"
              className={styles.simBlock}
              onClick={() => post("simulate", { requestId: task.requestId, outcome: "block" })}
              disabled={busy}
            >
              보호구 미착용 → 차단
            </button>
          </div>
          <span className={styles.simHint}>
            자격은 서버가 실제로 확인해요 — 자격이 만료된 사람은 「검증 통과」를
            눌러도 막힙니다.
          </span>
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

/** 지금 어디까지 왔는지. */
function Steps({
  phase,
  blockedReason,
}: {
  phase: KioskStatus["phase"];
  blockedReason?: string;
}) {
  const fail = phase === "blocked" ? failedStep(blockedReason) : -1;
  const reached =
    phase === "working" || phase === "closed" ? 4 : phase === "blocked" ? fail + 1 : 1;
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
