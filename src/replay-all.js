import fs from "node:fs/promises";
import path from "node:path";
import { listRecordings } from "./core/store.js";
import { STATUSES, VERDICT_LABELS, isFailingVerdict } from "./core/lifecycle.js";
import { appendRun } from "./core/runs.js";
import { toJUnit } from "./core/junit.js";
import { nowIso } from "./core/util.js";
import { replay } from "./replay.js";

const DEFAULT_STATUSES = ["open", "fixed", "regressed"];

export function parseStatusFilter(v) {
  if (!v) return DEFAULT_STATUSES;
  const list = String(v).split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (list.includes("all")) return [...STATUSES];
  for (const s of list)
    if (!STATUSES.includes(s)) throw new Error(`Unknown status "${s}". Use: ${STATUSES.join(", ")}, all`);
  return list;
}

export function selectRecordings(all, { status, filter } = {}) {
  const allowed = parseStatusFilter(status);
  const f = filter ? String(filter).toLowerCase() : "";
  return all
    .filter((r) => allowed.includes(r.rec.status || "open"))
    .filter((r) => !f || r.name.toLowerCase().includes(f) || String(r.rec.name || "").toLowerCase().includes(f))
    .reverse(); // oldest first: stable, chronological order
}

const fmtMs = (ms) => (ms >= 10000 ? `${Math.round(ms / 1000)}s` : `${(ms / 1000).toFixed(1)}s`);

/**
 * Replay many recordings. Returns { results, counts, exitCode }.
 * opts: status, filter, parallel, bail, headed, strict, verbose, junit, json, + replay options.
 */
export async function replayAll(opts = {}) {
  const parallel = Math.max(1, Math.min(8, Number(opts.parallel) || 1));
  const list = selectRecordings(await listRecordings(), opts);
  if (!list.length) {
    console.log("No recordings match. (Default: status open, fixed, regressed. Use --status all to include wontfix.)");
    return { results: [], counts: {}, exitCode: 0 };
  }
  const results = new Array(list.length);
  const strict = Boolean(opts.strict);
  let next = 0;
  let bailed = false;
  let done = 0;
  const passthrough = {
    delay: opts.delay,
    typingDelay: opts.typingDelay,
    timeout: opts.timeout,
    video: opts.video,
    browserPath: opts.browserPath,
    autoStatus: opts.autoStatus,
    headless: opts.headed ? false : true,
  };

  console.log(`Replaying ${list.length} recording${list.length === 1 ? "" : "s"}${parallel > 1 ? ` (${parallel} in parallel)` : ""}...\n`);

  const runOne = async (item) => {
    const lines = [];
    const started = Date.now();
    if (parallel === 1) console.log(`▶ ${item.name}`);
    try {
      return await replay(item.dir, { ...passthrough, log: (l) => lines.push(l) });
    } catch (e) {
      const ms = Date.now() - started;
      lines.push(`✗ ${e.message.split("\n")[0]}`);
      await appendRun(item.dir, {
        at: nowIso(), ms, ok: false, outcome: "broken", verdict: "broken",
        status: item.rec.status || "open", passed: 0, total: item.rec.steps.length,
        failedStep: null, error: e.message.split("\n")[0],
      }).catch(() => {});
      return {
        name: item.name, label: item.rec.name || "", ok: false, outcome: "broken", verdict: "broken",
        status: item.rec.status || "open", previousStatus: item.rec.status || "open",
        passed: 0, total: item.rec.steps.length, failedStep: null, ms, error: e.message.split("\n")[0],
      };
    } finally {
      item.lines = lines;
    }
  };

  const worker = async () => {
    for (;;) {
      if (bailed) return;
      const i = next++;
      if (i >= list.length) return;
      const r = await runOne(list[i]);
      results[i] = r;
      done++;
      const failing = isFailingVerdict(r.verdict, strict);
      console.log(
        `${failing ? "✗" : "✓"} [${done}/${list.length}] ${r.name}  ${VERDICT_LABELS[r.verdict]}  ${r.passed}/${r.total} steps  ${fmtMs(r.ms)}`,
      );
      if (failing || opts.verbose)
        for (const l of list[i].lines) if (l.trim()) console.log(`    ${l.replace(/\n/g, "\n    ")}`);
      if (failing && opts.bail) bailed = true;
    }
  };
  await Promise.all(Array.from({ length: Math.min(parallel, list.length) }, worker));

  const finished = results.filter(Boolean);
  const counts = {};
  for (const r of finished) counts[r.verdict] = (counts[r.verdict] || 0) + 1;
  const failing = finished.filter((r) => isFailingVerdict(r.verdict, strict));
  const exitCode = failing.length ? 1 : 0;

  // summary table
  const w = Math.max(9, ...finished.map((r) => r.name.length));
  console.log(`\n${"Recording".padEnd(w)}  ${"Status".padEnd(9)}  ${"Verdict".padEnd(11)}  Steps  Time`);
  for (const r of finished)
    console.log(
      `${r.name.padEnd(w)}  ${(r.status + (r.status !== r.previousStatus ? "*" : "")).padEnd(9)}  ${VERDICT_LABELS[r.verdict].padEnd(11)}  ${`${r.passed}/${r.total}`.padEnd(5)}  ${fmtMs(r.ms)}`,
    );
  const parts = Object.entries(counts).map(([v, n]) => `${n} ${VERDICT_LABELS[v].toLowerCase()}`);
  console.log(`\n${finished.length} recordings: ${parts.join(", ")}`);
  if (finished.some((r) => r.status !== r.previousStatus)) console.log("* status changed during this run");
  if (bailed) console.log(`Stopped early (--bail): ${list.length - finished.length} not run.`);
  console.log(exitCode ? `\nFAILED: ${failing.length} recording(s) need attention.` : "\nOK: no regressions and nothing broken.");

  if (opts.junit) {
    const f = path.resolve(opts.junit);
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f, toJUnit(finished, { strict }));
    console.log(`JUnit: ${f}`);
  }
  if (opts.json) {
    const f = path.resolve(opts.json);
    await fs.mkdir(path.dirname(f), { recursive: true });
    await fs.writeFile(f, JSON.stringify({ at: nowIso(), total: finished.length, counts, exitCode, results: finished }, null, 2));
    console.log(`JSON: ${f}`);
  }
  return { results: finished, counts, exitCode };
}
