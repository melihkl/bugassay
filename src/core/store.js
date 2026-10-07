import fs from "node:fs/promises";
import path from "node:path";
import { ROOT } from "./config.js";
import { exists, readJson } from "./util.js";
import { STATUSES, historyEntry } from "./lifecycle.js";
import { readRuns } from "./runs.js";
import { computeStats } from "./stats.js";

/** Recordings, newest first. Each item: { name, dir, rec, replay, runs } */
export async function listRecordings(root = ROOT) {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  const dirs = entries
    .filter((e) => e.isDirectory())
    .sort((a, b) => b.name.localeCompare(a.name));
  for (const e of dirs) {
    const dir = path.join(root, e.name);
    const rec = await readJson(path.join(dir, "bug.json")).catch(() => null);
    if (!rec || !Array.isArray(rec.steps)) continue;
    const replay = await readJson(path.join(dir, "replay.json")).catch(() => null);
    const runs = await readRuns(dir);
    out.push({ name: e.name, dir, rec, replay, runs });
  }
  return out;
}

export async function loadStats(opts = {}, root = ROOT) {
  const all = await listRecordings(root);
  return computeStats(all, opts);
}

export const replayLabel = (r) => {
  if (!r.replay) return "not replayed";
  const v = r.runs && r.runs.length ? r.runs[r.runs.length - 1].verdict : null;
  return `${r.replay.ok ? "PASS" : "FAIL"}${v ? ` (${v})` : ""}`;
};

/** Read-modify-write of bug.json. `patch` is an object or a function(rec) that returns one. */
export async function updateRecording(dir, patch) {
  const file = path.join(dir, "bug.json");
  const rec = await readJson(file);
  const next = typeof patch === "function" ? patch(rec) : patch;
  const merged = { ...rec, ...next };
  await fs.writeFile(file, JSON.stringify(merged, null, 2));
  return merged;
}

export async function setStatus(dir, status, reason = "set manually") {
  if (!STATUSES.includes(status))
    throw new Error(`Status must be one of: ${STATUSES.join(", ")}`);
  return updateRecording(dir, (rec) => {
    const from = rec.status || "open";
    if (from === status) return {};
    return {
      status,
      history: [...(rec.history || []), historyEntry(from, status, reason)].slice(-50),
    };
  });
}

// Never asks anything. arg > config.json "replay" > "last".
// Accepts: "last", a number from `list`, a folder name / part of it, or a path.
export async function resolveRecordingDir(arg, cfg = {}, { quiet = false } = {}) {
  const want = arg || cfg.replay || "last";
  const say = (n) => {
    if (!quiet) console.log(`Recording: ${n}`);
  };
  const all = await listRecordings();
  if (/^(last|latest)$/i.test(want)) {
    if (!all.length) throw new Error("No recordings yet. Run: npx bugassay record");
    say(all[0].name);
    return all[0].dir;
  }
  const direct = path.resolve(want);
  if (await exists(path.join(direct, "bug.json"))) return direct;
  const inRoot = path.join(ROOT, want);
  if (await exists(path.join(inRoot, "bug.json"))) return inRoot;
  if (/^\d+$/.test(want) && all[Number(want) - 1]) {
    say(all[Number(want) - 1].name);
    return all[Number(want) - 1].dir;
  }
  const m = all.filter((r) => r.name.includes(want));
  if (m.length === 1) {
    say(m[0].name);
    return m[0].dir;
  }
  if (m.length > 1)
    throw new Error(`"${want}" matches ${m.length} recordings; be more specific.`);
  throw new Error(`Recording not found: ${want}`);
}
