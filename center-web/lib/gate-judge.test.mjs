import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { entryAllowed } from "./entry-policy.ts";

// Execute the actual judge with an in-memory Firestore adapter. No cloud calls.
function fixture() {
  const docs = new Map([
    ["kioskContexts/gate-c0", { approvalRequestId: "req1" }],
    ["employeeCards/CARD1", { empNo: "123" }],
    ["employeeCards/CARD2", { empNo: "124" }],
  ]);
  let failCommit = false;
  const snapshot = key => ({ exists: docs.has(key), data: () => structuredClone(docs.get(key)) });
  const db = {
    collection: name => ({ doc: id => ({ id, key: `${name}/${id}`, get: async () => snapshot(`${name}/${id}`) }) }),
    runTransaction: async callback => {
      const writes = [];
      const result = await callback({
        get: async ref => snapshot(ref.key),
        set: (ref, value) => writes.push(() => docs.set(ref.key, { ...(docs.get(ref.key) ?? {}), ...value })),
        delete: ref => writes.push(() => docs.delete(ref.key)),
      });
      if (failCommit) throw new Error("fake commit failure");
      writes.forEach(write => write());
      return result;
    },
  };
  const masters = {
    workCodes: new Map([["K", { requiredHeadcount: 2, requiredPpe: ["helmet"], requiredQualifications: [] }]]),
    employees: new Map([["123", { name: "person1", active: true }], ["124", { name: "person2", active: true }]]),
    ppeYolo: new Map([["helmet", "helmet"]]), ppeNames: new Map([["helmet", "안전모"]]), qualNames: new Map(),
  };
  const exports = {};
  const source = fs.readFileSync(new URL("./firebase/gate-judge.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(compiled, { exports, require: name => {
    if (name === "server-only") return {};
    if (name === "./admin") return { adminDb: () => db };
    if (name === "./queries") return { loadMasters: async () => masters };
    if (name === "./user") return { qualificationStatus: () => ({ status: "valid" }) };
    if (name === "../entry-policy") return { entryAllowed };
    throw new Error(`unexpected dependency ${name}`);
  } });
  let seq = 0;
  const observe = async (kind, payload, key) => {
    const event = { kind, payload, idempotency_key: key ?? `event${++seq}`, occurred_at: "2026-10-07T10:00:00Z" };
    return exports.applyEvents({ gate_id: "gate-c0", approval_request_id: "req1" }, { siteId: "site1", workCode: "K" }, [event]);
  };
  const verifyPerson = async (emp, card) => {
    await observe("card_tag", { card_uid: card });
    await observe("face_match", { emp_no: emp, matched: true });
    return observe("ppe_check", { emp_no: emp, items: [{ code: "helmet", worn: true }] });
  };
  return { observe, verifyPerson, docs, fail: () => { failCommit = true; } };
}

test("PPE pass is verification only, and incomplete crew cannot enter", async () => {
  const f = fixture();
  const verified = await f.verifyPerson("123", "CARD1");
  assert.equal(verified.headcount.verified, 1);
  assert.equal(verified.headcount.entered, 0);
  const entry = await f.observe("entry", { emp_no: "123" });
  assert.equal(entry.headcount.entered, 0);
});
test("working starts only after both physical entry confirmations", async () => {
  const f = fixture();
  await f.verifyPerson("123", "CARD1");
  const unlocked = await f.verifyPerson("124", "CARD2");
  assert.equal(unlocked.unlock, true);
  const first = await f.observe("entry", { emp_no: "123" });
  assert.equal(first.state, "unlocking");
  const second = await f.observe("entry", { emp_no: "124" });
  assert.equal(second.state, "working");
  assert.equal(second.headcount.entered, 2);
});
test("duplicate receipts and late failed observations do not undo verification", async () => {
  const f = fixture();
  await f.observe("card_tag", { card_uid: "CARD1" });
  await f.observe("face_match", { emp_no: "123", matched: true }, "same-key");
  await f.observe("face_match", { emp_no: "123", matched: false }, "same-key");
  const result = await f.observe("ppe_check", { emp_no: "123", items: [{ code: "helmet", worn: true }] });
  assert.equal(result.headcount.verified, 1);
  const late = await f.observe("face_match", { emp_no: "123", matched: false });
  assert.equal(late.headcount.verified, 1);
  const tag = await f.observe("card_tag", { card_uid: "CARD1" });
  assert.equal(tag.last_verification.passed, true);
  assert.equal(tag.state, "tagging");
});
test("failed commit preserves the previous session", async () => {
  const f = fixture();
  await f.observe("card_tag", { card_uid: "CARD1" });
  const previous = structuredClone(f.docs.get("gateSessions/gate-c0__req1"));
  f.fail();
  await assert.rejects(f.observe("face_match", { emp_no: "123", matched: true }));
  assert.deepEqual(structuredClone(f.docs.get("gateSessions/gate-c0__req1")), previous);
});
test("closed sessions ignore delayed hardware events", async () => {
  const f = fixture();
  f.docs.set("gateSessions/gate-c0__req1", { state: "closed", headcount: { required: 2, entered: 0 } });
  const response = await f.observe("entry", { emp_no: "123" });
  assert.equal(response.state, "closed");
  assert.equal(response.unlock, false);
});
