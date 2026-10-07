import test from "node:test";
import assert from "node:assert/strict";
import { computeStats, isFlaky } from "../src/core/stats.js";

const run = (at, outcome, verdict) => ({ at, ms: 1000, ok: outcome === "pass", outcome, verdict, passed: 1, total: 2 });
const rec = (status, steps = [{ type: "click" }, { type: "assert" }]) => ({ status, steps, name: "x", url: "http://a" });

test("flaky detection", () => {
  assert.ok(isFlaky(["pass", "bug-present", "pass"]));
  assert.ok(!isFlaky(["pass", "pass", "bug-present"]));
});

test("totals, per-recording rows and daily buckets", () => {
  const now = "2026-03-10T12:00:00Z";
  const items = [
    { name: "a", rec: rec("fixed"), runs: [run("2026-03-10T08:00:00Z", "pass", "ok"), run("2026-03-09T08:00:00Z", "bug-present", "regression")] },
    { name: "b", rec: rec("open"), runs: [run("2026-03-10T09:00:00Z", "broken", "broken")] },
    { name: "c", rec: rec("open"), runs: [] },
  ];
  const st = computeStats(items, { now });
  assert.equal(st.totals.recordings, 3);
  assert.equal(st.totals.runs, 3);
  assert.equal(st.totals.pass, 1);
  assert.equal(st.totals.fail, 2);
  assert.equal(st.totals.passRate, 33);
  assert.equal(st.byStatus.open, 2);
  assert.equal(st.byVerdict.notRun, 1);
  assert.equal(st.daily.length, 14);
  const d10 = st.daily.find((d) => d.day === "2026-03-10");
  assert.deepEqual([d10.pass, d10.bugPresent, d10.broken], [1, 0, 1]);
  const a = st.rows.find((r) => r.name === "a");
  assert.equal(a.pass, 1);
  assert.equal(a.fail, 1);
  assert.equal(a.passRate, 50);
  assert.equal(st.rows.find((r) => r.name === "c").passRate, null);
});
