/* global document, window, location, history, confirm, prompt, structuredClone, scrollTo, innerWidth */
// Bugassay web UI. No innerHTML anywhere: all text goes through textContent (CSP: script-src 'self').
const TOKEN = document.querySelector('meta[name="bugassay-token"]').content;
const $ = (id) => document.getElementById(id);
const view = $("view");

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "value") el.value = v;
    else if (k === "checked" || k === "disabled" || k === "selected") el[k] = Boolean(v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
}
const svgEl = (tag, attrs, ...kids) => {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, String(v));
  for (const kid of kids) if (kid) el.append(kid);
  return el;
};

async function api(path, body) {
  const opt = body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json", "x-bugassay-token": TOKEN }, body: JSON.stringify(body) };
  const r = await fetch(path, opt);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}
let toastTimer;
function toast(msg, err = false) {
  const t = $("toast");
  t.textContent = msg;
  t.className = "toast" + (err ? " err" : "");
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), err ? 6000 : 2500);
}
const guard = (fn) => async (...a) => {
  try {
    return await fn(...a);
  } catch (e) {
    toast(e.message, true);
  }
};

const ICON = { ok: "✓", fixed: "✓", open: "●", regression: "✗", broken: "!", unverified: "?", ignored: "–", regressed: "✗", wontfix: "–", notRun: "" };
function badge(kind, text) {
  return h("span", { class: `badge b-${kind}`, "data-icon": ICON[kind] || "" }, text);
}
const fmtMs = (ms) => (ms == null ? "-" : ms >= 10000 ? `${Math.round(ms / 1000)}s` : `${(ms / 1000).toFixed(1)}s`);
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "-");

/* ---------- tooltip ---------- */
const tip = $("tip");
function showTip(ev, lines) {
  tip.replaceChildren(...lines.map((l) => h("div", {}, l)));
  tip.hidden = false;
  const x = Math.min(ev.clientX + 12, innerWidth - tip.offsetWidth - 8);
  tip.style.left = `${Math.max(4, x)}px`;
  tip.style.top = `${ev.clientY + 14}px`;
}
const hideTip = () => (tip.hidden = true);

/* ---------- job panel ---------- */
let jobId = null;
let jobFrom = 0;
let pollTimer = null;
let lastJobStatus = null;
async function pollJob() {
  clearTimeout(pollTimer);
  let data;
  try {
    data = await api(`/api/job?id=${jobId ?? ""}&from=${jobFrom}`);
  } catch {
    pollTimer = setTimeout(pollJob, 2000);
    return;
  }
  if (!data.job) return;
  const j = data.job;
  if (j.id !== jobId) {
    jobId = j.id;
    jobFrom = 0;
    $("job-log").textContent = "";
    data = await api(`/api/job?id=${jobId}&from=0`);
  }
  $("job").hidden = false;
  $("job-title").textContent = j.title;
  const st = $("job-status");
  st.textContent = j.status;
  st.className = `badge b-${j.status}`;
  const log = $("job-log");
  if (data.lines.length) {
    log.textContent += (log.textContent ? "\n" : "") + data.lines.join("\n");
    log.scrollTop = log.scrollHeight;
  }
  jobFrom = data.next;
  $("job-finish").hidden = !(j.status === "running" && j.canStop);
  $("job-kill").hidden = j.status !== "running";
  if (j.status === "running") pollTimer = setTimeout(pollJob, 700);
  else if (lastJobStatus === "running" || lastJobStatus === null) {
    lastJobStatus = j.status;
    route();
    return;
  }
  lastJobStatus = j.status;
}
const runJob = guard(async (body) => {
  await api("/api/run", body);
  lastJobStatus = "running";
  jobId = null;
  pollJob();
});
$("job-close").onclick = () => ($("job").hidden = true);
$("job-finish").onclick = guard(() => api("/api/stop", { mode: "finish" }));
$("job-kill").onclick = guard(() => api("/api/stop", { mode: "kill" }));
$("btn-record").onclick = () => recordDialog();
$("btn-all").onclick = () => {
  if (confirm("Replay every recording with status open, fixed or regressed?\nThe browser runs hidden; open bugs may change status automatically.")) runJob({ action: "replayAll", parallel: 2 });
};
$("btn-login").onclick = () => {
  if (confirm("A browser window opens. Log in, then press 'Finish recording' here (or close the window).")) runJob({ action: "login" });
};
function recordDialog() {
  const url = prompt("URL to record (empty = url from Settings):", "");
  if (url === null) return;
  const label = prompt("Short label (optional):", "") || "";
  runJob({ action: "record", url: url.trim() || undefined, label: label.trim() || undefined });
}

