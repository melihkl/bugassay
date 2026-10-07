import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import http from "node:http";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { CONFIG_FILE, ROOT, loadConfig, normalizeUrl, parseViewport } from "../core/config.js";
import { writeReport } from "../core/export.js";
import { STATUSES, VERDICT_LABELS, VERDICT_TEXT } from "../core/lifecycle.js";
import { loadStats, setStatus, updateRecording } from "../core/store.js";
import { sanitizeSteps } from "../core/steps.js";
import { exists, openFile, readJson, toMs } from "../core/util.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, "public");
const CLI = path.resolve(HERE, "..", "cli.js");

const UI_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; frame-src 'self'";
const FILE_CSP = "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'";
const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/app.js": ["app.js", "text/javascript; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
};
const SAFE_FILE =
  /^(report\.html|start\.png|final\.png|replay\.webm|console\.log|replay-console\.log|replay-fail-\d+\.png|replay-steps\/\d+\.png|[\w.-]+\.(md|ts))$/;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".png": "image/png",
  ".webm": "video/webm",
  ".log": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".ts": "text/plain; charset=utf-8",
};
const SCHEMA = {
  url: "url", browserPath: "string", delay: "number", typingDelay: "number", timeout: "number",
  viewport: "viewport", session: "session", replay: "string", uiPort: "number", headless: "boolean",
  video: "boolean", stepScreenshots: "boolean", hoverMs: "number", hoverWait: "number", autoStatus: "boolean",
};
const nameOk = (n) => typeof n === "string" && /^[\w.-]+$/.test(n) && n !== "." && n !== "..";

