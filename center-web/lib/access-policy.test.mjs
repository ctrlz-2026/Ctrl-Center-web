import { test } from "node:test";
import assert from "node:assert/strict";
import { entryAllowed } from "./entry-policy.ts";
import { kioskPollInterval } from "./kiosk-poll-policy.ts";
test("entry requires the person and the complete required crew to be verified", () => {
  assert.equal(entryAllowed(true, 1, 2), false);
  assert.equal(entryAllowed(false, 2, 2), false);
  assert.equal(entryAllowed(true, 2, 2), true);
  assert.equal(entryAllowed(true, 2, 0), false);
});
test("waiting, working, closed, blocked and paused do not poll", () => {
  for (const phase of ["working", "closed", "blocked"])
    assert.equal(kioskPollInterval({ phase, step: "face" }, false, 0), null);
  assert.equal(kioskPollInterval({ phase: "ready", step: "tagging" }, false, 0), null);
  assert.equal(kioskPollInterval({ phase: "ready", step: "face" }, true, 0), null);
});
test("active checks are bounded and stop on inactivity", () => {
  assert.equal(kioskPollInterval({ phase: "ready", step: "face" }, false, 0), 5000);
  assert.equal(kioskPollInterval({ phase: "ready", step: "face" }, false, 60000), null);
});
