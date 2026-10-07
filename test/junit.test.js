import test from "node:test";
import assert from "node:assert/strict";
import { toJUnit } from "../src/core/junit.js";

const r = (name, verdict, extra = {}) => ({ name, verdict, ms: 1500, passed: 1, total: 2, error: "boom <x>", ...extra });

test("JUnit maps verdicts", () => {
  const xml = toJUnit([r("a", "ok"), r("b", "regression"), r("c", "broken"), r("d", "open")], { suite: "s" });
  assert.match(xml, /<testsuite[^>]*tests="4"/);
  assert.match(xml, /failures="1"/);
  assert.match(xml, /errors="1"/);
  assert.match(xml, /skipped="1"/);
  assert.ok(!xml.includes("<x>"), "text is escaped");
});

test("strict makes open bugs fail", () => {
  assert.match(toJUnit([r("d", "open")], { strict: true }), /failures="1"/);
});
