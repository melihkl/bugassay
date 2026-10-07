import fs from "node:fs/promises";
import path from "node:path";
import { VERDICT_LABELS, VERDICT_TEXT } from "./lifecycle.js";
import { escapeHtml, escapeRegex, exists, nowIso, primary, readJson, safeName } from "./util.js";

export async function writeReport(dir, result = null) {
  if (!result)
    result = await readJson(path.join(dir, "replay.json")).catch(() => null);
  const rec = JSON.parse(await fs.readFile(path.join(dir, "bug.json"), "utf8"));
  const consoleLog = await fs
    .readFile(path.join(dir, "console.log"), "utf8")
    .catch(() => "");
  const steps = rec.steps
    .map((s, i) => {
      const target = s.type === "wait" ? `${s.ms} ms` : s.selector || s.url || (s.kind === "url" ? s.value : "") || "";
      const value = s.type === "input" ? "••••••" : s.type === "wait" ? "" : s.value ?? s.key ?? "";
      return `<tr${s.disabled ? ' class="off"' : ""}><td>${i + 1}</td><td>${escapeHtml(s.type)}${s.kind ? ` (${escapeHtml(s.kind)})` : ""}${s.disabled ? " <em>(disabled)</em>" : ""}</td><td><code>${escapeHtml(target)}</code>${s.note ? `<div class="muted">${escapeHtml(s.note)}</div>` : ""}</td><td>${escapeHtml(value)}</td></tr>`;
    })
    .join("");
  const status = rec.status || "open";
  const verdict = result && result.verdict;
  const resultHtml = result
    ? `<div class="status ${result.ok ? "ok" : "fail"}">${result.ok ? "PASS" : "FAIL"} — ${result.passed}/${result.total} steps passed${result.failedStep ? `; failed at step ${result.failedStep}` : ""}${verdict ? `<div class="verdict">${escapeHtml(VERDICT_LABELS[verdict] || verdict)} — ${escapeHtml(VERDICT_TEXT[verdict] || "")}</div>` : ""}</div>`
    : `<div class="status neutral">Recorded — not replayed yet</div>`;
  const history = (rec.history || [])
    .map((h) => `<tr><td>${escapeHtml(h.at)}</td><td>${escapeHtml(h.from ?? "—")} → ${escapeHtml(h.to)}</td><td>${escapeHtml(h.reason || "")}</td></tr>`)
    .join("");
  const hasVideo = await exists(path.join(dir, "replay.webm"));
  const shots = (await fs.readdir(path.join(dir, "replay-steps")).catch(() => []))
    .filter((f) => f.endsWith(".png"))
    .sort();
  const replayHtml =
    hasVideo || shots.length
      ? `<h2>Replay evidence</h2>${hasVideo ? '<video src="replay.webm" controls style="max-width:100%;border-radius:10px"></video>' : ""}${
          shots.length
            ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin-top:12px">${shots
                .map(
                  (f) =>
                    `<figure style="margin:0"><a href="replay-steps/${escapeHtml(f)}"><img src="replay-steps/${escapeHtml(f)}" style="width:100%;border:1px solid #ddd;border-radius:8px"></a><figcaption class="muted">Step ${parseInt(f, 10)}</figcaption></figure>`,
                )
                .join("")}</div>`
            : ""
        }`
      : "";
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Bugassay Report</title><style>
body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:1100px;margin:40px auto;padding:0 20px;color:#222}h1{margin-bottom:4px}.muted{color:#666}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.card{border:1px solid #ddd;border-radius:10px;padding:14px}.status{padding:14px;border-radius:10px;margin:20px 0;font-weight:700}.ok{background:#e8f7ed;color:#146c2e}.fail{background:#fdecec;color:#9b1c1c}.neutral{background:#f3f3f3;color:#555}table{width:100%;border-collapse:collapse;margin:16px 0}th,td{border-bottom:1px solid #ddd;padding:9px;text-align:left;vertical-align:top}code{word-break:break-word}.console{white-space:pre-wrap;background:#111;color:#eee;padding:16px;border-radius:10px;overflow:auto}.off{opacity:.5}.verdict{font-weight:500;margin-top:4px}.tag{display:inline-block;padding:4px 8px;border-radius:999px;background:#eee;margin-right:6px;font-size:12px}</style></head><body>
<h1>Bugassay Report</h1><p class="muted">Generated ${escapeHtml(nowIso())} · Bug status: <b>${escapeHtml(status)}</b></p>${resultHtml}
<div class="grid"><div class="card"><b>URL</b><br>${escapeHtml(rec.url)}</div><div class="card"><b>Browser</b><br>${escapeHtml(rec.browser)}</div><div class="card"><b>Viewport</b><br>${rec.viewport.width} × ${rec.viewport.height}</div><div class="card"><b>Steps</b><br>${rec.steps.length}</div></div>
<h2>Reproduction steps</h2><table><thead><tr><th>#</th><th>Action</th><th>Target</th><th>Value</th></tr></thead><tbody>${steps}</tbody></table>
${replayHtml}${history ? `<h2>Status history</h2><table><thead><tr><th>When</th><th>Change</th><th>Reason</th></tr></thead><tbody>${history}</tbody></table>` : ""}<h2>Evidence</h2><p><span class="tag">start.png</span><span class="tag">final.png</span><span class="tag">console.log</span></p>
<h2>Console / page errors</h2><div class="console">${escapeHtml(consoleLog || "No console messages captured.")}</div>
<footer class="muted"><p>Bugassay — record once, replay anywhere.</p></footer></body></html>`;
  await fs.writeFile(path.join(dir, "report.html"), html);
  return path.join(dir, "report.html");
}

