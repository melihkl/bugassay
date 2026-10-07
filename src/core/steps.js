
// Typing produces one "input" event per keystroke: keep only the final value
export function collapseSteps(steps) {
  const out = [];
  for (const s of steps) {
    const last = out[out.length - 1];
    if (s.type === "hover" && last?.type === "hover" && last.selector === s.selector)
      continue;
    if (s.type === "input" && last?.type === "input" && last.selector === s.selector)
      out[out.length - 1] = s;
    else out.push(s);
  }
  return out;
}

export const STEP_TYPES = ["goto", "navigate", "click", "hover", "input", "select", "check", "press", "assert", "wait"];
export const ASSERT_KINDS = ["text", "visible", "url"];
const MAX_STEPS = 500;

const str = (v, max, what) => {
  if (typeof v !== "string") throw new Error(`${what} must be text`);
  if (v.length > max) throw new Error(`${what} is too long (max ${max})`);
  return v;
};

/** Validate and normalise ONE step coming from the editor (or an import). Unknown fields are dropped. */
export function sanitizeStep(raw, n = 1) {
  const at = `Step ${n}`;
  if (!raw || typeof raw !== "object") throw new Error(`${at}: invalid step`);
  const type = raw.type;
  if (!STEP_TYPES.includes(type)) throw new Error(`${at}: unknown step type "${type}"`);
  const s = { type };
  if (Array.isArray(raw.selectors)) {
    const list = raw.selectors.map((x) => str(x, 2000, `${at}: selector`).trim()).filter(Boolean);
    if (list.length > 10) throw new Error(`${at}: at most 10 selector candidates`);
    if (list.length) s.selectors = list;
  }
  if (raw.selector != null && raw.selector !== "") s.selector = str(raw.selector, 2000, `${at}: selector`).trim();
  if (!s.selector && s.selectors) s.selector = s.selectors[0];
  const needsTarget = ["click", "hover", "input", "select", "check", "press"].includes(type) || (type === "assert" && raw.kind !== "url");
  if (needsTarget && !s.selector) throw new Error(`${at}: ${type} needs a selector`);

  if (type === "goto" || type === "navigate") {
    s.url = str(raw.url, 4000, `${at}: url`).trim();
    if (!/^https?:\/\//i.test(s.url)) throw new Error(`${at}: url must start with http:// or https://`);
  }
  if (type === "input" || type === "select") s.value = str(raw.value ?? "", 10000, `${at}: value`);
  if (type === "check") s.checked = Boolean(raw.checked);
  if (type === "press") s.key = str(raw.key || "Enter", 30, `${at}: key`).trim();
  if (type === "wait") {
    const ms = Number(raw.ms);
    if (!Number.isFinite(ms) || ms < 0 || ms > 600000) throw new Error(`${at}: wait must be 0-600000 ms`);
    s.ms = Math.round(ms);
  }
  if (type === "assert") {
    if (!ASSERT_KINDS.includes(raw.kind)) throw new Error(`${at}: check type must be text, visible or url`);
    s.kind = raw.kind;
    if (raw.kind === "text" || raw.kind === "url") {
      s.value = str(raw.value ?? "", 10000, `${at}: expected value`);
      if (!s.value) throw new Error(`${at}: the check needs an expected value`);
    }
  }
  if (raw.disabled) s.disabled = true;
  if (typeof raw.note === "string" && raw.note.trim()) s.note = raw.note.trim().slice(0, 500);
  if (Number.isFinite(raw.timestamp)) s.timestamp = raw.timestamp;
  if (raw.redacted) s.redacted = true;
  return s;
}

export function sanitizeSteps(list) {
  if (!Array.isArray(list)) throw new Error("steps must be a list");
  if (list.length > MAX_STEPS) throw new Error(`Too many steps (max ${MAX_STEPS})`);
  return list.map((s, i) => sanitizeStep(s, i + 1));
}
