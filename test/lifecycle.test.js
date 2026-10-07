import test from "node:test";
import assert from "node:assert/strict";
import { classifyOutcome, verdictFor, nextStatus, isFailingVerdict } from "../src/core/lifecycle.js";

test("outcome: assert failure = bug-present, other failure = broken", () => {
  assert.equal(classifyOutcome({ ok: true }), "pass");
  assert.equal(classifyOutcome({ ok: false, failedStepType: "assert" }), "bug-present");
  assert.equal(classifyOutcome({ ok: false, failedStepType: "click" }), "broken");
});

test("verdicts", () => {
  assert.equal(verdictFor("open", "pass", true), "fixed");
  assert.equal(verdictFor("open", "pass", false), "unverified");
  assert.equal(verdictFor("open", "bug-present", true), "open");
  assert.equal(verdictFor("fixed", "pass", true), "ok");
  assert.equal(verdictFor("fixed", "bug-present", true), "regression");
  assert.equal(verdictFor("regressed", "bug-present", true), "regression");
  assert.equal(verdictFor("open", "broken", true), "broken");
  assert.equal(verdictFor("wontfix", "bug-present", true), "ignored");
});

test("automatic status changes", () => {
  assert.equal(nextStatus("open", "fixed"), "fixed");
  assert.equal(nextStatus("fixed", "regression"), "regressed");
  assert.equal(nextStatus("regressed", "fixed"), "fixed");
  assert.equal(nextStatus("open", "open"), null);
  assert.equal(nextStatus("fixed", "ok"), null);
});

test("failing verdicts for CI", () => {
  assert.ok(isFailingVerdict("regression"));
  assert.ok(isFailingVerdict("broken"));
  assert.ok(!isFailingVerdict("open"));
  assert.ok(isFailingVerdict("open", true));
  assert.ok(!isFailingVerdict("fixed", true));
});
