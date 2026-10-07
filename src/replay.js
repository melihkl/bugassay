/* global getComputedStyle */
import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { browserLaunchOptions, loadConfig, resolveBrowserPath, sessionPath } from "./core/config.js";
import { writeReport } from "./core/export.js";
import { classifyOutcome, hasChecks, nextStatus, verdictFor, VERDICT_LABELS, VERDICT_TEXT } from "./core/lifecycle.js";
import { appendRun } from "./core/runs.js";
import { setStatus } from "./core/store.js";
import { ensureDir, norm, nowIso, openFile, readJson, sleep, toMs } from "./core/util.js";

export async function settle(page) {
  await page
    .waitForLoadState("domcontentloaded", { timeout: 5000 })
    .catch(() => {});
  await page.waitForLoadState("load", { timeout: 5000 }).catch(() => {});
}

export const candidatesOf = (s) =>
  [...new Set([...(s.selectors || []), s.selector].filter(Boolean))];

// First visible match among all candidate selectors (polls until timeout)
export async function findVisible(page, cands, timeout) {
  const deadline = Date.now() + timeout;
  for (;;) {
    for (const c of cands) {
      try {
        const loc = page.locator(c);
        const n = await loc.count();
        for (let i = 0; i < Math.min(n, 20); i++) {
          const item = loc.nth(i);
          if (await item.isVisible()) return { loc: item, sel: c };
        }
      } catch {
        /* invalid selector: try the next one */
      }
    }
    if (Date.now() >= deadline) return null;
    await sleep(250);
  }
}

export async function findAttached(page, cands) {
  for (const c of cands) {
    try {
      const loc = page.locator(c);
      if ((await loc.count()) > 0) return loc.first();
    } catch {
      /* try the next one */
    }
  }
  return null;
}

export async function describeTarget(page, cands) {
  const lines = [];
  for (const c of cands) {
    try {
      const loc = page.locator(c);
      const n = await loc.count();
      let v = 0;
      for (let i = 0; i < Math.min(n, 20); i++)
        if (await loc.nth(i).isVisible()) v++;
      lines.push(`- ${c}  (${n} found, ${v} visible)`);
    } catch {
      lines.push(`- ${c}  (invalid selector)`);
    }
  }
  return `Tried selectors:\n${lines.join("\n")}`;
}

// Move the mouse to the target in small steps, like a real user (opens JS hover menus reliably)
export async function glide(page, target) {
  try {
    await target.scrollIntoViewIfNeeded({ timeout: 3000 });
    const b = await target.boundingBox();
    if (b) await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  } catch {
    /* hovering/clicking below reports the real error */
  }
}

