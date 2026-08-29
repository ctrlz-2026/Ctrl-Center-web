import type { Metadata, Viewport } from "next";
import { SessionProvider } from "@/lib/session";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ctrl+Center · 안전 출입 관리",
  description:
    "작업 승인부터 게이트 안전검증, 작업이력·자격 관리까지 하나로 묶은 출입통제 웹입니다.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // 스펙상 웹 기준 폭은 1440 이고 라이트 전용입니다. 키오스크만 어둡고 그건
  // Jetson 쪽 별도 구현이라, 뷰어 테마가 어두워도 이 화면은 밝게 갑니다.
  colorScheme: "light",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko">
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
