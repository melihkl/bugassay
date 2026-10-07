import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

// The recordings folder is derived from the working directory when config.js loads.
const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "bugassay-ui-"));
process.chdir(cwd);
const dir = path.join(cwd, "bugassay-recordings", "r1");
await fs.mkdir(dir, { recursive: true });
await fs.writeFile(path.join(dir, "bug.json"), JSON.stringify({ version: 4, status: "open", name: "r1", url: "http://x", steps: [{ type: "goto", url: "http://x" }, { type: "assert", kind: "visible", selector: "#a" }] }));
await fs.writeFile(path.join(dir, "report.html"), "<p>hi</p>");
const { startUi } = await import("../src/ui/server.js");

const ui = await startUi({ port: 0, token: "tok" });
const base = `http://127.0.0.1:${ui.port}`;
const post = (p, body, token = "tok") =>
  fetch(base + p, { method: "POST", headers: { "content-type": "application/json", "x-bugassay-token": token }, body: JSON.stringify(body) });
test.after(() => ui.close());

test("serves the page with the token and a strict CSP", async () => {
  const r = await fetch(base + "/");
  const html = await r.text();
  assert.match(html, /content="tok"/);
  assert.match(r.headers.get("content-security-policy"), /script-src 'self'/);
});

test("rejects wrong host and missing token", async () => {
  const status = await new Promise((ok, no) => {
    const req = http.request({ host: "127.0.0.1", port: ui.port, path: "/api/stats", headers: { host: "evil.example" } }, (res) => { res.resume(); ok(res.statusCode); });
    req.on("error", no);
    req.end();
  });
  assert.equal(status, 403);
  assert.equal((await post("/api/status", { name: "r1", status: "fixed" }, "wrong")).status, 403);
});

test("stats API", async () => {
  const st = await (await fetch(base + "/api/stats")).json();
  assert.equal(st.totals.recordings, 1);
  assert.equal(st.rows[0].status, "open");
});

test("status API validates", async () => {
  assert.equal((await post("/api/status", { name: "r1", status: "bogus" })).status, 400);
  assert.equal((await post("/api/status", { name: "../x", status: "fixed" })).status, 400);
  assert.equal((await post("/api/status", { name: "r1", status: "fixed" })).status, 200);
});

test("editor save validates, backs up and writes", async () => {
  const bad = await post("/api/recording/save", { name: "r1", steps: [{ type: "click" }] });
  assert.equal(bad.status, 400);
  const ok = await post("/api/recording/save", { name: "r1", label: "New", steps: [{ type: "goto", url: "http://x" }, { type: "wait", ms: 200 }, { type: "assert", kind: "text", selector: "#a", value: "ok" }] });
  assert.equal(ok.status, 200);
  const rec = JSON.parse(await fs.readFile(path.join(dir, "bug.json"), "utf8"));
  assert.equal(rec.steps.length, 3);
  assert.equal(rec.name, "New");
  await fs.access(path.join(dir, "bug.json.bak"));
});

test("file whitelist: report yes, bug.json no", async () => {
  assert.equal((await fetch(base + "/files/r1/report.html")).status, 200);
  assert.equal((await fetch(base + "/files/r1/bug.json")).status, 404);
  assert.equal((await fetch(base + "/files/r1/session.json")).status, 404);
});
