"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CrewMember } from "@/lib/types";
import styles from "./GateSimulation.module.css";

/* ────────────────────────────────────────────────────────────────────────────
 * 게이트 3D 시뮬레이션 (천호 님의 Unity WebGL 빌드)
 *
 * 멘토링에서 "실제 문 대신 화면으로 열림·닫힘을 보여주는 것도 좋다"는 답을
 * 받았고, 그 화면을 천호 님이 Unity 로 만들었습니다. 빌드는
 * `public/safety-gate-3d/` 에 통째로 들어 있고, 여기서는 iframe 으로 띄운 뒤
 * **지금 상태를 알려주기만** 합니다.
 *
 * 누가 무엇을 맡는가
 *   - Unity : 문 · 작업장 · 작업자 아바타를 그리고 움직입니다. 판정하지 않습니다
 *   - 웹     : 인원 · 상태 · 이름 같은 글자 정보를 표시합니다
 *   - 서버   : 누가 통과했고 누가 들어갔는지 판정합니다 (관제 실시간 스트림으로 옴)
 *
 * 그래서 이 화면은 **재생기**입니다. 여기서 문이 열려 보인다고 실제 문이 열리는
 * 것이 아니고, 서버가 이미 내린 결과를 그림으로 보여줄 뿐입니다.
 *
 * 주고받는 방식 (천호 님 문서 Integration/WEB_DASHBOARD_EMBED.md)
 *   iframe → 웹   { channel, type: "ready" }              장면 준비 끝
 *   웹 → iframe   { channel, type: "set-state", payload } 지금 상태
 *   iframe → 웹   { channel, type: "error", message }     불러오기 실패
 *   같은 출처(origin)의 메시지만 주고받습니다.
 *
 * 빌드를 새로 받았을 때 — `public/safety-gate-3d/` 를 통째로 바꾸면 됩니다.
 * 메시지 형식이 그대로라면 이 파일은 고칠 필요가 없습니다.
 * ──────────────────────────────────────────────────────────────────────────── */

const CHANNEL = "safety-gate-3d";
const SRC = "/safety-gate-3d/index.html";

/** 장면에 있는 아바타 자리. **이 id 로 보낸 작업자만 그려집니다.**
 *
 *  천호 님 문서는 "안정적인 직원 ID 를 넘기라"고 하지만, 지금 빌드(3.0.1)는
 *  자리 세 개가 이 id 에 고정돼 있어 다른 값(사번 · 임의 문자열 · W009)은
 *  오류 없이 무시됩니다 — 문은 열리는데 사람만 안 보이는 식으로 나타납니다.
 *  실제로 값을 하나씩 바꿔 보내 확인한 결과입니다 (2026-10-06).
 *
 *  그래서 참여자를 **순서대로 이 자리에 앉힙니다.** 참여자 순서는 사원증을
 *  찍은 순서로 고정이라, 같은 사람은 작업 내내 같은 자리를 씁니다. */
const AVATAR_SLOTS = ["W001", "W002", "W003"] as const;
const MAX_AVATARS = AVATAR_SLOTS.length;

export interface GateSimulationProps {
  /** 관제 화면 상태. "waiting"(태그 대기) · "verifying" · "unlocked" · "working" */
  state: "waiting" | "verifying" | "unlocked" | "working" | "approved" | "blocked";
  siteName: string;
  /** "D 컨베이어 벨트 점검" */
  work: string;
  /** 작업에 필요한 최소 인원 */
  required: number;
  /** 지금 안에 들어가 있는 인원 */
  entered: number;
  /** 참여자 이름 (입장 순) */
  members: string[];
  /** 참여자별 위치. 없으면 members 와 entered 로 추정합니다. */
  crew?: CrewMember[];
  /** 경과 표시 ("38분") */
  elapsed: string;
  /** 경과 / 예상시간. 1 을 넘으면 초과. 예상시간이 없으면 null */
  progress: number | null;
  /** 장면만 그립니다. 참여자 목록과 안내 문구는 그리지 않습니다 — 키오스크처럼
   *  같은 정보를 화면이 이미 크게 보여주는 곳에서 씁니다. */
  bare?: boolean;
}

/** Unity 가 아는 작업 상태에 우리 상태를 맞춥니다. */
const SCENE_STATUS: Record<GateSimulationProps["state"], string> = {
  approved: "VERIFYING",
  waiting: "VERIFYING",
  verifying: "VERIFYING",
  blocked: "VERIFYING",
  unlocked: "READY",
  working: "WORKING",
};

const AVATAR_STATE = {
  out: "OUT",
  verified: "VERIFIED",
  in: "IN",
  blocked: "BLOCKED",
} as const;

const POSITION_LABEL: Record<CrewMember["position"], string> = {
  out: "검증 전",
  verified: "문 앞 대기",
  in: "작업 중",
  blocked: "차단",
};

type Load = "loading" | "ready" | "error";