export function tsString(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/`/g, "\\`")
    .replace(/\$/g, "\\$")
    .replace(/\r?\n/g, "\\n");
}

export async function generateArtifacts(dir) {
  const rec = JSON.parse(await fs.readFile(path.join(dir, "bug.json"), "utf8"));
  const base = safeName(path.basename(dir));
  const spec = [];
  spec.push(
    `import { test, expect } from '@playwright/test';`,
    "",
    `test.describe('${tsString(base)}', () => {`,
    `  test('reproduces the recorded bug scenario', async ({ page }) => {`,
    `    await page.setViewportSize({ width: ${rec.viewport.width}, height: ${rec.viewport.height} });`,
    `    await page.goto('${tsString(rec.url)}');`,
    "",
  );
  for (const s of rec.steps) {
    if (s.disabled) spec.push(`    // (disabled) ${tsString(s.type)} ${tsString(primary(s) || s.url || "")}`);
    else if (s.type === "wait") spec.push(`    await page.waitForTimeout(${Number(s.ms) || 0});`);
    else if (s.type === "goto")
      spec.push(`    await page.goto('${tsString(s.url)}');`);
    else if (s.type === "navigate")
      spec.push(`    // navigated to ${tsString(s.url)}`);
    else if (s.type === "press")
      spec.push(
        `    await page.locator('${tsString(primary(s))}').first().press('${tsString(s.key)}');`,
      );
    else if (s.type === "hover")
      spec.push(
        `    await page.locator('${tsString(primary(s))}').first().hover();`,
      );
    else if (s.type === "assert") {
      if (s.kind === "url") {
        let pth = s.value;
        try {
          pth = new URL(s.value).pathname;
        } catch {
          /* keep raw value */
        }
        spec.push(
          `    await expect(page).toHaveURL(new RegExp('${tsString(escapeRegex(pth))}'));`,
        );
      } else if (s.kind === "visible")
        spec.push(
          `    await expect(page.locator('${tsString(primary(s))}').first()).toBeVisible();`,
        );
      else
        spec.push(
          `    await expect(page.locator('${tsString(primary(s))}').first()).toContainText('${tsString(s.value)}');`,
        );
    }
    else if (s.type === "click")
      spec.push(
        `    await page.locator('${tsString(primary(s))}').first().click();`,
      );
    else if (s.type === "input") {
      if (s.redacted)
        spec.push(
          `    // REDACTED: provide a safe test value for ${tsString(primary(s))}`,
        );
      else
        spec.push(
          `    await page.locator('${tsString(primary(s))}').first().fill('${tsString(s.value)}');`,
        );
    } else if (s.type === "select")
      spec.push(
        `    await page.locator('${tsString(primary(s))}').first().selectOption('${tsString(s.value)}');`,
      );
    else if (s.type === "check")
      spec.push(
        `    if (await page.locator('${tsString(primary(s))}').first().isChecked() !== ${Boolean(s.checked)}) await page.locator('${tsString(primary(s))}').first().click();`,
      );
  }
  spec.push(
    "",
    `    // Add the business-level assertion that proves the bug is fixed.`,
    `    // Example: await expect(page.getByRole('alert')).toHaveText('Purchase completed');`,
    "  });",
    "});",
    "",
  );
  const specPath = path.join(dir, `${base}.spec.ts`);
  await fs.writeFile(specPath, spec.join("\n"));

  const actionText = (s) => {
    if (s.type === "goto" || s.type === "navigate") return `Open <strong>${escapeHtml(s.url)}</strong>.`;
    if (s.type === "click")
      return `Click <strong>${escapeHtml(s.selector)}</strong>.`;
    if (s.type === "input")
      return s.redacted
        ? `Enter the required test value into <strong>${escapeHtml(s.selector)}</strong>.`
        : `Enter <strong>${escapeHtml(s.value)}</strong> into <strong>${escapeHtml(s.selector)}</strong>.`;
    if (s.type === "select")
      return `Select <strong>${escapeHtml(s.value)}</strong> from <strong>${escapeHtml(s.selector)}</strong>.`;
    if (s.type === "check")
      return `${s.checked ? "Select" : "Clear"} <strong>${escapeHtml(s.selector)}</strong>.`;
    if (s.type === "press")
      return `Press <strong>${escapeHtml(s.key)}</strong> in <strong>${escapeHtml(s.selector)}</strong>.`;
    if (s.disabled) return `(Skipped step: ${escapeHtml(s.type)}.)`;
    if (s.type === "wait") return `Wait <strong>${Number(s.ms) || 0} ms</strong>.`;
    if (s.type === "hover")
      return `Move the mouse over <strong>${escapeHtml(s.selector)}</strong> and wait for the menu or tooltip to appear.`;
    if (s.type === "assert")
      return s.kind === "url"
        ? `Check that the page address contains <strong>${escapeHtml(s.value)}</strong>.`
        : s.kind === "visible"
          ? `Check that <strong>${escapeHtml(s.selector)}</strong> is visible.`
          : `Check that <strong>${escapeHtml(s.selector)}</strong> contains <strong>${escapeHtml(s.value)}</strong>.`;
    return `Perform ${escapeHtml(s.type)}.`;
  };
  const expectedText = (s) => {
    if (s.type === "goto" || s.type === "navigate")
      return "The requested page should load successfully.";
    if (s.type === "click")
      return "The application should respond without an unexpected error.";
    if (s.type === "input") return "The value should be accepted by the field.";
    if (s.type === "select") return "The selected option should be applied.";
    if (s.type === "check")
      return `The control should be ${s.checked ? "selected" : "cleared"}.`;
    if (s.disabled || s.type === "wait") return "No visible change is required.";
    if (s.type === "hover")
      return "The hover content (menu, tooltip or panel) should appear.";
    if (s.type === "assert")
      return "The check passes. If it fails, the defect is still present.";
    return "The action should complete successfully.";
  };
  const md = [
    `# Test Case: ${base}`,
    "",
    "## What are we testing?",
    "This test case documents the user journey that reproduced the issue. It is written so that another tester can follow it without needing to inspect the recording first.",
    "",
    "## Preconditions",
    `- The application is available at **${rec.url}**.`,
    `- The tester has the required account, permissions and test data.`,
    `- The test is performed in a supported browser.`,
    "",
    "## Steps",
    "",
    ...rec.steps.flatMap((s, i) => [
      `### Step ${i + 1}`,
      `**Action:** ${actionText(s)
        .replace(/<strong>|<\/strong>/g, "")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&")}`,
      `**Expected:** ${expectedText(s)}`,
      "",
    ]),
    "## Expected final result",
    "The complete flow should finish without the original defect occurring. Add the specific business outcome here before marking this as an approved regression test.",
    "",
    "## Evidence",
    "The following evidence was captured automatically:",
    "- `start.png` — state before reproduction",
    "- `final.png` — state after reproduction",
    "- `console.log` — browser console and page errors",
    "- `report.html` — complete evidence report",
    "",
    "## Automation",
    "A Playwright TypeScript starting point is available as `" +
      base +
      ".spec.ts`. Review selectors, replace any redacted values with safe test data, and add the business assertion that proves the defect is fixed.",
    "",
    "## Notes",
    "This test case was generated from an observed browser session. The generated expected results are intentionally generic where Bugassay cannot safely infer the business requirement.",
    "",
  ].join("\n");
  const mdPath = path.join(dir, `${base}-test-case.md`);
  await fs.writeFile(mdPath, md);
  return { specPath, mdPath };
}
