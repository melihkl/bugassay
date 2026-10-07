import test from "node:test";
import assert from "node:assert/strict";
import { collapseSteps, sanitizeSteps } from "../src/core/steps.js";

test("collapse keeps the last value of consecutive input steps", () => {
  const out = collapseSteps([{ type: "input", selector: "#a", value: "h" }, { type: "input", selector: "#a", value: "hi" }]);
  assert.equal(out.length, 1);
  assert.equal(out[0].value, "hi");
});

test("sanitize drops unknown fields and fills selector", () => {
  const [s] = sanitizeSteps([{ type: "click", selectors: ["#a", "  ", ".b"], evil: "<script>" }]);
  assert.deepEqual(s, { type: "click", selectors: ["#a", ".b"], selector: "#a" });
});

test("sanitize rejects bad input", () => {
  assert.throws(() => sanitizeSteps([{ type: "nope" }]), /unknown step type/);
  assert.throws(() => sanitizeSteps([{ type: "click" }]), /needs a selector/);
  assert.throws(() => sanitizeSteps([{ type: "goto", url: "javascript:alert(1)" }]), /http/);
  assert.throws(() => sanitizeSteps([{ type: "wait", ms: -1 }]), /wait/);
  assert.throws(() => sanitizeSteps([{ type: "assert", kind: "text", selector: "#a", value: "" }]), /expected value/);
  assert.throws(() => sanitizeSteps("x"), /list/);
  assert.throws(() => sanitizeSteps(Array(501).fill({ type: "wait", ms: 1 })), /Too many/);
});

test("sanitize accepts every step type", () => {
  const ok = sanitizeSteps([
    { type: "goto", url: "https://a.b" }, { type: "navigate", url: "http://a.b/x" }, { type: "click", selector: "#a" },
    { type: "hover", selector: "#a" }, { type: "input", selector: "#a", value: "x" }, { type: "select", selector: "#a", value: "1" },
    { type: "check", selector: "#a", checked: false }, { type: "press", selector: "#a", key: "Enter" },
    { type: "assert", kind: "url", value: "/done" }, { type: "assert", kind: "visible", selector: "#a" }, { type: "wait", ms: 500, disabled: true },
  ]);
  assert.equal(ok.length, 11);
  assert.equal(ok[10].disabled, true);
});