export function GateSimulation(props: GateSimulationProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [load, setLoad] = useState<Load>("loading");
  const [error, setError] = useState("");

  const crew: CrewMember[] = useMemo(
    () =>
      props.crew ??
      props.members.map((name, i) => ({
        name,
        position: i < props.entered ? "in" : "out",
      })),
    [props.crew, props.members, props.entered],
  );

  /* 장면에 넘길 상태.

     문은 "검증 인원이 찼고 아직 다 안 들어간 동안"만 열려 보입니다 — 서버가
     unlock 을 답하는 조건과 같습니다. 전원이 들어가면 닫힙니다.

     아바타 id 는 사번이 아니라 **이 작업 안에서의 자리**(AVATAR_SLOTS)입니다.

     문자열로 만들어 두는 이유 — 관제 스트림은 다른 작업장이 바뀌어도 새 객체를
     내려보냅니다. 객체로 비교하면 그때마다 다시 보내게 되고, 장면이 진행 중인
     이동을 매번 다시 계산합니다. 내용이 실제로 바뀌었을 때만 보냅니다. */
  const message = useMemo(
    () =>
      JSON.stringify({
        workName: props.work,
        workplace: props.siteName,
        status: SCENE_STATUS[props.state],
        doorOpen: props.state === "unlocked",
        required: props.required,
        verified: crew.filter((c) => c.position === "in" || c.position === "verified")
          .length,
        entered: props.entered,
        workers: crew.slice(0, MAX_AVATARS).map((c, i) => ({
          id: AVATAR_SLOTS[i],
          name: c.name,
          state: AVATAR_STATE[c.position],
        })),
      }),
    [props.work, props.siteName, props.state, props.required, props.entered, crew],
  );

  // 장면이 준비됐다고 알려오면 그때부터 보냅니다. 그 전에 보낸 건 받을 곳이 없습니다.
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== frame.current?.contentWindow) return;
      if (event.data?.channel !== CHANNEL) return;
      if (event.data.type === "ready") setLoad("ready");
      if (event.data.type === "error") {
        setLoad("error");
        setError(String(event.data.message ?? ""));
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);

  /* 장면이 지금 각 자리를 어떤 상태로 알고 있는지. */
  const shown = useRef<Record<string, string> | null>(null);

  useEffect(() => {
    if (load !== "ready") return;
    type Scene = { status: string; doorOpen: boolean; workers: { id: string; state: string }[] };
    const target = JSON.parse(message) as Scene;
    const post = (payload: Scene) => {
      frame.current?.contentWindow?.postMessage(
        { channel: CHANNEL, type: "set-state", payload },
        window.location.origin,
      );
      shown.current = Object.fromEntries(payload.workers.map((w) => [w.id, w.state]));
    };

    /* 보고 있는 중에 "처음 보는 사람이 이미 안에 있다"는 결과가 오면 풀어서 재생합니다.

       젯슨이 판정할 때는 사원증 → 검증 → 입장이 차례로 와서 장면이 알아서
       걸어 들어갑니다. 그런데 키오스크 시연 버튼은 결과를 한 번에 냅니다 —
       "2명 모두 안에 있음". 그대로 넘기면 장면은 처음 보는 사람을 제자리에
       놓기만 해서, 문은 닫힌 채 사람이 안에 갑자기 나타납니다.

       그래서 문 앞에 먼저 세웠다가(문 열림) 잠시 뒤 실제 상태를 보냅니다.
       결과를 바꾸는 것이 아니라 **이미 난 결과를 보여주는 순서**만 정하는 것입니다.

       화면을 처음 열었을 때는 하지 않습니다 — 이미 작업 중인 현장을 열었는데
       사람들이 다시 걸어 들어가면 지금 막 들어간 것처럼 보입니다. */
    const seen = shown.current;
    const arriving = seen
      ? target.workers.filter((w) => w.state === "IN" && seen[w.id] === undefined)
      : [];
    if (arriving.length === 0) {
      post(target);
      return;
    }
    post({
      ...target,
      status: "READY",
      doorOpen: true,
      workers: target.workers.map((w) =>
        arriving.includes(w) ? { ...w, state: "VERIFIED" } : w,
      ),
    });
    const t = setTimeout(() => post(target), 1600);
    return () => clearTimeout(t);
  }, [message, load]);

  const more = crew.length - MAX_AVATARS;

  return (
    <div className={styles.wrap}>
      <div className={props.bare ? `${styles.scene} ${styles.sceneBare}` : styles.scene}>
        <iframe
          ref={frame}
          src={SRC}
          title="안전 출입 게이트 3D 시뮬레이션"
          className={styles.frame}
          allow="fullscreen"
        />
        {load === "error" ? (
          <div className={styles.overlay} role="alert">
            <strong>3D 화면을 불러오지 못했어요.</strong>
            <span>아래 참여자 위치는 그대로 맞아요. {error}</span>
          </div>
        ) : null}
      </div>

      {props.bare ? null : (
        <>
          {/* 장면은 그림만 그립니다. 누가 어디 있는지는 글자로 따로 적습니다 —
              3D 가 안 뜨는 기기에서도, 화면을 못 보는 사람에게도 같은 정보가 갑니다. */}
          <ul className={styles.crew} aria-label="참여자 위치">
            {crew.length === 0 ? (
              <li className={styles.none}>아직 사원증을 찍은 사람이 없어요.</li>
            ) : (
              crew.map((c, i) => (
                <li
                  key={`${c.name}-${i}`}
                  className={styles.person}
                  data-position={c.position}
                >
                  <span className={styles.dot} aria-hidden />
                  <span className={styles.name}>{c.name}</span>
                  <span className={styles.where}>{POSITION_LABEL[c.position]}</span>
                </li>
              ))
            )}
          </ul>

          <p className={styles.note}>
            서버가 판정한 결과를 그림으로 다시 보여주는 화면이에요. 여기서 문이 열려
            보여도 실제 문을 여닫지는 않아요.
            {more > 0
              ? ` 화면에는 ${MAX_AVATARS}명까지만 그려지고, 나머지 ${more}명은 위 목록에 있어요.`
              : ""}
          </p>
        </>
      )}
    </div>
  );
}
