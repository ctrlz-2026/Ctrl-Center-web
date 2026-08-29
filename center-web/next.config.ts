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
};

export default nextConfig;
