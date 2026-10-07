import type { KioskStatus } from "./kiosk-types";

/** No background requests while waiting for a card or after work starts. */
export function kioskPollInterval(status: KioskStatus, paused: boolean, idleMs: number) {
  if (paused || status.phase !== "ready" || idleMs >= 60_000) return null;
  return status.step === "face" || status.step === "verifying" || status.step === "unlocking"
    ? 5_000 : null;
}
