"use client";

import { getFirebaseAuth } from "./firebase/client";

/* SSE 구독자.
 *
 * EventSource 를 쓰지 않은 이유: Authorization 헤더를 실을 수 없어서
 * 토큰을 쿼리스트링에 넣어야 하는데, 그러면 서버 접근 로그와 브라우저 히스토리에
 * ID 토큰이 남습니다. fetch 로 스트림을 직접 읽으면 헤더로 보낼 수 있습니다.
 *
 * 대신 EventSource 가 공짜로 해주던 자동 재연결을 직접 구현합니다. */

export type LiveStatus = "connecting" | "open" | "closed";

interface Options<T> {
  path: string;
  event: string;
  onData: (data: T) => void;
  onStatus: (status: LiveStatus) => void;
}

const MAX_BACKOFF_MS = 15_000;

export function subscribe<T>({ path, event, onData, onStatus }: Options<T>) {
  const abort = new AbortController();
  let attempt = 0;
  let stopped = false;

  async function connect() {
    if (stopped) return;
    onStatus("connecting");

    try {
      const token = await getFirebaseAuth()?.currentUser?.getIdToken();
      if (!token) throw new Error("no token");

      const res = await fetch(path, {
        headers: { authorization: `Bearer ${token}` },
        signal: abort.signal,
      });
      if (!res.ok || !res.body) throw new Error(String(res.status));

      onStatus("open");
      attempt = 0;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (!stopped) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE 프레임은 빈 줄로 구분됩니다. 마지막 조각은 아직 안 끝났을 수 있어
        // 버퍼에 남겨둡니다.
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
          let name = "message";
          const dataLines: string[] = [];
          for (const line of frame.split("\n")) {
            if (line.startsWith("event: ")) name = line.slice(7).trim();
            else if (line.startsWith("data: ")) dataLines.push(line.slice(6));
          }
          if (name !== event || dataLines.length === 0) continue;
          try {
            onData(JSON.parse(dataLines.join("\n")) as T);
          } catch {
            // 깨진 프레임은 버립니다. 다음 스냅샷이 곧 옵니다.
          }
        }
      }
    } catch (err) {
      if (abort.signal.aborted || stopped) return;
      void err;
    }

    if (stopped) return;
    onStatus("closed");

    // 지수 백오프. 서버가 잠깐 죽어도 재연결 폭주를 만들지 않습니다.
    attempt += 1;
    const wait = Math.min(1000 * 2 ** (attempt - 1), MAX_BACKOFF_MS);
    window.setTimeout(connect, wait);
  }

  void connect();

  return () => {
    stopped = true;
    abort.abort();
  };
}
