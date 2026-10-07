// Dashboard numbers, computed from the recordings and their run history.
import { hasChecks } from "./lifecycle.js";

const dayKey = (iso) => new Date(iso).toISOString().slice(0, 10);

/** Flaky = the last 10 outcomes flip at least twice (pass, fail, pass ...). */
export function isFlaky(outcomes) {
  const last = outcomes.slice(-10);
  let flips = 0;
  for (let i = 1; i < last.length; i++) if (last[i] !== last[i - 1]) flips++;
  return flips >= 2;
}

/**
 * @param items  [{ name, rec, runs }]  (runs = run history, oldest first)
 * @param opts   { days = 14, now = Date }
 */
export function computeStats(items, opts = {}) {
  const days = opts.days ?? 14;
  const now = opts.now ? new Date(opts.now) : new Date();

  const totals = { recordings: items.length, steps: 0, checks: 0, runs: 0, pass: 0, bugPresent: 0, broken: 0, fail: 0, passRate: null };
  const byStatus = { open: 0, fixed: 0, regressed: 0, wontfix: 0 };
  const byVerdict = { ok: 0, fixed: 0, open: 0, regression: 0, broken: 0, unverified: 0, ignored: 0, notRun: 0 };
  const rows = [];
  const recent = [];
  const flaky = [];

  const daily = [];
  const dayIndex = new Map();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10);
    dayIndex.set(d, daily.length);
    daily.push({ day: d, pass: 0, bugPresent: 0, broken: 0 });
  }

  for (const it of items) {
    const rec = it.rec;
    const runs = it.runs || [];
    const status = rec.status || "open";
    byStatus[status] = (byStatus[status] || 0) + 1;
    totals.steps += rec.steps.length;
    const checks = rec.steps.filter((s) => s.type === "assert" && !s.disabled).length;
    totals.checks += checks;

    let pass = 0;
    let bugPresent = 0;
    let broken = 0;
    let ms = 0;
    for (const r of runs) {
      if (r.outcome === "pass") pass++;
      else if (r.outcome === "bug-present") bugPresent++;
      else broken++;
      ms += r.ms || 0;
      const di = dayIndex.get(dayKey(r.at));
      if (di !== undefined) {
        const d = daily[di];
        if (r.outcome === "pass") d.pass++;
        else if (r.outcome === "bug-present") d.bugPresent++;
        else d.broken++;
      }
      recent.push({ name: it.name, label: rec.name || "", ...r });
    }
    totals.runs += runs.length;
    totals.pass += pass;
    totals.bugPresent += bugPresent;
    totals.broken += broken;

    const last = runs[runs.length - 1] || null;
    const lastVerdict = last ? last.verdict : "notRun";
    byVerdict[lastVerdict] = (byVerdict[lastVerdict] || 0) + 1;
    const outcomes = runs.map((r) => r.outcome);
    const isF = isFlaky(outcomes);
    if (isF) flaky.push(it.name);

    rows.push({
      name: it.name,
      label: rec.name || "",
      url: rec.url,
      createdAt: rec.createdAt || null,
      status,
      steps: rec.steps.length,
      checks,
      verifiable: hasChecks(rec),
      runs: runs.length,
      pass,
      fail: bugPresent + broken,
      passRate: runs.length ? Math.round((pass / runs.length) * 100) : null,
      avgMs: runs.length ? Math.round(ms / runs.length) : null,
      lastVerdict,
      lastOutcome: last ? last.outcome : null,
      lastAt: last ? last.at : null,
      lastPassed: last ? last.passed : null,
      lastTotal: last ? last.total : null,
      spark: outcomes.slice(-10),
      flaky: isF,
    });
  }
  totals.fail = totals.bugPresent + totals.broken;
  totals.passRate = totals.runs ? Math.round((totals.pass / totals.runs) * 100) : null;
  recent.sort((a, b) => (a.at < b.at ? 1 : -1));
  return { totals, byStatus, byVerdict, daily, rows, recent: recent.slice(0, 25), flaky };
}
