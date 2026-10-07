import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { CONFIG_FILE, ROOT, browserLaunchOptions, loadConfig, normalizeUrl, parseViewport, resolveBrowserPath, sessionPath } from "./core/config.js";
import { generateArtifacts, writeReport } from "./core/export.js";
import { collapseSteps } from "./core/steps.js";
import { historyEntry } from "./core/lifecycle.js";
import { installRecorder } from "./page/recorder-page.js";
import { ensureDir, nowIso, openFile, safeName, toMs } from "./core/util.js";

export async function record(urlArg, opts = {}) {
  const { cfg, created } = await loadConfig();
  if (created && !urlArg && !opts.url)
    throw new Error(
      `config.json was created: ${CONFIG_FILE}\nSet "url" (and "browserPath" if needed) in it, then run the command again.`,
    );
  const url = normalizeUrl(urlArg || opts.url || cfg.url);
  const label = opts.name;
  const viewport = parseViewport(opts.viewport ?? cfg.viewport);
  const hoverMs = toMs(cfg.hoverMs, 600, "hoverMs");
  const browserPath = await resolveBrowserPath(opts, cfg);
  const id = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(
    ROOT,
    `${id}-${safeName(label || new URL(url).hostname)}`,
  );
  await ensureDir(dir);
  const browser = await chromium.launch(browserLaunchOptions(browserPath, Boolean(opts.headless)));
  const sess = await sessionPath(cfg, opts);
  if (sess) console.log(`Using saved login session: ${sess}`);
  const context = await browser.newContext({
    viewport,
    ...(sess ? { storageState: sess } : {}),
  });
  const page = await context.newPage();
  const steps = [];
  const started = Date.now();
  // Keep final.png fresh so it exists even if the browser window is closed to stop
  let snapTimer;
  const snap = () => {
    clearTimeout(snapTimer);
    snapTimer = setTimeout(
      () =>
        page
          .screenshot({ path: path.join(dir, "final.png"), fullPage: true })
          .catch(() => {}),
      800,
    );
  };
  const push = (s) => {
    steps.push({ ...s, timestamp: Date.now() - started });
    snap();
  };
  await page.exposeFunction("__bugassayPush", push);
  await page.addInitScript(installRecorder, { hoverMs });
  page.on("console", (m) =>
    fs.appendFile(
      path.join(dir, "console.log"),
      `[${nowIso()}] ${m.type()}: ${m.text()}\n`,
    ),
  );
  page.on("pageerror", (e) =>
    fs.appendFile(
      path.join(dir, "console.log"),
      `[${nowIso()}] pageerror: ${e.message}\n`,
    ),
  );
  let lastNavUrl = "";
  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame()) return;
    const u = frame.url();
    if (u === lastNavUrl) return;
    lastNavUrl = u;
    push({ type: "navigate", url: u });
  });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page
    .screenshot({ path: path.join(dir, "start.png"), fullPage: true })
    .catch(() => {});
  console.log(`\nBugassay recording started: ${url}`);
  console.log(
    "Use the browser to reproduce the bug. To stop: close the browser window (or press ENTER here).",
  );
  console.log(
    "Note: input values (including passwords) are stored as typed. Keep recordings private.",
  );
  console.log(
    "Use the REC toolbar (bottom-right of the page) to add checks (Assert text / visible / URL) or an explicit hover (Add hover). Menus that open on hover are also captured automatically when the mouse rests on them for a moment (hoverMs in config.json).\n",
  );
  const rl = readline.createInterface({ input, output });
  const closed = new Promise((res) => browser.on("disconnected", res));
  const q = rl.question("").catch(() => {});
  await Promise.race([q, closed]);
  rl.close();
  clearTimeout(snapTimer);
  let finalUrl = null;
  try {
    finalUrl = page.url();
  } catch {
    /* page already closed */
  }
  await page
    .screenshot({ path: path.join(dir, "final.png"), fullPage: true })
    .catch(() => console.log("Could not capture final.png (browser closed?)"));
  const recording = {
    version: 4,
    name: label || null,
    status: "open",
    history: [historyEntry(null, "open", "recorded")],
    url,
    finalUrl,
    createdAt: nowIso(),
    steps: collapseSteps(
      steps.filter(
        (s, i) => !((s.type === "goto" || s.type === "navigate") && i === 0),
      ),
    ),
    browser: browserPath ? path.basename(browserPath) : "Chromium",
    viewport,
    session: Boolean(sess),
  };
  await fs.writeFile(
    path.join(dir, "bug.json"),
    JSON.stringify(recording, null, 2),
  );
  await browser.close().catch(() => {});
  await writeReport(dir);
  const generated = await generateArtifacts(dir);
  console.log(`\nSaved: ${dir}`);
  console.log(`Steps recorded: ${recording.steps.length}`);
  console.log(`Playwright spec: ${generated.specPath}`);
  console.log(`Test case: ${generated.mdPath}`);
  console.log(`Report: ${path.join(dir, "report.html")}`);
  console.log(`Replay with:\n  bugassay replay last`);
  if (opts.open) openFile(path.join(dir, "report.html"));
}
