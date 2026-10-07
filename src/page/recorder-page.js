/* global document, window, location, CSS, getComputedStyle, XPathResult, MutationObserver */
// Runs INSIDE the recorded page (injected with page.addInitScript).
// It must stay self-contained: Playwright serializes this function, so it cannot import anything.
export function installRecorder(conf) {
  const pick = (el) => {
    if (!el) return "";
    if (el.id) return `#${CSS.escape(el.id)}`;
    const test = el.getAttribute("data-testid");
    if (test) return `[data-testid="${CSS.escape(test)}"]`;
    const name = el.getAttribute("name");
    if (name)
      return `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
    const aria = el.getAttribute("aria-label");
    if (aria)
      return `${el.tagName.toLowerCase()}[aria-label="${CSS.escape(aria)}"]`;
    let cur = el,
      parts = [];
    for (let i = 0; cur && i < 5; i++, cur = cur.parentElement) {
      let p = cur.tagName.toLowerCase(),
        parent = cur.parentElement;
      if (parent) {
        const same = [...parent.children].filter(
          (x) => x.tagName === cur.tagName,
        );
        if (same.length > 1) p += `:nth-of-type(${same.indexOf(cur) + 1})`;
      }
      parts.unshift(p);
    }
    return parts.join(" > ");
  };
  // ---- selector candidates: several ways to find the same element on replay ----
  const vis = (el) => {
    if (!el.getClientRects().length) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none";
  };
  const unstableId = (v) =>
    /\d{3,}|[0-9a-f]{8}-[0-9a-f]{4}|^:r|^radix-|^ember|^react-|^mui-|^headlessui|^__|^rc[-_]|^ant-/i.test(v);
  const q = (v) => '"' + String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
  const xlit = (t) =>
    !t.includes('"')
      ? '"' + t + '"'
      : !t.includes("'")
        ? "'" + t + "'"
        : "concat(" + t.split('"').map((x) => '"' + x + '"').join(",'\"',") + ")";
  const unique = (el, css) => {
    try {
      const all = [...document.querySelectorAll(css)];
      return all.includes(el) && all.filter(vis).length <= 1;
    } catch {
      return false;
    }
  };
  const cands = (el) => {
    const out = [];
    const tag = el.tagName.toLowerCase();
    const add = (css) => {
      if (css && !out.includes(css) && unique(el, css)) out.push(css);
    };
    if (el.id && !unstableId(el.id)) add(`[id=${q(el.id)}]`);
    for (const a of ["data-testid", "data-test", "data-qa", "data-cy", "data-automation-id", "data-id"]) {
      const v = el.getAttribute(a);
      if (v) add(`[${a}=${q(v)}]`);
    }
    for (const a of ["name", "aria-label", "placeholder", "title", "alt"]) {
      const v = el.getAttribute(a);
      if (v) add(`${tag}[${a}=${q(v)}]`);
    }
    const href = el.getAttribute("href");
    if (href && !/^(#|javascript:)/i.test(href)) add(`${tag}[href=${q(href)}]`);
    const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    if (text && text.length <= 60 && !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) {
      try {
        const xp = `//${tag}[normalize-space(.)=${xlit(text)}]`;
        const it = document.evaluate(xp, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        const all = [];
        for (let i = 0; i < it.snapshotLength; i++) all.push(it.snapshotItem(i));
        if (all.includes(el) && all.filter(vis).length <= 1) out.push("xpath=" + xp);
      } catch {
        /* ignore */
      }
    }
    const res = out.slice(0, 4);
    const css = pick(el);
    if (css && !res.includes(css)) res.push(css);
    return res;
  };
  // NOTE: redaction intentionally disabled so login flows can be replayed.
  // ---- assertion toolbar (top frame only) ----
  let armed = null;
  let hl = null,
    hlOld = "";
  let ui = null;
  const HOST_ID = "__bugassay_ui";
  const inUi = (e) =>
    (e.composedPath?.() || []).some((n) => n && n.id === HOST_ID);
  const textOf = (el) =>
    (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
      ? el.value
      : el.innerText || el.textContent || ""
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
  const toast = (m) => {
    if (!ui) return;
    ui.t.textContent = m;
    clearTimeout(ui.tm);
    ui.tm = setTimeout(() => (ui.t.textContent = ""), 2500);
  };
  const unhl = () => {
    if (hl) {
      hl.style.outline = hlOld;
      hl = null;
    }
  };
  const setArmed = (k) => {
    armed = k;
    unhl();
    document.documentElement.style.cursor = k ? "crosshair" : "";
    if (ui) ui.btns.forEach((b) => b.classList.toggle("on", b.dataset.k === k));
    if (k)
      toast(
        k === "text"
          ? "Click the element whose text must match"
          : k === "hover"
            ? "Click the element to hover over (opens its menu)"
            : "Click the element that must be visible",
      );
  };
  const mountUi = () => {
    if (window.top !== window || document.getElementById(HOST_ID)) return;
    const host = document.createElement("div");
    host.id = HOST_ID;
    host.style.cssText =
      "position:fixed;right:12px;bottom:12px;z-index:2147483647";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML =
      '<style>div{font:12px system-ui,sans-serif}.p{display:flex;gap:6px;align-items:center;background:#111;color:#fff;padding:6px 8px;border-radius:10px;box-shadow:0 2px 10px #0006}b{color:#ff4d4d}button{background:#333;color:#fff;border:0;border-radius:6px;padding:5px 8px;cursor:pointer;font:inherit}button.on{background:#e11d48}.t{color:#fff;background:#111;margin-top:4px;padding:3px 8px;border-radius:6px;display:inline-block}.t:empty{display:none}</style><div class="p"><b>● REC</b><button data-k="text">Assert text</button><button data-k="visible">Assert visible</button><button data-k="url">Assert URL</button><button data-k="hover">Add hover</button></div><div class="t"></div>';
    ui = {
      t: root.querySelector(".t"),
      btns: [...root.querySelectorAll("button")],
      tm: 0,
    };
    root.addEventListener("click", (ev) => {
      const k = ev.target?.dataset?.k;
      if (!k) return;
      if (k === "url") {
        window.__bugassayPush({ type: "assert", kind: "url", value: location.href });
        toast("URL check added");
      } else setArmed(armed === k ? null : k);
    });
    document.documentElement.appendChild(host);
  };
  document.addEventListener("DOMContentLoaded", mountUi);
  if (document.readyState !== "loading") mountUi();
  // ---- hover recording ----
  const INTERACTIVE =
    'a,button,[role="menuitem"],[role="button"],[role="tab"],[aria-haspopup],[aria-expanded],summary,li';
  const CLICKABLE =
    'button,a,input,select,textarea,[role="button"],[role="menuitem"],[role="option"],[role="tab"],[role="link"],summary';
  const trig = (el) => el?.closest?.(INTERACTIVE) || null;
  const hoverTarget = (el) => trig(el) || el;
  let hoverTimer = 0;
  let lastHover = "";
  let lastClickAt = 0;
  const hist = [];
  const added = new WeakMap();
  new MutationObserver((ms) => {
    const now = Date.now();
    for (const m of ms)
      for (const n of m.addedNodes) if (n.nodeType === 1) added.set(n, now);
  }).observe(document, { childList: true, subtree: true });
  const addedAt = (n) => {
    for (let p = n; p; p = p.parentElement) if (added.has(p)) return added.get(p);
    return 0;
  };
  const pushHover = (el) => {
    const sel = pick(el);
    if (sel === lastHover) return;
    lastHover = sel;
    window.__bugassayPush({ type: "hover", selector: sel, selectors: cands(el) });
  };
  const dwell = (e) => {
    clearTimeout(hoverTimer);
    if (inUi(e)) return;
    const t = trig(e.target);
    if (t && (!hist.length || hist[hist.length - 1].el !== t)) {
      hist.push({ el: t, t: Date.now() });
      if (hist.length > 12) hist.shift();
    }
    if (!conf.hoverMs || armed || !t) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    hoverTimer = setTimeout(() => {
      if (t.isConnected) pushHover(t);
    }, conf.hoverMs);
  };
  document.addEventListener("mousemove", dwell, true);
  document.addEventListener("mousedown", () => clearTimeout(hoverTimer), true);
  document.addEventListener(
    "mouseover",
    (e) => {
      if (!armed || inUi(e)) return;
      unhl();
      hl = e.target;
      hlOld = hl.style.outline;
      hl.style.outline = "2px solid #e11d48";
    },
    true,
  );
  document.addEventListener(
    "click",
    (e) => {
      if (inUi(e)) return;
      if (armed) {
        e.preventDefault();
        e.stopImmediatePropagation();
        const el = e.target;
        const kind = armed;
        if (kind === "hover") {
          unhl();
          setArmed(null);
          window.__bugassayPush({ type: "hover", selector: pick(hoverTarget(el)), selectors: cands(hoverTarget(el)) });
          toast("Hover added");
          return;
        }
        const value = kind === "text" ? textOf(el) : undefined;
        unhl();
        if (kind === "text" && !value) {
          toast("That element has no text");
          return;
        }
        setArmed(null);
        window.__bugassayPush({
          type: "assert",
          kind,
          selector: pick(el),
          selectors: cands(el),
          ...(value !== undefined ? { value } : {}),
        });
        toast("Check added");
        return;
      }
      const t = e.target?.closest?.(CLICKABLE) || e.target;
      if (t) {
        // Target lives in a popup that was added right after the pointer entered a trigger
        const at = addedAt(t);
        if (at) {
          const z = [...hist].reverse().find(
            (h) =>
              h.t > lastClickAt &&
              h.t <= at &&
              at - h.t < 2500 &&
              h.el.isConnected &&
              !h.el.contains(t) &&
              !t.contains(h.el),
          );
          if (z) pushHover(z.el);
        }
        window.__bugassayPush({ type: "click", selector: pick(t), selectors: cands(t) });
        lastHover = "";
      }
      lastClickAt = Date.now();
    },
    true,
  );
  document.addEventListener(
    "keydown",
    (e) => {
      if (inUi(e)) return;
      const t = e.target;
      if (!t || !t.tagName) return;
      const isField = t.matches?.(
        'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]),textarea',
      );
      if ((e.key === "Enter" && isField && t.tagName !== "TEXTAREA") || e.key === "Escape")
        window.__bugassayPush({ type: "press", key: e.key, selector: pick(t), selectors: cands(t) });
    },
    true,
  );
  document.addEventListener(
    "input",
    (e) => {
      const t = e.target;
      if (!t?.matches?.("input,textarea")) return;
      // checkbox/radio are captured by the "change" listener; files cannot be replayed
      if (t.matches('input[type="checkbox"],input[type="radio"],input[type="file"]'))
        return;
      window.__bugassayPush({
        type: "input",
        selector: pick(t),
        selectors: cands(t),
        value: t.value,
      });
    },
    true,
  );
  document.addEventListener(
    "change",
    (e) => {
      const t = e.target;
      if (!t) return;
      if (t.matches("select"))
        window.__bugassayPush({
          type: "select",
          selector: pick(t),
          selectors: cands(t),
          value: t.value,
        });
      else if (t.matches('input[type="checkbox"],input[type="radio"]'))
        window.__bugassayPush({
          type: "check",
          selector: pick(t),
          selectors: cands(t),
          checked: t.checked,
        });
    },
    true,
  );
}
