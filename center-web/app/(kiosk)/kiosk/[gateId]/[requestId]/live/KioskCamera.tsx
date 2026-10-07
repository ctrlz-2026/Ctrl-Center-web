"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import styles from "../../../page.module.css";

/* 얼굴 · 보호구를 확인하는 동안 보여주는 카메라 화면.
 *
 * 사원증을 대고 나면 "카메라를 봐주세요"가 뜨는데, 자기가 어떻게 잡히는지 안
 * 보이면 어디에 서야 하는지 알 수 없습니다. 그래서 확인하는 동안에만 이 기기의
 * 카메라를 켜서 보여줍니다. 이 컴포넌트는 얼굴 · 보호구 단계에서만 그려지고,
 * 단계가 끝나 사라지면서 카메라를 놓습니다.
 *
 * **미리보기일 뿐입니다.** 얼굴을 알아보는 것은 여전히 젯슨의 검증 프로그램이고,
 * 이 화면은 판정에 쓰이지 않습니다. 영상은 화면에 그리기만 합니다 — 캡처하지
 * 않고, 저장하지 않고, 서버로 보내지 않습니다.
 *
 * 주의 — 카메라는 보통 한 번에 한 프로그램만 쓸 수 있습니다. 젯슨의 검증
 * 프로그램이 이미 카메라를 잡고 있으면 여기서는 못 열고(아래 "failed"), 반대로
 * 여기가 먼저 잡으면 검증 프로그램이 못 열 수 있습니다. 그래서 확인하는 단계
 * 동안만 잡고 끝나면 바로 놓습니다. 같이 쓰기 어렵다고 확인되면, 젯슨이 인식
 * 화면을 내보내고 여기서는 그걸 받아 띄우는 쪽으로 바꿔야 합니다. */

type Mode =
  | "starting"
  | "on"
  | "denied" // 브라우저가 카메라 권한을 안 줌
  | "failed"; // 카메라가 없거나 다른 프로그램이 쓰는 중

/** 깊이 카메라(RealSense)는 컬러 · 적외선 · 깊이가 각각 다른 카메라로 잡힙니다.
 *  브라우저가 적외선 쪽을 먼저 고르면 흑백 얼룩이 나오므로 컬러를 찾아 씁니다. */
async function preferColor(stream: MediaStream): Promise<MediaStream> {
  const now = stream.getVideoTracks()[0];
  if (!now || /rgb|color/i.test(now.label)) return stream;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const color = devices.find((d) => d.kind === "videoinput" && /rgb|color/i.test(d.label));
  if (!color || color.deviceId === now.getSettings().deviceId) return stream;
  stream.getTracks().forEach((t) => t.stop());
  return navigator.mediaDevices.getUserMedia({
    video: { deviceId: { exact: color.deviceId } },
    audio: false,
  });
}

export function KioskCamera({ fallback }: { fallback: ReactNode }) {
  const [mode, setMode] = useState<Mode>("starting");
  const video = useRef<HTMLVideoElement>(null);
  const media = useRef<MediaStream | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const first = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 720 } },
          audio: false,
        });
        const stream = await preferColor(first).catch(() => first);
        if (!alive) {
          // 기다리는 사이 단계가 끝났습니다. 잡은 카메라를 바로 놓습니다.
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        media.current = stream;
        setMode("on");
      } catch (e) {
        if (!alive) return;
        setMode((e as { name?: string }).name === "NotAllowedError" ? "denied" : "failed");
      }
    })();
    return () => {
      alive = false;
      // 단계가 끝나면 카메라를 놓습니다. 잡고 있으면 다른 프로그램이 못 엽니다.
      media.current?.getTracks().forEach((t) => t.stop());
      media.current = null;
    };
  }, []);

  useEffect(() => {
    if (mode !== "on" || !video.current || !media.current) return;
    video.current.srcObject = media.current;
    void video.current.play().catch(() => undefined);
  }, [mode]);

  if (mode === "on") {
    return (
      <div className={styles.camera}>
        <video
          ref={video}
          className={styles.cameraView}
          muted
          playsInline
          aria-label="카메라 화면"
        />
        <span className={styles.cameraNote}>이 화면은 저장되지 않아요</span>
      </div>
    );
  }

  return (
    <div className={styles.camera}>
      {fallback}
      {mode === "denied" ? (
        <span className={styles.cameraNote}>
          브라우저가 카메라를 막고 있어요. 주소창의 카메라 권한을 허용해 주세요.
        </span>
      ) : null}
      {mode === "failed" ? (
        <span className={styles.cameraNote}>
          카메라를 화면에 띄우지 못했어요 (없거나 다른 프로그램이 쓰는 중). 확인은
          그대로 진행돼요.
        </span>
      ) : null}
    </div>
  );
}
