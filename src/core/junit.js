// JUnit XML for CI systems. A known, still-open bug is reported as "skipped", not as a failure.
import { VERDICT_LABELS, VERDICT_TEXT, isFailingVerdict } from "./lifecycle.js";

const xml = (s) =>
  String(s ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** @param results [{ name, label, status, outcome, verdict, ms, error, passed, total }] */
export function toJUnit(results, { suite = "bugassay", strict = false } = {}) {
  let failures = 0;
  let errors = 0;
  let skipped = 0;
  let time = 0;
  const cases = results.map((r) => {
    time += (r.ms || 0) / 1000;
    const head = `<testcase classname="${xml(suite + "." + (r.status || "open"))}" name="${xml(r.label || r.name)}" time="${((r.ms || 0) / 1000).toFixed(3)}">`;
    const msg = `${VERDICT_LABELS[r.verdict] || r.verdict}: ${VERDICT_TEXT[r.verdict] || ""}`;
    const detail = [r.error, `steps ${r.passed ?? 0}/${r.total ?? 0}`].filter(Boolean).join("\n");
    if (r.verdict === "broken") {
      errors++;
      return `${head}<error message="${xml(msg)}">${xml(detail)}</error></testcase>`;
    }
    if (isFailingVerdict(r.verdict, strict)) {
      failures++;
      return `${head}<failure message="${xml(msg)}">${xml(detail)}</failure></testcase>`;
    }
    if (r.verdict === "open" || r.verdict === "ignored" || r.verdict === "unverified") {
      skipped++;
      return `${head}<skipped message="${xml(msg)}"/></testcase>`;
    }
    return `${head}</testcase>`;
  });
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites>\n` +
    `<testsuite name="${xml(suite)}" tests="${results.length}" failures="${failures}" errors="${errors}" skipped="${skipped}" time="${time.toFixed(3)}">\n` +
    cases.join("\n") +
    `\n</testsuite>\n</testsuites>\n`
  );
}
