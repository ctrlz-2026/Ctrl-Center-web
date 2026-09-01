import type { ReactNode } from "react";
import styles from "./layout.module.css";

/* 키오스크 셸.
 *
 * 웹 화면과 완전히 다른 껍데기입니다 — 상단 네비도, 로그인도 없습니다.
 * 현장 벽에 붙은 터치패드라 **한 화면에 한 가지 일만** 있고, 장갑 낀 손으로
 * 누르는 걸 전제로 터치 대상을 크게 잡습니다.
 *
 * 어두운 배경인 이유: 공장 조명 아래에서 흰 화면은 눈이 부시고, 화면이 켜져
 * 있는지 멀리서도 보여야 합니다. 이 색만 --ct-kiosk-surface 로 따로 있습니다. */
export default function KioskLayout({ children }: { children: ReactNode }) {
  return <div className={styles.shell}>{children}</div>;
}
