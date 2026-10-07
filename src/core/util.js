import fs from "node:fs/promises";
import { spawn } from "node:child_process";

export const safeName = (s) =>
  s
    .replace(/[^a-z0-9-_]/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50) || "recording";
export const ensureDir = (p) => fs.mkdir(p, { recursive: true });
export const escapeHtml = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const nowIso = () => new Date().toISOString();
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const toMs = (v, fallback, name) => {
  if (v === undefined || v === null) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0)
    throw new Error(`${name} must be a non-negative number (milliseconds)`);
  return Math.round(n);
};
export const readJson = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
export const exists = (p) =>
  fs.access(p).then(
    () => true,
    () => false,
  );

export function openFile(p) {
  const [cmd, args] =
    process.platform === "win32"
      ? ["rundll32", ["url.dll,FileProtocolHandler", p]]
      : process.platform === "darwin"
        ? ["open", [p]]
        : ["xdg-open", [p]];
  try {
    const c = spawn(cmd, args, { detached: true, stdio: "ignore" });
    c.on("error", () => console.log(`Open manually: ${p}`));
    c.unref();
  } catch {
    console.log(`Open manually: ${p}`);
  }
}
export const primary = (s) => s.selectors?.[0] || s.selector;
export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const norm = (t) => String(t ?? "").replace(/\s+/g, " ").trim();