/* ---------- dashboard ---------- */
const state = { sort: "name", dir: 1, filter: "", status: "", chartTable: false, data: null };

function kpi(label, value, cls = "") {
  return h("div", { class: `kpi ${cls}` }, h("div", { class: "v" }, value), h("div", { class: "l" }, label));
}
function sparkEl(outcomes) {
  const pad = Array(Math.max(0, 10 - outcomes.length)).fill("");
  return h("span", { class: "spark", title: "last 10 runs" }, [...pad, ...outcomes].map((o) => h("i", { class: o })));
}

function chartCard(daily) {
  const total = daily.reduce((n, d) => n + d.pass + d.bugPresent + d.broken, 0);
  const card = h("div", { class: "card" });
  const head = h("div", { class: "toolbar" }, h("h2", {}, "Runs, last 14 days"), h("span", { class: "spacer" }),
    h("button", { class: "btn small", onclick: () => { state.chartTable = !state.chartTable; render(); } }, state.chartTable ? "Show chart" : "Show table"));
  card.append(head);
  if (!total) return card.append(h("div", { class: "empty" }, "No replays yet. Run a replay and the numbers appear here.")), card;
  card.append(h("div", { class: "legend" },
    h("span", {}, h("span", { class: "sw f-pass" }), "Pass"),
    h("span", {}, h("span", { class: "sw f-bug" }), "Bug present (a check failed)"),
    h("span", {}, h("span", { class: "sw f-broken" }), "Broken (a step failed)")));
  if (state.chartTable) {
    card.append(h("div", { class: "tablewrap" }, h("table", {},
      h("thead", {}, h("tr", {}, ["Day", "Pass", "Bug present", "Broken"].map((t, i) => h("th", { class: i ? "num" : "" }, t)))),
      h("tbody", {}, daily.map((d) => h("tr", {}, h("td", {}, d.day), h("td", { class: "num" }, d.pass), h("td", { class: "num" }, d.bugPresent), h("td", { class: "num" }, d.broken)))))));
    return card;
  }
  const W = 900, H = 220, L = 34, B = 24, T = 8;
  const max = Math.max(1, ...daily.map((d) => d.pass + d.bugPresent + d.broken));
  const nice = max <= 4 ? max : Math.ceil(max / 4) * 4;
  const svg = svgEl("svg", { class: "chart", viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Stacked bars of replay results per day" });
  const plotH = H - B - T;
  const y = (v) => T + plotH - (v / nice) * plotH;
  const ticks = nice <= 4 ? Array.from({ length: nice + 1 }, (_, i) => i) : [0, 1, 2, 3, 4].map((i) => (nice / 4) * i);
  for (const t of ticks) {
    svg.append(svgEl("line", { class: "grid", x1: L, x2: W, y1: y(t), y2: y(t) }));
    const tx = svgEl("text", { x: L - 6, y: y(t) + 4, "text-anchor": "end" });
    tx.textContent = String(t);
    svg.append(tx);
  }
  const slot = (W - L) / daily.length;
  const bw = Math.min(34, slot * 0.6);
  daily.forEach((d, i) => {
    const x = L + slot * i + (slot - bw) / 2;
    let base = 0;
    const segs = [["f-pass", d.pass], ["f-bug", d.bugPresent], ["f-broken", d.broken]];
    for (const [cls, v] of segs) {
      if (!v) continue;
      const y1 = y(base + v), y0 = y(base);
      svg.append(svgEl("rect", { class: cls, x, y: y1, width: bw, height: Math.max(1, y0 - y1 - 2), rx: 3 }));
      base += v;
    }
    const lab = svgEl("text", { x: x + bw / 2, y: H - 6, "text-anchor": "middle" });
    lab.textContent = d.day.slice(5);
    if (daily.length <= 7 || i % 2 === 0) svg.append(lab);
    const hit = svgEl("rect", { class: "hit", x: L + slot * i, y: T, width: slot, height: plotH });
    hit.addEventListener("mousemove", (ev) => showTip(ev, [d.day, `Pass: ${d.pass}`, `Bug present: ${d.bugPresent}`, `Broken: ${d.broken}`]));
    hit.addEventListener("mouseleave", hideTip);
    svg.append(hit);
  });
  card.append(svg);
  return card;
}

function recordingsCard(st) {
  const card = h("div", { class: "card" });
  const q = h("input", { type: "search", placeholder: "Filter...", value: state.filter, "aria-label": "Filter recordings" });
  q.addEventListener("input", () => { state.filter = q.value; renderRows(); });
  const sel = h("select", { "aria-label": "Status filter" }, h("option", { value: "" }, "All statuses"), st.statuses.map((s) => h("option", { value: s, selected: state.status === s }, s)));
  sel.addEventListener("change", () => { state.status = sel.value; renderRows(); });
  card.append(h("div", { class: "toolbar" }, h("h2", {}, "Recordings"), h("span", { class: "spacer" }), q, sel));
  const cols = [["name", "Recording"], ["status", "Status"], ["lastVerdict", "Last result"], ["pass", "Pass", 1], ["fail", "Fail", 1], ["passRate", "Rate", 1], ["spark", "Last 10"], ["avgMs", "Avg", 1], ["steps", "Steps", 1]];
  const tbody = h("tbody");
  const thead = h("thead", {}, h("tr", {}, cols.map(([k, t, num]) => h("th", { class: `sort${num ? " num" : ""}`, onclick: () => { state.dir = state.sort === k ? -state.dir : 1; state.sort = k; render(); } }, t + (state.sort === k ? (state.dir > 0 ? " ▲" : " ▼") : ""))), h("th")));
  card.append(h("div", { class: "tablewrap" }, h("table", {}, thead, tbody)));
  const empty = h("div", { class: "empty" }, "No recordings yet. Click Record, or run: npx bugassay record");
  card.append(empty);
  function renderRows() {
    const f = state.filter.toLowerCase();
    const rows = st.rows
      .filter((r) => (!state.status || r.status === state.status) && (!f || r.name.toLowerCase().includes(f) || r.label.toLowerCase().includes(f)))
      .sort((a, b) => {
        const k = state.sort;
        const va = a[k] ?? -1, vb = b[k] ?? -1;
        return (va < vb ? -1 : va > vb ? 1 : 0) * state.dir;
      });
    empty.hidden = st.rows.length > 0;
    tbody.replaceChildren(...rows.map(rowEl));
  }
  function rowEl(r) {
    const statusSel = h("select", { "aria-label": `Status of ${r.name}` }, st.statuses.map((s) => h("option", { value: s, selected: s === r.status }, s)));
    statusSel.addEventListener("change", guard(async () => { await api("/api/status", { name: r.name, status: statusSel.value }); toast("Status updated"); load(); }));
    return h("tr", {},
      h("td", { class: "name" }, h("a", { href: `#/rec/${encodeURIComponent(r.name)}` }, r.label || r.name), h("div", { class: "sub" }, r.label ? r.name : r.url || "")),
      h("td", {}, statusSel),
      h("td", {}, r.runs ? badge(r.lastVerdict, st.verdictLabels[r.lastVerdict]) : h("span", { class: "muted" }, "not replayed"), r.flaky ? h("span", { class: "flaky", title: "Results flip between runs" }, "flaky") : null),
      h("td", { class: "num" }, r.pass), h("td", { class: "num" }, r.fail),
      h("td", { class: "num" }, r.passRate == null ? "-" : `${r.passRate}%`),
      h("td", {}, sparkEl(r.spark)),
      h("td", { class: "num" }, fmtMs(r.avgMs)),
      h("td", { class: "num", title: `${r.checks} checks` }, r.steps),
      h("td", { class: "actions" },
        h("button", { class: "btn small primary", onclick: () => runJob({ action: "replay", name: r.name }) }, "Replay"),
        h("a", { class: "btn small", href: `#/rec/${encodeURIComponent(r.name)}` }, "Edit"),
        h("a", { class: "btn small", href: `/files/${encodeURIComponent(r.name)}/report.html`, target: "_blank", rel: "noopener" }, "Report"),
        h("button", { class: "btn small danger", onclick: guard(async () => { if (confirm(`Delete "${r.name}" permanently?`)) { await api("/api/delete", { name: r.name }); toast("Deleted"); load(); } }) }, "Delete")));
  }
  renderRows();
  return card;
}

function recentCard(st) {
  const card = h("div", { class: "card" }, h("h2", {}, "Recent runs"));
  if (!st.recent.length) return card.append(h("div", { class: "empty" }, "Nothing yet.")), card;
  card.append(h("div", { class: "tablewrap" }, h("table", {},
    h("thead", {}, h("tr", {}, ["When", "Recording", "Result", "Steps", "Time", "Failed step"].map((t) => h("th", {}, t)))),
    h("tbody", {}, st.recent.map((r) => h("tr", {},
      h("td", {}, fmtDate(r.at)),
      h("td", {}, h("a", { href: `#/rec/${encodeURIComponent(r.name)}` }, r.label || r.name)),
      h("td", {}, badge(r.verdict, st.verdictLabels[r.verdict] || r.verdict)),
      h("td", {}, `${r.passed}/${r.total}`), h("td", {}, fmtMs(r.ms)),
      h("td", { class: "muted" }, r.failedStep ? `#${r.failedStep}${r.error ? " " + String(r.error).slice(0, 80) : ""}` : ""))))))); 
  return card;
}

function renderDashboard() {
  const st = state.data;
  const t = st.totals;
  view.replaceChildren(
    h("div", { class: "kpis" },
      kpi("Recordings", t.recordings), kpi("Open bugs", st.byStatus.open || 0), kpi("Fixed", st.byStatus.fixed || 0, "good"),
      kpi("Regressed", st.byStatus.regressed || 0, st.byStatus.regressed ? "crit" : ""),
      kpi("Runs", t.runs), kpi("Pass", t.pass, "good"), kpi("Fail", t.fail, t.fail ? "crit" : ""),
      kpi("Pass rate", t.passRate == null ? "-" : `${t.passRate}%`)),
    chartCard(st.daily), recordingsCard(st), recentCard(st));
}

/* ---------- step editor ---------- */
const TYPES = ["goto", "navigate", "click", "hover", "input", "select", "check", "press", "assert", "wait"];
const NEW_STEP = {
  click: { type: "click", selectors: [""] }, hover: { type: "hover", selectors: [""] }, input: { type: "input", selectors: [""], value: "" },
  select: { type: "select", selectors: [""], value: "" }, check: { type: "check", selectors: [""], checked: true }, press: { type: "press", selectors: [""], key: "Enter" },
  assert: { type: "assert", kind: "text", selectors: [""], value: "" }, wait: { type: "wait", ms: 1000 }, goto: { type: "goto", url: "https://" }, navigate: { type: "navigate", url: "https://" },
};
const ed = { name: null, rec: null, steps: [], label: "", dirty: false, bad: new Set(), tab: "steps" };
const markDirty = () => { ed.dirty = true; const b = $("save-btn"); if (b) b.disabled = false; const d = $("dirty"); if (d) d.textContent = "Unsaved changes"; };
window.addEventListener("beforeunload", (e) => { if (ed.dirty) { e.preventDefault(); e.returnValue = ""; } });

async function openEditor(name) {
  const { recording } = await api(`/api/recording?name=${encodeURIComponent(name)}`);
  Object.assign(ed, { name, rec: recording, steps: structuredClone(recording.steps), label: recording.name || "", dirty: false, bad: new Set(), tab: "steps" });
  renderEditor();
}
function stepCard(s, i) {
  const move = (d) => { const j = i + d; if (j < 0 || j >= ed.steps.length) return; [ed.steps[i], ed.steps[j]] = [ed.steps[j], ed.steps[i]]; markDirty(); renderEditor(); };
  const typeSel = h("select", {}, TYPES.map((t) => h("option", { value: t, selected: t === s.type }, t)));
  typeSel.addEventListener("change", () => { const keep = { disabled: s.disabled, note: s.note }; ed.steps[i] = { ...structuredClone(NEW_STEP[typeSel.value]), ...(keep.disabled ? { disabled: true } : {}), ...(keep.note ? { note: keep.note } : {}) }; markDirty(); renderEditor(); });
  const on = h("input", { type: "checkbox", checked: !s.disabled, title: "Enabled" });
  on.addEventListener("change", () => { if (on.checked) delete s.disabled; else s.disabled = true; markDirty(); renderEditor(); });
  const field = (label, input, wide) => h("label", { class: `f${wide ? " wide" : ""}` }, label, input);
  const text = (key, ph) => { const el = h("input", { type: "text", value: s[key] ?? "", placeholder: ph || "" }); el.addEventListener("input", () => { s[key] = el.value; markDirty(); }); return el; };
  const sels = () => { const el = h("textarea", { rows: 2, placeholder: "One selector per line (first visible one wins)" }); el.value = (s.selectors || (s.selector ? [s.selector] : [])).join("\n"); el.addEventListener("input", () => { s.selectors = el.value.split("\n").map((x) => x.trim()).filter(Boolean); s.selector = s.selectors[0] || ""; markDirty(); }); return field("Selectors", el, true); };
  const body = [];
  if (["goto", "navigate"].includes(s.type)) body.push(field("URL", text("url", "https://..."), true));
  if (["click", "hover", "input", "select", "check", "press"].includes(s.type)) body.push(sels());
  if (["input", "select"].includes(s.type)) body.push(field(s.type === "select" ? "Option value" : "Text", text("value")));
  if (s.type === "check") { const c = h("input", { type: "checkbox", checked: s.checked !== false }); c.addEventListener("change", () => { s.checked = c.checked; markDirty(); }); body.push(h("label", { class: "f inline" }, c, "Checked")); }
  if (s.type === "press") body.push(field("Key", text("key", "Enter")));
  if (s.type === "wait") { const el = h("input", { type: "number", min: 0, max: 600000, step: 100, value: s.ms ?? 1000 }); el.addEventListener("input", () => { s.ms = Number(el.value); markDirty(); }); body.push(field("Wait (ms)", el)); }
  if (s.type === "assert") {
    const k = h("select", {}, ["text", "visible", "url"].map((x) => h("option", { value: x, selected: x === s.kind }, x === "text" ? "Element has text" : x === "visible" ? "Element is visible" : "URL contains")));
    k.addEventListener("change", () => { s.kind = k.value; markDirty(); renderEditor(); });
    body.push(field("Check", k));
    if (s.kind !== "url") body.push(sels());
    if (s.kind !== "visible") body.push(field(s.kind === "url" ? "URL contains" : "Expected text", text("value")));
  }
  body.push(field("Note (optional)", text("note")));
  return h("div", { class: `step ${s.type}${s.disabled ? " off" : ""}${ed.bad.has(i) ? " bad" : ""}`, id: `step-${i}` },
    h("div", { class: "step-head" }, h("span", { class: "idx" }, `#${i + 1}`), on, typeSel, h("span", { class: "spacer" }),
      h("button", { class: "btn", title: "Move up", onclick: () => move(-1) }, "↑"), h("button", { class: "btn", title: "Move down", onclick: () => move(1) }, "↓"),
      h("button", { class: "btn", title: "Duplicate", onclick: () => { ed.steps.splice(i + 1, 0, structuredClone(s)); markDirty(); renderEditor(); } }, "Copy"),
      h("button", { class: "btn", title: "Add a wait below", onclick: () => { ed.steps.splice(i + 1, 0, { type: "wait", ms: 1000 }); markDirty(); renderEditor(); } }, "+ wait"),
      h("button", { class: "btn danger", title: "Delete", onclick: () => { ed.steps.splice(i, 1); markDirty(); renderEditor(); } }, "Delete")),
    h("div", { class: "step-body" }, body));
}
const saveEditor = guard(async () => {
  try {
    const { steps } = await api("/api/recording/save", { name: ed.name, label: ed.label, steps: ed.steps });
    ed.dirty = false;
    ed.bad.clear();
    toast(`Saved (${steps} steps). Backup: bug.json.bak`);
    renderEditor();
  } catch (e) {
    const m = /^Step (\d+):/.exec(e.message);
    if (m) { ed.bad = new Set([Number(m[1]) - 1]); renderEditor(); document.getElementById(`step-${Number(m[1]) - 1}`)?.scrollIntoView({ block: "center" }); }
    throw e;
  }
});
function renderEditor() {
  const r = ed.rec;
  const label = h("input", { type: "text", value: ed.label, placeholder: "Label", "aria-label": "Label" });
  label.addEventListener("input", () => { ed.label = label.value; markDirty(); });
  const statusSel = h("select", {}, ["open", "fixed", "regressed", "wontfix"].map((s) => h("option", { value: s, selected: s === r.status }, s)));
  statusSel.addEventListener("change", guard(async () => { await api("/api/status", { name: ed.name, status: statusSel.value }); r.status = statusSel.value; toast("Status updated"); }));
  const addSel = h("select", { "aria-label": "Step type to add" }, TYPES.map((t) => h("option", { value: t }, t)));
  const hasCheck = ed.steps.some((s) => s.type === "assert" && !s.disabled);
  const tabs = h("div", { class: "toolbar" },
    ["steps", "report"].map((t) => h("button", { class: `btn${ed.tab === t ? " primary" : ""}`, onclick: () => { ed.tab = t; renderEditor(); } }, t === "steps" ? "Steps" : "Report")));
  const stepsView = h("div", {},
    hasCheck ? null : h("div", { class: "card muted" }, "This recording has no checks. Without a check, replay cannot tell whether the bug is gone (result: UNVERIFIED). Add a step of type \"assert\"."),
    h("div", { class: "steps" }, ed.steps.map(stepCard)),
    h("div", { class: "toolbar", style: false }, addSel, h("button", { class: "btn", onclick: () => { ed.steps.push(structuredClone(NEW_STEP[addSel.value])); markDirty(); renderEditor(); scrollTo(0, document.body.scrollHeight); } }, "Add step")));
  const reportView = h("iframe", { class: "report", src: `/files/${encodeURIComponent(ed.name)}/report.html`, sandbox: "", title: "Report" });
  view.replaceChildren(
    h("div", { class: "toolbar" }, h("a", { href: "#/" }, "← Dashboard"), h("h1", { style: false }, r.name || ed.name), h("span", { class: "spacer" }), "Status:", statusSel,
      h("button", { class: "btn primary", onclick: () => { if (ed.dirty) toast("Save first, replay uses the saved file.", true); else runJob({ action: "replay", name: ed.name }); } }, "Replay")),
    h("div", { class: "card" }, h("div", { class: "grid2" },
      h("label", { class: "f" }, "Label", label),
      h("div", { class: "f" }, "Recording", h("span", { class: "muted" }, `${ed.name} · ${r.url || ""}`))),
      (r.history || []).length ? h("ul", { class: "hist" }, (r.history || []).slice(-5).reverse().map((x) => h("li", {}, `${fmtDate(x.at)}: ${x.from || "-"} → ${x.to} (${x.reason})`))) : null),
    tabs, ed.tab === "steps" ? stepsView : reportView,
    ed.tab === "steps" ? h("div", { class: "sticky-save" }, h("button", { id: "save-btn", class: "btn primary", disabled: !ed.dirty, onclick: saveEditor }, "Save"), h("span", { id: "dirty", class: "muted" }, ed.dirty ? "Unsaved changes" : "Saved"),
      h("span", { class: "spacer" }), h("span", { class: "muted" }, `${ed.steps.length} steps`)) : null);
}

/* ---------- settings ---------- */
async function renderSettings() {
  const { config: c, cwd } = await api("/api/config");
  const fields = [["url", "Application URL"], ["browserPath", "Browser path (empty = Playwright Chromium)"], ["delay", "Delay after each step (ms)", "number"], ["typingDelay", "Typing delay (ms)", "number"], ["timeout", "Timeout (ms)", "number"], ["viewport", "Viewport (WxH)"], ["session", "Session file (empty = off)"], ["hoverMs", "Hover dwell when recording (ms, 0 = off)", "number"], ["hoverWait", "Hover wait on replay (ms)", "number"], ["replay", "Default recording for 'replay'"], ["headless", "Replay in a hidden browser", "bool"], ["video", "Record video", "bool"], ["stepScreenshots", "Screenshot after each step", "bool"], ["autoStatus", "Change bug status automatically (open → fixed, fixed → regressed)", "bool"]];
  const inputs = {};
  const rows = fields.map(([k, t, kind]) => {
    const el = kind === "bool" ? h("input", { type: "checkbox", checked: Boolean(c[k]) }) : h("input", { type: kind === "number" ? "number" : "text", value: c[k] === false ? "" : c[k] ?? "" });
    inputs[k] = [el, kind];
    return kind === "bool" ? h("label", { class: "f inline" }, el, t) : h("label", { class: "f" }, t, el);
  });
  view.replaceChildren(h("h1", {}, "Settings"), h("div", { class: "card" }, h("div", { class: "grid2" }, rows),
    h("p", { class: "muted" }, `config.json in ${cwd}`),
    h("div", { class: "toolbar" }, h("button", { class: "btn primary", onclick: guard(async () => {
      const body = {};
      for (const [k, [el, kind]] of Object.entries(inputs)) body[k] = kind === "bool" ? el.checked : el.value;
      await api("/api/config", body);
      toast("Saved");
    }) }, "Save"), h("button", { class: "btn", onclick: () => runJob({ action: "doctor" }) }, "Run doctor"))));
}

/* ---------- routing ---------- */
async function load() {
  hideTip();
  state.data = await api("/api/stats");
  if (!location.hash || location.hash === "#/") render();
}
function render() { if (state.data) renderDashboard(); }
const route = guard(async () => {
  hideTip();
  const hash = location.hash || "#/";
  for (const a of document.querySelectorAll("nav a")) a.classList.toggle("active", (a.dataset.nav === "settings") === hash.startsWith("#/settings"));
  const m = /^#\/rec\/(.+)$/.exec(hash);
  if (m) {
    if (ed.dirty && ed.name === decodeURIComponent(m[1])) return renderEditor();
    return openEditor(decodeURIComponent(m[1]));
  }
  if (hash.startsWith("#/settings")) return renderSettings();
  await load();
});
let reverting = false;
window.addEventListener("hashchange", () => {
  if (reverting) { reverting = false; return; }
  if (ed.dirty && !confirm("Discard unsaved changes?")) { reverting = true; history.back(); return; }
  ed.dirty = false;
  route();
});
route();
pollJob();
