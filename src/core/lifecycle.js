// Bug lifecycle: how a replay result relates to the status of the recorded bug.
//
//  status    meaning
//  open       the bug is known and should still reproduce
//  fixed      the bug was fixed; the recording now guards against it coming back
//  regressed  a fixed bug came back
//  wontfix    ignored by replay --all
//
// A recording describes the CORRECT behaviour with checks (assertions):
// when every step and check passes, the bug is gone.

export const STATUSES = ["open", "fixed", "regressed", "wontfix"];

/** pass: everything ran. bug-present: a check failed. broken: a non-check step failed (script needs maintenance). */
export function classifyOutcome({ ok, failedStepType }) {
  if (ok) return "pass";
  return failedStepType === "assert" ? "bug-present" : "broken";
}

export function hasChecks(rec) {
  return (rec.steps || []).some((s) => s.type === "assert" && !s.disabled);
}

/** The meaning of one replay for a recording in a given status. */
export function verdictFor(status, outcome, checks) {
  const st = STATUSES.includes(status) ? status : "open";
  if (st === "wontfix") return "ignored";
  if (outcome === "broken") return "broken";
  if (outcome === "pass") {
    if (!checks) return "unverified"; // nothing proves the bug is gone
    return st === "fixed" ? "ok" : "fixed";
  }
  return st === "open" ? "open" : "regression";
}

export const VERDICT_LABELS = {
  ok: "OK",
  fixed: "FIXED",
  open: "STILL OPEN",
  regression: "REGRESSION",
  broken: "BROKEN",
  unverified: "UNVERIFIED",
  ignored: "IGNORED",
};

export const VERDICT_TEXT = {
  ok: "The guarded behaviour still works.",
  fixed: "All steps and checks pass: the bug no longer reproduces.",
  open: "The bug still reproduces (expected for an open bug).",
  regression: "A bug that was marked fixed reproduces again.",
  broken: "The recording could not run to its checks (selector or flow changed). Fix the steps.",
  unverified: "Steps pass, but the recording has no checks, so it cannot prove the bug is gone. Add a check.",
  ignored: "Status is wontfix.",
};

/** Status change implied by a verdict, or null. */
export function nextStatus(status, verdict) {
  if (status === "open" && verdict === "fixed") return "fixed";
  if (status === "fixed" && verdict === "regression") return "regressed";
  if (status === "regressed" && verdict === "fixed") return "fixed";
  return null;
}

/** Does this verdict fail a CI run? */
export function isFailingVerdict(verdict, strict = false) {
  return verdict === "regression" || verdict === "broken" || (strict && (verdict === "open" || verdict === "unverified"));
}

export function historyEntry(from, to, reason) {
  return { at: new Date().toISOString(), from: from ?? null, to, reason };
}
