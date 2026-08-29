import { redirect } from "next/navigation";

/** 진입점은 로그인입니다. 역할(작업자/팀장/관제)은 계정 속성에서 자동 판별하고
 *  사용자가 고르지 않으므로, 로그인 전에는 보여줄 화면이 없습니다. */
export default function Home() {
  redirect("/login");
}
