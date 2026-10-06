import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 홈 디렉터리(C:\Users\bobok)에 package-lock.json 이 있어 Turbopack 이
  // 워크스페이스 루트를 거기로 추론합니다. 그대로 두면 홈 전체를 파일 감시
  // 대상으로 잡으므로 이 앱 폴더로 못박아 둡니다.
  turbopack: {
    root: path.join(__dirname),
  },

  // 개발 인디케이터 배지가 화면 좌하단을 가려 캡처마다 지워야 했습니다.
  // 이 프로젝트는 화면 캡처가 산출물의 일부라 아예 꺼둡니다.
  devIndicators: false,

  /* 게이트 3D 시뮬레이션(Unity WebGL, 천호 님 빌드)은 용량을 줄이려고 Brotli 로
     **미리 압축된 파일**(.br)로 옵니다. 서버가 "이건 압축된 것"이라고 알려주지
     않으면 브라우저는 압축된 바이트를 그대로 실행하려다 실패합니다.

     .wasm 은 Content-Type 도 맞아야 브라우저가 받으면서 바로 컴파일합니다
     (틀리면 다 받은 뒤에 컴파일해 첫 화면이 늦어집니다).

     vercel.json 이 아니라 여기 둔 이유 — 로컬 dev 와 배포가 같은 규칙을 쓰게
     하려는 것입니다. vercel.json 에만 두면 로컬에서는 끝까지 안 뜹니다. */
  async headers() {
    const br = { key: "Content-Encoding", value: "br" };
    const dir = "/safety-gate-3d/Build";
    return [
      {
        source: `${dir}/:file*.wasm.br`,
        headers: [br, { key: "Content-Type", value: "application/wasm" }],
      },
      {
        source: `${dir}/:file*.js.br`,
        headers: [br, { key: "Content-Type", value: "application/javascript" }],
      },
      {
        source: `${dir}/:file*.data.br`,
        headers: [br, { key: "Content-Type", value: "application/octet-stream" }],
      },
    ];
  },
};

export default nextConfig;
