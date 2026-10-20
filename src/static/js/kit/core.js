/* Litwave kit core: namespace, formatting, events, API wrapper, theme, DOM helpers. */
(function (root) {
  const LW = (root.LW = root.LW || {});

  const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  LW.esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ESC_MAP[c]);

  LW.clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  LW.fmt = (sec) => {
    const n = Number(sec);
    if (!Number.isFinite(n) || n <= 0) return "0:00";
    return Math.floor(n / 60) + ":" + String(Math.floor(n % 60)).padStart(2, "0");
  };
  LW.fmtMs = (sec) => {
    const n = Math.max(0, Number(sec) || 0);
    return LW.fmt(n) + "." + String(Math.floor((n % 1) * 10));
  };
  LW.db = (lin) => {
    const n = Number(lin);
    return n > 0 ? (20 * Math.log10(n)).toFixed(1) + " dB" : "-inf dB";
  };

  /* events */
  const subs = {};
  LW.on = (evt, fn) => { (subs[evt] || (subs[evt] = [])).push(fn); return () => { subs[evt] = subs[evt].filter((f) => f !== fn); }; };
  LW.emit = (evt, ...args) => {
    (subs[evt] || []).slice().forEach((fn) => {
      try { fn(...args); } catch (e) { console.error("[LW] handler for", evt, "failed:", e); }
    });
  };

  /* DOM helpers */
  LW.$ = (sel, r) => (r || document).querySelector(sel);
  LW.$$ = (sel, r) => Array.from((r || document).querySelectorAll(sel));
  LW.byId = (id) => document.getElementById(id);
  // h('div', {class:'x', text:'..', on:{click:fn}, data:{k:v}, attrs:{..}}, children...)
  LW.h = (tag, props, ...children) => {
    const el = document.createElement(tag);
    const p = props || {};
    for (const k in p) {
      const v = p[k];
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k === "html") el.innerHTML = v; // trusted, static markup only (icons)
      else if (k === "on") for (const ev in v) el.addEventListener(ev, v[ev]);
      else if (k === "data") for (const dk in v) el.dataset[dk] = v[dk];
      else if (k === "style") for (const sk in v) { if (sk.startsWith("--")) el.style.setProperty(sk, v[sk]); else el.style[sk] = v[sk]; }
      else el.setAttribute(k, v === true ? "" : v);
    }
    children.flat().forEach((c) => { if (c == null || c === false) return; el.append(typeof c === "string" ? c : c); });
    return el;
  };
  // Rolling text swap: old value slides out, new one slides in. Text only.
  LW.swap = (el, text) => {
    if (!el) return;
    const t = String(text == null ? "" : text);
    const old = el.querySelector(":scope > .cur");
    if (old) { if (old.textContent === t) return; old.className = "out"; setTimeout(() => old.remove(), 420); }
    const s = document.createElement("span");
    s.className = "cur"; s.textContent = t;
    el.appendChild(s);
    // .fit rolls size themselves to the new text so neighbours (e.g. Nashville numbers) sit right beside it
    if (el.classList && el.classList.contains("fit") && typeof root.requestAnimationFrame === "function") {
      root.requestAnimationFrame(() => { el.style.width = Math.ceil(s.offsetWidth) + 2 + "px"; });
    }
  };
  LW.setText = (el, text) => { if (el && el.textContent !== String(text)) el.textContent = String(text); };

  /* local action marks: lets telemetry tell our own changes from another client's */
  const marks = {};
  LW.local = {
    mark(key) { marks[key] = (root.performance ? root.performance.now() : Date.now()); },
    recent(key, ms) { const t = marks[key]; return t != null && ((root.performance ? root.performance.now() : Date.now()) - t) < (ms || 1500); },
  };

  /* API: same endpoints and payloads as the classic UI; failures surface in the island */
  LW.api = {
    async request(path, opts) {
      try {
        return await root.BrowserApi.requestJson(path, opts || {});
      } catch (e) {
        LW.emit("alert", { tone: "bad", icon: "alert", title: "Request failed", sub: (e && e.message) || path }, 2600);
        throw e;
      }
    },
    get(path) { return LW.api.request(path, { method: "GET" }); },
    post(path, body) { return LW.api.request(path, { method: "POST", body: body == null ? {} : body }); },
    upload(path, formData) { return LW.api.request(path, { method: "POST", body: formData }); },
  };
  LW.alert = (opts, ms) => LW.emit("alert", opts, ms);

  /* theme: follows the OS until the user picks one */
  const mq = root.matchMedia ? root.matchMedia("(prefers-color-scheme: light)") : null;
  let pref = "system";
  try { pref = root.localStorage.getItem("lw-theme") || "system"; } catch (_) {}
  const apply = () => {
    const mode = pref === "system" ? (mq && mq.matches ? "light" : "dark") : pref;
    document.documentElement.setAttribute("data-theme", mode);
    LW.emit("theme", mode);
  };
  LW.theme = {
    set(p) { pref = p; try { root.localStorage.setItem("lw-theme", p); } catch (_) {} apply(); },
    pref() { return pref; },
    current() { return document.documentElement.getAttribute("data-theme") || "dark"; },
    toggle() { LW.theme.set(LW.theme.current() === "dark" ? "light" : "dark"); },
  };
  if (mq && mq.addEventListener) mq.addEventListener("change", () => { if (pref === "system") apply(); });
  apply();

  /* canvas colours come from tokens, never var(--x) strings */
  LW.token = (name, fallback) => {
    try {
      const v = root.getComputedStyle(document.documentElement).getPropertyValue(name);
      return (v && v.trim()) || fallback;
    } catch (_) { return fallback; }
  };

  LW.isTyping = (e) => {
    const t = e && e.target;
    if (!t || !t.tagName) return false;
    return t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
  };
})(typeof window !== "undefined" ? window : globalThis);