// A menu item that is hidden until a parent is hovered: hover the nearest visible
// ancestor (repeat for nested submenus) until the item shows up
export async function revealByHover(page, hiddenLoc) {
  try {
    for (let i = 0; i < 4; i++) {
      if (await hiddenLoc.isVisible()) return;
      const h = await hiddenLoc.evaluateHandle(
        (el) => {
          for (let p = el.parentElement; p; p = p.parentElement) {
            const r = p.getBoundingClientRect();
            const cs = getComputedStyle(p);
            if (r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none")
              return p;
          }
          return null;
        },
        undefined,
        { timeout: 2000 },
      );
      const node = h.asElement();
      if (!node) return;
      await glide(page, node);
      await node.hover({ timeout: 3000 });
      await sleep(350);
    }
  } catch {
    /* fall through: the caller reports the real error */
  }
}

// Find the element for a step: visible match first, then try revealing it by hover
export async function locate(page, s, o, { reveal = false, hidden = false } = {}) {
  const cands = candidatesOf(s);
  let t = await findVisible(page, cands, Math.min(o.timeout, 3000));
  if (!t && reveal) {
    const el = await findAttached(page, cands);
    if (el) {
      await revealByHover(page, el);
      t = await findVisible(page, cands, 2500);
    }
  }
  if (!t) t = await findVisible(page, cands, Math.max(0, o.timeout - 3000));
  if (t) return t.loc;
  if (hidden) {
    const el = await findAttached(page, cands);
    if (el) return el;
  }
  throw new Error(`Element not found or not visible.\n${await describeTarget(page, cands)}`);
}

export async function runAssert(page, s, o) {
  const deadline = Date.now() + o.timeout;
  if (s.kind === "url") {
    const key = (u) => {
      const x = new URL(u);
      return x.origin + x.pathname;
    };
    for (;;) {
      if (key(page.url()) === key(s.value)) return;
      if (Date.now() > deadline)
        throw new Error(
          `Assertion failed: expected URL ${key(s.value)} but was ${key(page.url())}`,
        );
      await sleep(250);
    }
  }
  const cands = candidatesOf(s);
  if (s.kind === "visible") {
    const t = await findVisible(page, cands, o.timeout);
    if (!t)
      throw new Error(
        `Assertion failed: element is not visible.\n${await describeTarget(page, cands)}`,
      );
    return;
  }
  if (s.kind === "text") {
    let last = "(element not found)";
    for (;;) {
      const t = await findVisible(page, cands, 0);
      const loc = t ? t.loc : await findAttached(page, cands);
      if (loc) {
        try {
          last = norm(
            await loc.evaluate(
              (el) =>
                /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
                  ? el.value
                  : el.innerText || el.textContent || "",
              undefined,
              { timeout: 1000 },
            ),
          );
          if (last.includes(norm(s.value))) return;
        } catch {
          last = "(element not found)";
        }
      }
      if (Date.now() > deadline)
        throw new Error(
          `Assertion failed: expected "${norm(s.value).slice(0, 80)}", found "${last.slice(0, 120)}"\n${await describeTarget(page, cands)}`,
        );
      await sleep(250);
    }
  }
  throw new Error(`Unknown assertion kind: ${s.kind}`);
}

export async function runStep(page, s, prev, o) {
  switch (s.type) {
    case "assert":
      return runAssert(page, s, o);
    case "goto":
    case "navigate": {
      if (page.url() === s.url) return settle(page);
      // A navigation that directly follows a user action is usually caused
      // by that action: wait for it instead of navigating a second time.
      const caused =
        prev &&
        !["goto", "navigate"].includes(prev.type) &&
        s.timestamp - prev.timestamp < 5000;
      if (caused) {
        try {
          await page.waitForURL((u) => u.href === s.url, {
            timeout: 8000,
            waitUntil: "domcontentloaded",
          });
          return settle(page);
        } catch {
          /* fall back to an explicit navigation */
        }
      }
      await page.goto(s.url, { waitUntil: "domcontentloaded" });
      return settle(page);
    }
    case "hover": {
      const l = await locate(page, s, o, { reveal: true });
      await glide(page, l);
      await l.hover();
      await sleep(o.hoverWait ?? 500);
      return;
    }
    case "click": {
      const l = await locate(page, s, o, { reveal: true });
      await glide(page, l);
      await l.click();
      return settle(page);
    }
    case "input": {
      if (s.redacted || s.value === "[REDACTED]") {
        if (o.skipRedacted) return "skipped";
        throw new Error(
          "Redacted value cannot be replayed (use --skip-redacted to skip this step)",
        );
      }
      const l = await locate(page, s, o);
      const value = s.value ?? "";
      if (o.typingDelay > 0 && value.length > 0 && value.length <= 200) {
        await l.fill("");
        await l.pressSequentially(value, { delay: o.typingDelay });
      } else {
        await l.fill(value);
      }
      return;
    }
    case "select": {
      const l = await locate(page, s, o);
      await l.selectOption(s.value);
      return;
    }
    case "press": {
      const l = await locate(page, s, o);
      await l.press(s.key);
      return settle(page);
    }
    case "check": {
      const l = await locate(page, s, o, { hidden: true });
      try {
        await l.setChecked(Boolean(s.checked), { timeout: 5000 });
      } catch {
        // Custom-styled controls may be visually hidden
        await l.setChecked(Boolean(s.checked), { force: true });
      }
      return;
    }
    case "wait":
      await sleep(Math.min(Number(s.ms) || 0, 600000));
      return;
    default:
      throw new Error(`Unknown step type: ${s.type}`);
  }
}

const stepLabel = (s, i) =>
  `${i + 1}. ${s.type}${s.kind ? ` ${s.kind}` : ""} ${
    s.type === "wait" ? `${s.ms} ms` : s.selector || s.url || (s.kind === "url" ? s.value : "") || ""
  }`.trim();

/**
 * Replay one recording. Never throws for a failing recording: it returns a result object
 * { ok, outcome, verdict, status, passed, total, failedStep, ms, error, ... } and does not touch process.exitCode.
 * opts.log(line) receives the progress lines (default: console.log).
 */
export async function replay(dir, opts = {}) {
  const log = opts.log || ((m) => console.log(m));
  const { cfg } = await loadConfig();
  const o = {
    delay: toMs(opts.delay ?? cfg.delay, 700, "--delay"),
    typingDelay: toMs(opts.typingDelay ?? cfg.typingDelay, 40, "--typing-delay"),
    timeout: toMs(opts.timeout ?? cfg.timeout, 15000, "--timeout"),
    skipRedacted: Boolean(opts.skipRedacted),
    hoverWait: toMs(cfg.hoverWait, 500, "hoverWait"),
  };
  const wantVideo = Boolean(opts.video ?? cfg.video);
  const takeShots = cfg.stepScreenshots !== false;
  const shotsDir = path.join(dir, "replay-steps");
  const rec = await readJson(path.join(dir, "bug.json"));
  const name = path.basename(dir);
  const status = rec.status || "open";
  const startedAt = Date.now();
  let sessFile = null;
  if (rec.session) {
    sessFile = await sessionPath(cfg, {});
    if (!sessFile)
      throw new Error(
        "This recording was made with a saved login session, but the session file was not found.\nRun: npx bugassay login",
      );
    log(`Using saved login session: ${sessFile}`);
  }
  const browserPath = await resolveBrowserPath(opts, cfg);
  const logLines = [];
  const videoTmp = path.join(dir, ".replay-video");
  let browser = null;
  let passed = 0,
    skipped = 0,
    failedStep = null,
    failedStepType = null,
    failedMessage = null,
    fatal = null,
    finalUrlMatch = null,
    context = null,
    video = null;
  try {
    browser = await chromium.launch(
      browserLaunchOptions(browserPath, Boolean(opts.headless ?? cfg.headless)),
    );
    // Remove evidence of previous replays so the report never shows stale files
    await fs.rm(path.join(dir, "replay.webm"), { force: true });
    await fs.rm(videoTmp, { recursive: true, force: true });
    await fs.rm(shotsDir, { recursive: true, force: true });
    await fs.rm(path.join(dir, "replay-console.log"), { force: true });
    for (const f of await fs.readdir(dir).catch(() => []))
      if (/^replay-fail-\d+\.png$/.test(f)) await fs.rm(path.join(dir, f), { force: true });
    if (takeShots) await ensureDir(shotsDir);
    const open = async (withVideo) => {
      context = await browser.newContext({
        viewport: rec.viewport,
        ...(sessFile ? { storageState: sessFile } : {}),
        ...(withVideo ? { recordVideo: { dir: videoTmp, size: rec.viewport } } : {}),
      });
      context.setDefaultTimeout(o.timeout);
      context.setDefaultNavigationTimeout(o.timeout * 2);
      return context.newPage();
    };
    let page;
    if (wantVideo) {
      try {
        page = await open(true);
        video = page.video();
      } catch (e) {
        log(
          `! Video recording is not available: ${e.message.split("\n")[0]}\n  Video needs ffmpeg: run "npx playwright install ffmpeg". Continuing without video (step screenshots are still saved).`,
        );
        await context?.close().catch(() => {});
        video = null;
        page = await open(false);
      }
    } else page = await open(false);
    page.on("console", (m) => logLines.push(`[${nowIso()}] ${m.type()}: ${m.text()}`));
    page.on("pageerror", (e) => logLines.push(`[${nowIso()}] pageerror: ${e.message}`));
    log(`Replaying ${rec.steps.length} steps (delay ${o.delay} ms, typing ${o.typingDelay} ms)...\n`);
    // The recorder drops the initial navigation, so open the start URL first.
    await page.goto(rec.url, { waitUntil: "domcontentloaded" });
    await settle(page);
    await sleep(o.delay);
    for (let i = 0; i < rec.steps.length; i++) {
      const s = rec.steps[i];
      const label = stepLabel(s, i);
      if (s.disabled) {
        skipped++;
        passed++;
        log(`- ${label} (disabled)`);
        continue;
      }
      try {
        const r = await runStep(page, s, rec.steps[i - 1], o);
        passed++;
        if (r === "skipped") {
          skipped++;
          log(`- ${label} (skipped: redacted)`);
        } else log(`✓ ${label}`);
        await sleep(o.delay);
        if (takeShots)
          await page
            .screenshot({ path: path.join(shotsDir, `${String(i + 1).padStart(2, "0")}.png`) })
            .catch(() => {});
      } catch (e) {
        failedStep = i + 1;
        failedStepType = s.type;
        failedMessage = e.message;
        log(`✗ ${label}`);
        for (const ln of e.message.split("\n").slice(0, 8)) log(`  ${ln}`);
        await page
          .screenshot({ path: path.join(dir, `replay-fail-${i + 1}.png`), fullPage: true })
          .catch(() => {});
        break;
      }
    }
    if (failedStep === null && rec.finalUrl) {
      finalUrlMatch = page.url() === rec.finalUrl;
      if (!finalUrlMatch)
        log(`\n! Final URL differs.\n  recorded: ${rec.finalUrl}\n  replayed: ${page.url()}`);
    }
  } catch (e) {
    fatal = e.message;
    failedMessage = e.message;
    log(`✗ ${e.message.split("\n")[0]}`);
  } finally {
    await context?.close().catch(() => {});
    if (video) {
      await video
        .saveAs(path.join(dir, "replay.webm"))
        .then(() => log(`Video: ${path.join(dir, "replay.webm")}`))
        .catch((e) => log(`! Could not save video: ${e.message.split("\n")[0]}`));
      await fs.rm(videoTmp, { recursive: true, force: true }).catch(() => {});
    }
    await browser?.close().catch(() => {});
  }
  const total = rec.steps.length;
  const ok = !fatal && passed === total;
  const outcome = classifyOutcome({ ok, failedStepType });
  const verdict = verdictFor(status, outcome, hasChecks(rec));
  const ms = Date.now() - startedAt;
  log(`\nResult: ${ok ? "PASS" : "FAIL"} (${passed}/${total}${skipped ? `, ${skipped} skipped` : ""})`);
  log(`Verdict: ${VERDICT_LABELS[verdict]} - ${VERDICT_TEXT[verdict]}`);
  if (logLines.length) {
    await fs.writeFile(path.join(dir, "replay-console.log"), logLines.join("\n") + "\n");
    const errs = logLines.filter((l) => /\] (pageerror|error):/.test(l)).length;
    if (errs) log(`Browser errors during replay: ${errs} (see replay-console.log)`);
  }

  // Bug lifecycle: move the status when the replay proves it changed
  let newStatus = status;
  const next = cfg.autoStatus !== false && opts.autoStatus !== false ? nextStatus(status, verdict) : null;
  if (next) {
    const reason =
      verdict === "fixed" ? "replay passed: all checks hold" : "replay failed at a check";
    await setStatus(dir, next, reason);
    newStatus = next;
    log(`Status: ${status} -> ${next}`);
  }

  const result = {
    name,
    label: rec.name || "",
    ok,
    outcome,
    verdict,
    status: newStatus,
    previousStatus: status,
    passed,
    total,
    failedStep,
    failedStepType,
    finalUrlMatch,
    ms,
    error: failedMessage ? failedMessage.split("\n")[0] : null,
  };
  const at = nowIso();
  await fs.writeFile(
    path.join(dir, "replay.json"),
    JSON.stringify({ ...result, at, delay: o.delay }, null, 2),
  );
  await appendRun(dir, {
    at,
    ms,
    ok,
    outcome,
    verdict,
    status: newStatus,
    passed,
    total,
    failedStep,
    error: result.error,
  });
  await writeReport(dir, result);
  log(`Report updated: ${path.join(dir, "report.html")}`);
  if (opts.open) openFile(path.join(dir, "report.html"));
  return result;
}
