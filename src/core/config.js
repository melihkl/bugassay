import fs from "node:fs/promises";
import path from "node:path";
import { readFileSync } from "node:fs";
import { exists, readJson } from "./util.js";


// Folder for recordings: config.json "recordingsDir" (read once at startup)
export const RECORDINGS_DIR = (() => {
  try {
    const c = JSON.parse(readFileSync(path.resolve(process.cwd(), "config.json"), "utf8"));
    if (typeof c.recordingsDir === "string" && c.recordingsDir.trim())
      return c.recordingsDir.trim();
  } catch {
    /* no config yet: use the default */
  }
  return "bugassay-recordings";
})();
export const ROOT = path.resolve(process.cwd(), RECORDINGS_DIR);
export function browserLaunchOptions(browserPath, headless = false) {
  return browserPath
    ? { headless, executablePath: browserPath }
    : { headless };
}
// All settings live in ./config.json (next to bugassay-recordings/)
export const CONFIG_FILE = path.resolve(process.cwd(), "config.json");
export const DEFAULT_CONFIG = {
  url: "http://localhost:3000",
  browserPath: "",
  delay: 700,
  typingDelay: 40,
  timeout: 15000,
  viewport: "1440x900",
  headless: false,
  video: false,
  stepScreenshots: true,
  hoverMs: 350,
  hoverWait: 500,
  session: "session.json",
  uiPort: 4300,
  recordingsDir: "bugassay-recordings",
  autoStatus: true,
  replay: "last",
};

export async function writeDefaultConfig() {
  await fs.writeFile(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2) + "\n");
}

// Returns { cfg, created }. Missing keys fall back to defaults.
export async function loadConfig() {
  let created = false;
  if (!(await exists(CONFIG_FILE))) {
    await writeDefaultConfig();
    created = true;
  }
  let user;
  try {
    user = await readJson(CONFIG_FILE);
  } catch (e) {
    throw new Error(`config.json is not valid JSON: ${e.message}`);
  }
  const cfg = { ...DEFAULT_CONFIG };
  for (const [k, v] of Object.entries(user))
    if (v !== "" && v !== null && v !== undefined) cfg[k] = v;
  if (user.browserPath === "") cfg.browserPath = "";
  return { cfg, created };
}

export async function detectBrowser() {
  const e = process.env;
  const c = [];
  if (process.platform === "win32") {
    const bases = [e.PROGRAMFILES, e["PROGRAMFILES(X86)"], e.LOCALAPPDATA].filter(
      Boolean,
    );
    for (const b of bases)
      c.push(path.join(b, "Google", "Chrome", "Application", "chrome.exe"));
    for (const b of bases)
      c.push(path.join(b, "Microsoft", "Edge", "Application", "msedge.exe"));
  } else if (process.platform === "darwin") {
    c.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    );
  } else {
    c.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/usr/bin/microsoft-edge",
    );
  }
  for (const p of c) if (await exists(p)) return p;
  return null;
}

// config.json "browserPath" (or --browser-path); empty = Playwright's Chromium
export async function resolveBrowserPath(opts, cfg) {
  const bp = opts.browserPath || cfg.browserPath;
  if (!bp) return undefined;
  if (!(await exists(bp)))
    throw new Error(`browserPath does not exist: ${bp}\nFix it in ${CONFIG_FILE}`);
  return bp;
}

export function normalizeUrl(raw) {
  let u = String(raw || "").trim();
  if (!u) throw new Error("URL is required (set \"url\" in config.json).");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u))
    u =
      (/^(localhost|127\.|0\.0\.0\.0|\[::1\]|\d+\.\d+\.\d+\.\d+)/i.test(u)
        ? "http://"
        : "https://") + u;
  const parsed = new URL(u);
  if (!/^https?:$/.test(parsed.protocol))
    throw new Error("Only http:// and https:// URLs are supported.");
  return u;
}

export function parseViewport(v) {
  if (!v) return { width: 1440, height: 900 };
  const m = /^(\d{3,4})x(\d{3,4})$/i.exec(String(v).trim());
  if (!m) throw new Error('viewport must look like "1440x900"');
  return { width: Number(m[1]), height: Number(m[2]) };
}

// Saved login session (Playwright storageState). Disabled with "session": false
export async function sessionPath(cfg, opts = {}) {
  if (opts.session === false || !cfg.session) return null;
  const f = path.resolve(String(cfg.session));
  return (await exists(f)) ? f : null;
}
