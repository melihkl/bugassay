import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input } from "node:process";
import { CONFIG_FILE, RECORDINGS_DIR, ROOT, browserLaunchOptions, detectBrowser, loadConfig, normalizeUrl, parseViewport, resolveBrowserPath, writeDefaultConfig } from "./core/config.js";
import { writeReport } from "./core/export.js";
import { listRecordings, loadStats, resolveRecordingDir, setStatus } from "./core/store.js";
import { STATUSES, VERDICT_LABELS } from "./core/lifecycle.js";
import { exists, openFile, readJson } from "./core/util.js";

export async function openReport(dir) {
  const f = path.join(dir, "report.html");
  if (!(await exists(f))) await writeReport(dir);
  console.log(`Opening ${f}`);
  openFile(f);
}

export async function showList() {
  const { rows } = await loadStats();
  if (!rows.length) return console.log("No recordings yet.");
  const w = Math.max(9, ...rows.map((r) => r.name.length));
  console.log(` #  ${"Recording".padEnd(w)}  ${"Status".padEnd(9)}  Steps  Pass/Fail  Last result`);
  rows.forEach((r, i) =>
    console.log(
      `${String(i + 1).padStart(2)}  ${r.name.padEnd(w)}  ${r.status.padEnd(9)}  ${String(r.steps).padEnd(5)}  ${`${r.pass}/${r.fail}`.padEnd(9)}  ${r.runs ? VERDICT_LABELS[r.lastVerdict] || r.lastVerdict : "not replayed"}${r.flaky ? "  (flaky)" : ""}`,
    ),
  );
  console.log("\nTip: bugassay replay 1   |   bugassay replay --all   |   bugassay stats");
}

export async function statsCmd(opts = {}) {
  const st = await loadStats();
  if (opts.json) return console.log(JSON.stringify(st, null, 2));
  const t = st.totals;
  console.log(`Recordings: ${t.recordings}   Runs: ${t.runs}   Pass: ${t.pass}   Fail: ${t.fail} (bug present ${t.bugPresent}, broken ${t.broken})   Pass rate: ${t.passRate === null ? "-" : t.passRate + "%"}`);
  console.log(`Status:     ${STATUSES.map((s) => `${s} ${st.byStatus[s] || 0}`).join("   ")}`);
  if (st.flaky.length) console.log(`Flaky:      ${st.flaky.join(", ")}`);
  if (!st.rows.length) return;
  const w = Math.max(9, ...st.rows.map((r) => r.name.length));
  console.log(`\n${"Recording".padEnd(w)}  ${"Status".padEnd(9)}  Runs  Pass  Fail  Rate  Avg     Last`);
  for (const r of st.rows)
    console.log(
      `${r.name.padEnd(w)}  ${r.status.padEnd(9)}  ${String(r.runs).padEnd(4)}  ${String(r.pass).padEnd(4)}  ${String(r.fail).padEnd(4)}  ${(r.passRate === null ? "-" : r.passRate + "%").padEnd(4)}  ${(r.avgMs === null ? "-" : (r.avgMs / 1000).toFixed(1) + "s").padEnd(6)}  ${r.runs ? VERDICT_LABELS[r.lastVerdict] : "-"}`,
    );
}

export async function statusCmd(recording, status) {
  const { cfg } = await loadConfig();
  const dir = await resolveRecordingDir(recording, cfg, { quiet: true });
  if (!status) {
    const rec = await readJson(path.join(dir, "bug.json"));
    console.log(`${path.basename(dir)}: ${rec.status || "open"}`);
    for (const h of (rec.history || []).slice(-10)) console.log(`  ${h.at}  ${h.from || "-"} -> ${h.to}  (${h.reason})`);
    return;
  }
  await setStatus(dir, status, "set manually (cli)");
  console.log(`${path.basename(dir)}: status is now ${status}`);
}

