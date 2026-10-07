import { notFound } from "next/navigation";
import {
  loadKioskGate,
  loadKioskRequest,
  loadKioskStatus,
} from "@/lib/firebase/kiosk";
import { KioskLive } from "./KioskLive";

/* 진행 화면 — 작업을 고른 뒤부터 끝날 때까지 이 화면 하나로 갑니다.
 *
 *   사원증 대기 ─▶ (막힘 → 다시 시도) ─▶ 문 열림·작업 중 ─▶ 작업 종료
 *
 * 첫 상태는 서버에서 읽어 바로 그리고, 그 뒤로는 화면이 몇 초마다 물어봅니다
 * (/api/kiosk/{gateId}/status). 젯슨이 검증 결과를 올리면 이 화면이 따라
 * 바뀌는 구조입니다. */
export const dynamic = "force-dynamic";

export default async function KioskLivePage({
  params,
}: {
  params: Promise<{ gateId: string; requestId: string }>;
}) {
  const { gateId, requestId } = await params;
  const gate = await loadKioskGate(gateId);
  if (!gate) notFound();
  const task = await loadKioskRequest(gate.siteId, requestId);
  if (!task) notFound();

  const initial = await loadKioskStatus(gateId, gate.siteId, requestId);

  return (
    <KioskLive
      gateId={gateId}
      siteName={gate.siteName}
      task={task}
      initial={initial}
    />
  );
}
