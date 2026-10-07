"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import styles from "../../../page.module.css";

/* 얼굴 · 보호구를 확인하는 동안 보여주는 카메라 화면.
 *
 * 사원증을 대고 나면 "카메라를 봐주세요"가 뜨는데, 자기가 어떻게 잡히는지 안
 * 보이면 어디에 서야 하는지 알 수 없습니다. 그래서 확인하는 동안에만 카메라
 * 화면을 띄웁니다. 이 컴포넌트는 얼굴 · 보호구 단계에서만 그려지고, 단계가 끝나
 * 사라지면서 연결과 카메라를 놓습니다.
 *
 * ── 화면을 어디서 가져오나 ───────────────────────────────────────────────
 *   1. **젯슨의 검증 프로그램이 내보내는 화면** (STREAM_URL, 같은 기기의
 *      127.0.0.1). 인식하면서 그린 그림(얼굴 박스 · 보호구 결과)이 그대로
 *      보입니다. 먼저 이쪽을 찾습니다.
 *   2. **이 기기의 카메라** (브라우저). 1번이 없을 때만.
 *
 * 1번을 먼저 찾는 이유 — 카메라는 보통 한 번에 한 프로그램만 쓸 수 있습니다.
 * 처음엔 브라우저가 바로 카메라를 켜게 했는데, 현장에서 검증 프로그램을 같이
 * 켜자 화면이 뜨지 않았습니다(검증 프로그램이 카메라를 잡고 있음). 카메라를
 * 나눠 쓰려고 다투는 대신, 카메라를 가진 쪽이 화면을 내보내고 여기서는 받아
 * 띄우기만 합니다.
 *
 * ── 얼굴 영상은 서버로 가지 않습니다 ─────────────────────────────────────
 * 어느 쪽이든 화면에 그리기만 합니다. 캡처하지 않고, 저장하지 않고, 보내지
 * 않습니다. 젯슨 화면은 그 기기 안(127.0.0.1)에서만 오갑니다. 얼굴을 알아보는
 * 것은 여전히 젯슨이고, 이 화면은 판정에 쓰이지 않습니다. */

const STREAM_URL =
  process.env.NEXT_PUBLIC_KIOSK_CAMERA_URL || "http://127.0.0.1:8090/stream.mjpg";
/** 젯슨 화면의 첫 장면이 이 시간 안에 안 오면 없는 것으로 봅니다. */
const STREAM_WAIT_MS = 2_000;

type Mode =
  | "checking" // 젯슨 화면이 오는지 보는 중
  | "stream" // 젯슨 화면
  | "device" // 이 기기의 카메라
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
  const [mode, setMode] = useState<Mode>("checking");
  const video = useRef<HTMLVideoElement>(null);
  const media = useRef<MediaStream | null>(null);
  const alive = useRef(true);
  const decided = useRef(false);
  // 주소 뒤에 시각을 붙여, 브라우저가 지난번에 실패한 결과를 다시 쓰지 않게 합니다.
  const [src] = useState(
    () => `${STREAM_URL}${STREAM_URL.includes("?") ? "&" : "?"}t=${Date.now()}`,
  );

  /** 젯슨 화면이 없을 때 이 기기의 카메라를 켭니다. */
  const openDevice = useCallback(async () => {
    if (decided.current) return;
    decided.current = true;
    try {
      const first = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 720 } },
        audio: false,
      });
      const stream = await preferColor(first).catch(() => first);
      if (!alive.current) {
        // 기다리는 사이 단계가 끝났습니다. 잡은 카메라를 바로 놓습니다.
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      media.current = stream;
      setMode("device");
    } catch (e) {
      if (!alive.current) return;
      setMode((e as { name?: string }).name === "NotAllowedError" ? "denied" : "failed");
    }
  }, []);

  /* 화면에서 빼는 것만으로는 브라우저가 연결을 바로 끊지 않습니다. 주소를 지워야
     끊깁니다 — 안 끊으면 사람이 바뀔 때마다 연결이 하나씩 쌓입니다.
     (함수를 고정해 두지 않으면 다시 그릴 때마다 끊었다 붙였다 합니다.) */
  const attachStream = useCallback(
    (node: HTMLImageElement | null) => {
      if (!node) return;
      if (!node.getAttribute("src")) node.src = src;
      return () => node.removeAttribute("src");
    },
    [src],
  );

  useEffect(() => {
    alive.current = true;
    decided.current = false;
    const wait = setTimeout(() => void openDevice(), STREAM_WAIT_MS);
    return () => {
      alive.current = false;
      clearTimeout(wait);
      // 단계가 끝나면 카메라를 놓습니다. 잡고 있으면 다른 프로그램이 못 엽니다.
      media.current?.getTracks().forEach((t) => t.stop());
      media.current = null;
    };
  }, [openDevice]);

  useEffect(() => {
    if (mode !== "device" || !video.current || !media.current) return;
    video.current.srcObject = media.current;
    void video.current.play().catch(() => undefined);
  }, [mode]);

  const showing = mode === "stream" || mode === "device";

  return (
    <div className={styles.camera}>
      {mode === "checking" || mode === "stream" ? (
        // 젯슨이 내보내는 MJPEG. 최적화(next/image)를 거치면 스트림이 끊깁니다.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={attachStream}
          src={src}
          alt="카메라 화면"
          className={
            mode === "stream"
              ? `${styles.cameraView} ${styles.cameraStream}`
              : styles.cameraProbe
          }
          onLoad={() => {
            if (decided.current) return;
            decided.current = true;
            setMode("stream");
          }}
          onError={() => void openDevice()}
        />
      ) : null}
      {mode === "device" ? (
        <video
          ref={video}
          className={styles.cameraView}
          muted
          playsInline
          aria-label="카메라 화면"
        />
      ) : null}

      {showing ? (
        <span className={styles.cameraNote}>이 화면은 저장되지 않아요</span>
      ) : (
        <>
          {fallback}
          {mode === "denied" ? (
            <span className={styles.cameraNote}>
              브라우저가 카메라를 막고 있어요. 주소창의 카메라 권한을 허용해 주세요.
            </span>
          ) : null}
          {mode === "failed" ? (
            <span className={styles.cameraNote}>
              카메라 화면을 띄우지 못했어요 (검증 프로그램이 화면을 내보내지 않고,
              카메라는 다른 프로그램이 쓰는 중). 확인은 그대로 진행돼요.
            </span>
          ) : null}
        </>
      )}
    </div>
  );
}
