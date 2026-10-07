import { test } from "node:test";
import assert from "node:assert/strict";
import { nextPersonNotice } from "./kiosk-next-person.ts";
import { kioskGuidance } from "./kiosk-guidance.ts";
const base = { phase: "ready", step: "tagging", required: 2, verified: 1, entered: 1 };
test("handoff after verification", () => {
  assert.match(nextPersonNotice(base).instruction, /다음 작업자/);
  assert.match(nextPersonNotice(base).progress, /추가 1명/);
});
test("initial waiting", () => assert.equal(nextPersonNotice({ ...base, verified: 0 }), null));
test("no handoff during active verification or unlocking", () => {
  for (const step of ["face", "verifying", "unlocking"])
    assert.equal(nextPersonNotice({ ...base, step }), null);
});
test("no handoff when blocked, finished, or crew is full", () => {
  for (const phase of ["blocked", "working", "closed"])
    assert.equal(nextPersonNotice({ ...base, phase }), null);
  assert.equal(nextPersonNotice({ ...base, verified: 2 }), null);
});
test("each step has a different action and completed-state description", () => {
  const guides = ["tagging", "face", "verifying", "unlocking"].map(step =>
    kioskGuidance({ ...base, verified: 0, step }));
  assert.equal(new Set(guides.map(g => g.title)).size, 4);
  assert.match(guides[1].action, /정면/);
  assert.match(guides[2].completed, /얼굴 확인 완료/);
  assert.match(guides[3].action, /입장/);
});
test("face, PPE, and qualification failures give appropriate next actions", () => {
  const blocked = blockedReason => kioskGuidance({ ...base, phase: "blocked", blockedReason });
  assert.match(blocked("얼굴 불일치").action, /본인/);
  assert.match(blocked("보호구 미착용").action, /착용/);
  assert.match(blocked("자격 미달").action, /안전관리자/);
});
test("working and closed clearly explain how to finish and move on", () => {
  assert.match(kioskGuidance({ ...base, phase: "working" }).action, /모두 나온/);
  assert.match(kioskGuidance({ ...base, phase: "closed" }).title, /종료 완료/);
});