/** Starts the UI server and returns { server, port, token, close }. Used by `bugassay ui` and by tests. */
export async function startUi({ port, token = crypto.randomBytes(16).toString("hex") } = {}) {
  const hosts = [];
  let job = null;
  let seq = 0;

  const json = (res, code, obj) => {
    res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(obj));
  };
  const readBody = (req) =>
    new Promise((ok, bad) => {
      let b = "";
      req.on("data", (c) => {
        b += c;
        if (b.length > 2e6) {
          req.destroy();
          bad(new Error("Body too large"));
        }
      });
      req.on("end", () => {
        try {
          ok(b ? JSON.parse(b) : {});
        } catch {
          bad(new Error("Invalid JSON"));
        }
      });
    });
  const fail = (code, message) => Object.assign(new Error(message), { code });

  function startJob(title, args, canStop) {
    if (job && job.status === "running") throw fail(409, "Another task is still running.");
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, FORCE_COLOR: "0" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const j = { id: ++seq, title, status: "running", lines: [], code: null, child, canStop };
    job = j;
    const add = (d) => {
      for (const l of d.toString().split(/\r?\n/)) if (l !== "") j.lines.push(l);
      if (j.lines.length > 5000) j.lines.splice(0, j.lines.length - 5000);
    };
    child.stdout.on("data", add);
    child.stderr.on("data", add);
    child.on("error", (e) => {
      add(e.message);
      j.status = "failed";
    });
    child.on("close", (code) => {
      j.code = code;
      j.status = code === 0 ? "done" : "failed";
      j.child = null;
    });
  }

  const server = http.createServer(async (req, res) => {
    try {
      if (!hosts.includes(req.headers.host || "")) return json(res, 403, { error: "Forbidden host" });
      const u = new URL(req.url, `http://${hosts[0]}`);
      const route = `${req.method} ${u.pathname}`;
      if (req.method === "POST" && req.headers["x-bugassay-token"] !== token)
        return json(res, 403, { error: "Invalid token" });

      if (req.method === "GET" && STATIC[u.pathname]) {
        const [file, type] = STATIC[u.pathname];
        let body = await fs.readFile(path.join(PUBLIC, file), "utf8");
        if (file === "index.html") body = body.replace("__TOKEN__", token);
        res.writeHead(200, { "content-type": type, "cache-control": "no-store", "content-security-policy": UI_CSP, "x-content-type-options": "nosniff" });
        return res.end(body);
      }
      if (route === "GET /api/stats") {
        const st = await loadStats();
        return json(res, 200, { ...st, verdictLabels: VERDICT_LABELS, verdictText: VERDICT_TEXT, statuses: STATUSES });
      }
      if (route === "GET /api/recording") {
        const name = u.searchParams.get("name");
        if (!nameOk(name)) return json(res, 400, { error: "Invalid name" });
        const rec = await readJson(path.join(ROOT, name, "bug.json")).catch(() => null);
        if (!rec) return json(res, 404, { error: "Recording not found" });
        const light = { ...rec, status: rec.status || "open" };
        for (const k of ["startShot", "finalShot", "console"]) delete light[k]; // keep the editor payload small
        return json(res, 200, { name, recording: light });
      }
      if (route === "POST /api/recording/save") {
        const b = await readBody(req);
        if (!nameOk(b.name)) return json(res, 400, { error: "Invalid name" });
        const dir = path.join(ROOT, b.name);
        if (!(await exists(path.join(dir, "bug.json")))) return json(res, 404, { error: "Recording not found" });
        let steps;
        try {
          steps = sanitizeSteps(b.steps);
        } catch (e) {
          return json(res, 400, { error: e.message });
        }
        if (!steps.length) return json(res, 400, { error: "A recording needs at least one step" });
        const patch = { steps };
        if (typeof b.label === "string") patch.name = b.label.trim().slice(0, 80) || null;
        if (typeof b.note === "string") patch.note = b.note.slice(0, 2000);
        await fs.copyFile(path.join(dir, "bug.json"), path.join(dir, "bug.json.bak"));
        await updateRecording(dir, (rec) => ({
          ...patch,
          history: [...(rec.history || []), { at: new Date().toISOString(), from: rec.status || "open", to: rec.status || "open", reason: "steps edited" }].slice(-50),
        }));
        await writeReport(dir).catch(() => {});
        return json(res, 200, { ok: true, steps: steps.length });
      }
      if (route === "POST /api/status") {
        const b = await readBody(req);
        if (!nameOk(b.name) || !(await exists(path.join(ROOT, b.name, "bug.json"))))
          return json(res, 400, { error: "Unknown recording" });
        if (!STATUSES.includes(b.status)) return json(res, 400, { error: "Invalid status" });
        await setStatus(path.join(ROOT, b.name), b.status, "set manually (ui)");
        return json(res, 200, { ok: true });
      }
      if (route === "GET /api/config") {
        const { cfg: c } = await loadConfig();
        return json(res, 200, { config: c, cwd: process.cwd() });
      }
      if (route === "POST /api/config") {
        const body = await readBody(req);
        const existing = await readJson(CONFIG_FILE).catch(() => ({}));
        const patch = {};
        try {
          for (const [k, kind] of Object.entries(SCHEMA)) {
            if (!(k in body)) continue;
            const v = body[k];
            if (kind === "number") patch[k] = toMs(v, 0, k);
            else if (kind === "boolean") patch[k] = Boolean(v);
            else if (kind === "url") patch[k] = normalizeUrl(v);
            else if (kind === "viewport") {
              parseViewport(v);
              patch[k] = String(v).trim();
            } else if (kind === "session") {
              const s = String(v ?? "").trim();
              patch[k] = !s || /^(false|off|no)$/i.test(s) ? false : s;
            } else patch[k] = String(v ?? "").trim();
          }
        } catch (e) {
          return json(res, 400, { error: e.message });
        }
        await fs.writeFile(CONFIG_FILE, JSON.stringify({ ...existing, ...patch }, null, 2) + "\n");
        return json(res, 200, { ok: true });
      }
      if (route === "GET /api/job") {
        if (!job) return json(res, 200, { job: null });
        const start = String(job.id) === u.searchParams.get("id") ? Number(u.searchParams.get("from")) || 0 : 0;
        return json(res, 200, {
          job: { id: job.id, title: job.title, status: job.status, code: job.code, canStop: job.canStop },
          lines: job.lines.slice(start),
          next: job.lines.length,
        });
      }
      if (route === "POST /api/run") {
        const b = await readBody(req);
        if (b.action === "replay") {
          if (!nameOk(b.name) || !(await exists(path.join(ROOT, b.name, "bug.json"))))
            return json(res, 400, { error: "Unknown recording" });
          startJob(`Replay ${b.name}`, ["replay", b.name, ...(b.video ? ["--video"] : []), ...(b.headless ? ["--headless"] : [])], false);
        } else if (b.action === "replayAll") {
          const args = ["replay", "--all", "--parallel", String(Math.max(1, Math.min(4, Number(b.parallel) || 1)))];
          if (typeof b.status === "string" && /^[a-z,]+$/.test(b.status)) args.push("--status", b.status);
          if (b.headed) args.push("--headed");
          startJob("Replay all", args, false);
        } else if (b.action === "record") {
          const args = ["record"];
          if (b.url) args.push(normalizeUrl(b.url));
          if (b.label) args.push("--name", String(b.label).slice(0, 60));
          if (b.noSession) args.push("--no-session");
          startJob("Recording", args, true);
        } else if (b.action === "login") startJob("Save login session", ["login"], true);
        else if (b.action === "doctor") startJob("Doctor", ["doctor"], false);
        else return json(res, 400, { error: "Unknown action" });
        return json(res, 200, { ok: true });
      }
      if (route === "POST /api/stop") {
        const b = await readBody(req);
        if (!job || !job.child) return json(res, 200, { ok: true });
        if (b.mode === "kill") job.child.kill();
        else job.child.stdin.write("\n");
        return json(res, 200, { ok: true });
      }
      if (route === "POST /api/delete") {
        const b = await readBody(req);
        if (!nameOk(b.name)) return json(res, 400, { error: "Invalid name" });
        if (!(await exists(path.join(ROOT, b.name, "bug.json")))) return json(res, 404, { error: "Recording not found" });
        await fs.rm(path.join(ROOT, b.name), { recursive: true, force: true });
        return json(res, 200, { ok: true });
      }
      const fm = req.method === "GET" && /^\/files\/([\w.-]+)\/(.+)$/.exec(u.pathname);
      if (fm) {
        const name = fm[1];
        const file = decodeURIComponent(fm[2]);
        if (!nameOk(name) || !SAFE_FILE.test(file)) return json(res, 404, { error: "Not found" });
        const full = path.join(ROOT, name, ...file.split("/"));
        const st = await fs.stat(full).catch(() => null);
        if (!st || !st.isFile()) return json(res, 404, { error: "Not found" });
        const headers = {
          "content-type": MIME[path.extname(full)] || "application/octet-stream",
          "cache-control": "no-store",
          "accept-ranges": "bytes",
          "content-security-policy": FILE_CSP,
          "x-content-type-options": "nosniff",
        };
        const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
        if (range && (range[1] || range[2])) {
          const s = range[1] ? Number(range[1]) : Math.max(0, st.size - Number(range[2]));
          const e = range[1] && range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
          res.writeHead(206, { ...headers, "content-range": `bytes ${s}-${e}/${st.size}`, "content-length": e - s + 1 });
          return createReadStream(full, { start: s, end: e }).pipe(res);
        }
        res.writeHead(200, { ...headers, "content-length": st.size });
        return createReadStream(full).pipe(res);
      }
      return json(res, 404, { error: "Not found" });
    } catch (e) {
      return json(res, e.code === 409 ? 409 : 500, { error: e.message });
    }
  });

  await new Promise((ok, bad) => {
    server.once("error", (e) =>
      bad(e.code === "EADDRINUSE" ? new Error(`Port ${port} is in use. Change "uiPort" in config.json or use --port.`) : e),
    );
    server.listen(port, "127.0.0.1", ok);
  });
  const actual = server.address().port;
  hosts.push(`127.0.0.1:${actual}`, `localhost:${actual}`);
  return {
    server, port: actual, token,
    close: () => new Promise((ok) => { job?.child?.kill(); server.close(() => ok()); server.closeAllConnections?.(); }),
  };
}

export async function uiCmd(opts = {}) {
  const { cfg } = await loadConfig();
  const port = Number(opts.port ?? cfg.uiPort ?? 4300);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid port.");
  const ui = await startUi({ port });
  const url = `http://127.0.0.1:${ui.port}/`;
  console.log(`Bugassay UI: ${url}\nPress Ctrl+C to stop.`);
  if (opts.open !== false) openFile(url);
  process.on("SIGINT", async () => {
    await ui.close();
    process.exit(0);
  });
  await new Promise(() => {});
}
