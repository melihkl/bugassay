import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listRecordings, setStatus } from "../src/core/store.js";
import { appendRun, readRuns, MAX_RUNS } from "../src/core/runs.js";
import { selectRecordings, parseStatusFilter } from "../src/replay-all.js";

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bugassay-"));
  for (const [n, status] of [["2026-01-01-a", "open"], ["2026-01-02-b", "fixed"], ["2026-01-03-c", "wontfix"]]) {
    await fs.mkdir(path.join(root, n));
    await fs.writeFile(path.join(root, n, "bug.json"), JSON.stringify({ version: 4, status, name: n, steps: [{ type: "wait", ms: 1 }] }));
  }
  await fs.mkdir(path.join(root, "not-a-recording"));
  return root;
}

test("list ignores folders without bug.json, newest first", async () => {
  const root = await fixture();
  const all = await listRecordings(root);
  assert.deepEqual(all.map((r) => r.name), ["2026-01-03-c", "2026-01-02-b", "2026-01-01-a"]);
});

test("setStatus records history and rejects unknown statuses", async () => {
  const root = await fixture();
  const dir = path.join(root, "2026-01-01-a");
  await setStatus(dir, "fixed", "test");
  const rec = JSON.parse(await fs.readFile(path.join(dir, "bug.json"), "utf8"));
  assert.equal(rec.status, "fixed");
  assert.equal(rec.history.at(-1).to, "fixed");
  await assert.rejects(() => setStatus(dir, "nope"), /Status must be/);
});

test("run history is capped", async () => {
  const root = await fixture();
  const dir = path.join(root, "2026-01-01-a");
  for (let i = 0; i < MAX_RUNS + 5; i++) await appendRun(dir, { i });
  const runs = await readRuns(dir);
  assert.equal(runs.length, MAX_RUNS);
  assert.equal(runs.at(-1).i, MAX_RUNS + 4);
});

test("replay --all selection", async () => {
  const root = await fixture();
  const all = await listRecordings(root);
  assert.deepEqual(selectRecordings(all, {}).map((r) => r.name), ["2026-01-01-a", "2026-01-02-b"]);
  assert.equal(selectRecordings(all, { status: "all" }).length, 3);
  assert.deepEqual(selectRecordings(all, { filter: "-b" }).map((r) => r.name), ["2026-01-02-b"]);
  assert.throws(() => parseStatusFilter("bogus"), /Unknown status/);
});