export async function doctor() {
  const { cfg, created } = await loadConfig();
  const major = Number(process.versions.node.split(".")[0]);
  console.log(`Node.js:           ${process.version} ${major >= 20 ? "OK" : "(needs >= 20)"}`);
  console.log(`config.json:       ${CONFIG_FILE}${created ? " (just created with defaults)" : ""}`);
  console.log(`  url:             ${cfg.url}`);
  console.log(
    `  browserPath:     ${cfg.browserPath ? `${cfg.browserPath} ${(await exists(cfg.browserPath)) ? "OK" : "(NOT FOUND!)"}` : "(empty: Playwright Chromium)"}`,
  );
  console.log(`  delay:           ${cfg.delay} ms`);
  console.log(`  typingDelay:     ${cfg.typingDelay} ms`);
  console.log(`  replay:          ${cfg.replay}`);
  console.log(`  autoStatus:      ${cfg.autoStatus !== false} (replay moves open->fixed and fixed->regressed by itself)`);
  console.log(`  hoverMs:         ${cfg.hoverMs} (0 = hover recording off)`);
  console.log(`  hoverWait:       ${cfg.hoverWait} ms`);
  console.log(`  session:         ${cfg.session ? `${cfg.session} ${(await exists(path.resolve(String(cfg.session)))) ? "(saved)" : "(not saved yet: npx bugassay login)"}` : "off"}`);
  console.log(`  video:           ${cfg.video} (needs ffmpeg: npx playwright install ffmpeg)`);
  let bundled = null;
  try {
    bundled = chromium.executablePath();
  } catch {
    /* ignore */
  }
  const hasBundled = bundled && (await exists(bundled));
  console.log(
    `Playwright Chromium: ${hasBundled ? "installed" : "not installed (npx playwright install chromium)"}`,
  );
  const det = await detectBrowser();
  if (det && !cfg.browserPath && !hasBundled)
    console.log(`Hint: Chrome/Edge found. Put this in config.json -> "browserPath":\n  ${det}`);
  console.log(`Recordings:        ${ROOT} (${(await listRecordings()).length})`);
  console.log(`  recordingsDir:   ${RECORDINGS_DIR}`);
}

export async function configCmd(opts = {}) {
  if (opts.reset) {
    await writeDefaultConfig();
    console.log(`config.json reset to defaults: ${CONFIG_FILE}`);
    return;
  }
  const { created } = await loadConfig();
  console.log(`${CONFIG_FILE}${created ? " (created)" : ""}`);
  console.log(await fs.readFile(CONFIG_FILE, "utf8"));
}

export async function loginCmd(opts = {}) {
  const { cfg } = await loadConfig();
  const url = normalizeUrl(opts.url || cfg.url);
  const file = path.resolve(String(cfg.session || "session.json"));
  const browserPath = await resolveBrowserPath(opts, cfg);
  const browser = await chromium.launch(browserLaunchOptions(browserPath));
  const context = await browser.newContext({ viewport: parseViewport(cfg.viewport) });
  const page = await context.newPage();
  let busy = false;
  const save = async () => {
    if (busy) return;
    busy = true;
    await context.storageState({ path: file }).catch(() => {});
    busy = false;
  };
  const timer = setInterval(save, 1500);
  const closed = new Promise((res) => browser.on("disconnected", res));
  const rl = readline.createInterface({ input });
  rl.once("line", async () => {
    await save();
    await browser.close().catch(() => {});
  });
  console.log(`Log in in the browser window, then CLOSE the window (or press ENTER here).`);
  console.log(`The session will be saved to: ${file}\n`);
  await page.goto(url, { waitUntil: "domcontentloaded" }).catch((e) =>
    console.log(`Could not open ${url}: ${e.message.split("\n")[0]}`),
  );
  await closed;
  clearInterval(timer);
  rl.close();
  const st = await readJson(file).catch(() => null);
  if (!st || (!st.cookies?.length && !st.origins?.length))
    console.log("Warning: no cookies or local storage were captured. Did you log in?");
  else
    console.log(
      `Session saved (${st.cookies.length} cookies, ${st.origins.length} origins).\nKeep ${path.basename(file)} private and do not commit it. It lets anyone act as this user.`,
    );
  console.log("record and replay will now start already logged in.");
}
