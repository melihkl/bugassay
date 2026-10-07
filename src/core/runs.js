import fs from "node:fs/promises";
import path from "node:path";
import { readJson } from "./util.js";

export const MAX_RUNS = 100;

export async function readRuns(dir) {
  const r = await readJson(path.join(dir, "runs.json")).catch(() => []);
  return Array.isArray(r) ? r : [];
}

/** Append one replay result to the recording's run history (kept to the last MAX_RUNS). */
export async function appendRun(dir, run) {
  const runs = await readRuns(dir);
  runs.push(run);
  const kept = runs.slice(-MAX_RUNS);
  await fs.writeFile(path.join(dir, "runs.json"), JSON.stringify(kept, null, 2));
  return kept;
}
