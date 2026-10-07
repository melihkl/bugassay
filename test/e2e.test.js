// Browser test against the demo shop. Runs only with BUGASSAY_E2E=1 (needs: npx playwright install chromium).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3917;
const enabled = process.env.BUGASSAY_E2E === "1";

const startDemo = async (fixed) => {
  const child = spawn(process.execPath, [path.join(ROOT, "demo/server.js")], { env: { ...process.env, DEMO_PORT: String(PORT), DEMO_FIXED: fixed ? "1" : "0" }, stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    if (await fetch(`http://127.0.0.1:${PORT}/health`).then((r) => r.ok).catch(() => false)) return child;
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill();
  throw new Error("demo server did not start");
};

test("bug lifecycle: open -> fixed -> regressed", { skip: !enabled, timeout: 180000 }, async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "bugassay-e2e-"));
  await fs.writeFile(path.join(cwd, "config.json"), JSON.stringify({ url: `http://127.0.0.1:${PORT}/login`, delay: 50, typingDelay: 0, timeout: 8000, session: false }));
  const dest = path.join(cwd, "bugassay-recordings", "cart-total-bug");
  await fs.cp(path.join(ROOT, "demo/recordings/cart-total-bug"), dest, { recursive: true });
  const f = path.join(dest, "bug.json");
  await fs.writeFile(f, (await fs.readFile(f, "utf8")).replaceAll("127.0.0.1:3000", `127.0.0.1:${PORT}`));
  const cli = (...a) => spawnSync(process.execPath, [path.join(ROOT, "src/cli.js"), ...a], { cwd, encoding: "utf8" });
  const status = async () => JSON.parse(await fs.readFile(f, "utf8")).status;

  let demo = await startDemo(false);
  try {
    const r1 = cli("replay", "--all");
    assert.equal(r1.status, 0, r1.stdout + r1.stderr); // an open bug that still reproduces is not a CI failure
    assert.match(r1.stdout, /STILL OPEN/);
    assert.equal(await status(), "open");
  } finally { demo.kill(); }

  demo = await startDemo(true);
  try {
    const r2 = cli("replay", "--all");
    assert.equal(r2.status, 0, r2.stdout + r2.stderr);
    assert.match(r2.stdout, /FIXED/);
    assert.equal(await status(), "fixed");
  } finally { demo.kill(); }

  demo = await startDemo(false);
  try {
    const r3 = cli("replay", "--all");
    assert.equal(r3.status, 1, r3.stdout + r3.stderr); // fixed bug came back
    assert.match(r3.stdout, /REGRESSION/);
    assert.equal(await status(), "regressed");
  } finally { demo.kill(); }
});
