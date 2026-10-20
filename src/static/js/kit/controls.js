/* Controls: press feedback, liquid tabs/segmented, sliders/faders, toggle, stepper, menu. */
(function (root) {
  const LW = root.LW;
  const ui = (LW.ui = LW.ui || {});

  /* Press: glass/solid controls grow (or sink) on pointer-down and spring back with a little bounce. */
  ui.press = (scope) => {
    LW.$$("[data-press]", scope).forEach((el) => {
      if (el._press) return;
      const up = { grow: 1.08, sub: 1.03, sink: 0.94 }[el.dataset.press] || 0.96;
      const s = (el._press = LW.spring(1, { response: 0.3, damping: 0.9, eps: 0.0004 }, (v) => { el.style.scale = v; }));
      el.addEventListener("pointerdown", () => s.to(up, { response: 0.2, damping: 1 }));
      const rel = () => s.to(1, { response: 0.45, damping: 0.55 });
      ["pointerup", "pointerleave", "pointercancel"].forEach((t) => el.addEventListener(t, rel));
    });
  };

  /* Liquid tab bar / segmented control. Children: .tab[data-k]. Droplet springs, stretches with
     velocity, and can be dragged across tabs (turns to glass while dragged). */
  ui.tabs = (bar, onChange, opts) => {
    const o = opts || {};
    const tabs = LW.$$(".tab", bar);
    const drop = LW.h("div", { class: "drop" });
    bar.appendChild(drop);
    let idx = Math.max(0, tabs.findIndex((t) => t.classList.contains("on")));
    let x = 0, w = 0, vx = 0, dragging = false;
    const render = () => {
      const st = LW.clamp(Math.abs(vx) / 2600, 0, 0.3);
      drop.style.width = w + "px";
      drop.style.transform = `translateX(${x}px) scale(${1 + st + (dragging ? 0.08 : 0)},${1 - st * 0.45 + (dragging ? 0.06 : 0)})`;
    };
    const sx = LW.spring(0, { response: 0.42, damping: 0.8, eps: 0.2 }, (v, vel) => { x = v; vx = vel; render(); });
    const sw = LW.spring(0, { response: 0.42, damping: 0.95, eps: 0.2 }, (v) => { w = v; render(); });
    const geo = (i) => ({ x: tabs[i].offsetLeft, w: tabs[i].offsetWidth });
    const place = (snap) => { const g = geo(idx); if (snap) { sx.set(g.x); sw.set(g.w); } else { sx.to(g.x); sw.to(g.w); } };
    const api = {
      select(i, fire, velocity) {
        if (i < 0 || i >= tabs.length) return;
        idx = i;
        tabs.forEach((t, j) => { t.classList.toggle("on", j === i); t.setAttribute("aria-selected", j === i ? "true" : "false"); });
        const g = geo(i);
        sx.to(g.x, velocity != null ? { velocity } : {});
        sw.to(g.w);
        if (fire !== false && onChange) onChange(i, tabs[i].dataset.k);
      },
      get index() { return idx; },
      relayout() { place(true); },
    };
    bar.setAttribute("role", "tablist");
    tabs.forEach((t) => t.setAttribute("role", "tab"));
    root.requestAnimationFrame(() => place(true));
    if (root.ResizeObserver) new root.ResizeObserver(() => place(true)).observe(bar);

    let startX = 0, grab = 0, moved = false, hist = [], down = -1;
    bar.addEventListener("pointerdown", (e) => {
      const t = e.target.closest(".tab");
      if (!t || !bar.contains(t)) return;
      down = tabs.indexOf(t);
      if (o.draggable === false) return;
      bar.setPointerCapture(e.pointerId);
      startX = e.clientX; moved = false; hist = [[e.clientX, performance.now()]];
      grab = e.clientX - bar.getBoundingClientRect().left - x;
    });
    bar.addEventListener("pointermove", (e) => {
      if (!bar.hasPointerCapture || !bar.hasPointerCapture(e.pointerId)) return;
      hist.push([e.clientX, performance.now()]); if (hist.length > 5) hist.shift();
      if (!moved && (Math.abs(e.clientX - startX) < 8 || down !== idx)) return;
      moved = true; dragging = true; drop.classList.add("live");
      const r = bar.getBoundingClientRect();
      const scale = r.width / (bar.offsetWidth || r.width || 1);
      const max = bar.scrollWidth - w;
      let nx = (e.clientX - r.left) / scale - grab / scale;
      if (nx < 0) nx = LW.rubber(nx, 80);
      if (nx > max) nx = max + LW.rubber(nx - max, 80);
      sx.to(nx, { response: 0.12, damping: 1 });
    });
    const finish = (e) => {
      if (o.draggable === false) { if (down >= 0) api.select(down); down = -1; return; }
      if (!bar.hasPointerCapture || !bar.hasPointerCapture(e.pointerId)) return;
      bar.releasePointerCapture(e.pointerId);
      dragging = false; drop.classList.remove("live");
      if (!moved) { if (down >= 0) api.select(down); down = -1; return; }
      const a = hist[0], b = hist[hist.length - 1];
      const v = ((b[0] - a[0]) / Math.max(1, b[1] - a[1])) * 1000;
      const proj = x + w / 2 + LW.project(v, 0.99);
      let best = 0, bd = Infinity;
      tabs.forEach((t, i) => { const d = Math.abs(t.offsetLeft + t.offsetWidth / 2 - proj); if (d < bd) { bd = d; best = i; } });
      sx.cfg(0.42, 0.8);
      api.select(best, true, v);
      down = -1;
    };
    bar.addEventListener("pointerup", finish);
    bar.addEventListener("pointercancel", (e) => { dragging = false; drop.classList.remove("live"); if (bar.hasPointerCapture && bar.hasPointerCapture(e.pointerId)) bar.releasePointerCapture(e.pointerId); place(false); });
    bar.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") { api.select(Math.min(tabs.length - 1, idx + 1)); e.preventDefault(); }
      if (e.key === "ArrowLeft") { api.select(Math.max(0, idx - 1)); e.preventDefault(); }
    });
    return api;
  };

  /* Slider / fader. White thumb at rest, glass while dragged (.live). */
  ui.slider = (el, opts) => {
    const o = Object.assign({ min: 0, max: 1, value: 0, step: 0, vertical: false }, opts || {});
    el.classList.add("sl");
    if (o.vertical) el.classList.add("v");
    el.textContent = "";
    const tr = LW.h("div", { class: "sl-tr" }), fl = LW.h("div", { class: "sl-fl" }), th = LW.h("div", { class: "sl-th" });
    el.append(tr, fl, th);
    el.setAttribute("role", "slider");
    el.tabIndex = 0;
    if (o.label) el.setAttribute("aria-label", o.label);
    el.setAttribute("aria-valuemin", o.min); el.setAttribute("aria-valuemax", o.max);
    let val = o.value, dragging = false;
    const frac = () => (o.max === o.min ? 0 : (val - o.min) / (o.max - o.min));
    const paint = () => {
      const p = LW.clamp(frac(), 0, 1) * 100;
      if (o.vertical) { fl.style.height = p + "%"; th.style.bottom = p + "%"; }
      else { fl.style.width = p + "%"; th.style.left = p + "%"; }
      el.setAttribute("aria-valuenow", String(Math.round(val * 1000) / 1000));
      if (o.format) el.setAttribute("aria-valuetext", o.format(val));
    };
    const quant = (v) => (o.step ? Math.round(v / o.step) * o.step : v);
    const sc = LW.spring(1, { response: 0.3, damping: 0.7, eps: 0.0005 }, (s) => { th.style.scale = s; });
    const fromEvent = (e) => {
      const r = el.getBoundingClientRect();
      const f = o.vertical ? 1 - (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
      return LW.clamp(quant(o.min + LW.clamp(f, 0, 1) * (o.max - o.min)), o.min, o.max);
    };
    el.addEventListener("pointerdown", (e) => {
      el.setPointerCapture(e.pointerId);
      dragging = true; el.classList.add("live");
      sc.to(1.3, { response: 0.22, damping: 0.8 });
      val = fromEvent(e); paint(); if (o.onInput) o.onInput(val);
    });
    el.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      val = fromEvent(e); paint(); if (o.onInput) o.onInput(val);
    });
    const end = () => {
      if (!dragging) return;
      dragging = false; el.classList.remove("live");
      sc.to(1, { response: 0.45, damping: 0.55 });
      if (o.onChange) o.onChange(val);
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
    el.addEventListener("keydown", (e) => {
      const stepK = o.step || (o.max - o.min) / 50;
      let d = 0;
      if (e.key === "ArrowUp" || e.key === "ArrowRight") d = stepK;
      if (e.key === "ArrowDown" || e.key === "ArrowLeft") d = -stepK;
      if (!d) return;
      e.preventDefault(); e.stopPropagation();
      val = LW.clamp(quant(val + d), o.min, o.max); paint();
      if (o.onInput) o.onInput(val);
      if (o.onChange) o.onChange(val);
    });
    paint();
    return {
      el,
      set(v) { if (dragging) return; val = LW.clamp(Number(v) || 0, o.min, o.max); paint(); },
      get() { return val; },
      get dragging() { return dragging; },
    };
  };

  /* Toggle switch (button.sw). The knob stretches while pressed. */
  ui.toggle = (el, on, onChange) => {
    el.classList.add("sw");
    el.textContent = "";
    const k = LW.h("i");
    el.appendChild(k);
    el.setAttribute("role", "switch");
    if (el.tagName !== "BUTTON") el.tabIndex = 0;
    let state = !!on;
    const travel = () => (el.offsetWidth || 46) - (el.offsetHeight || 28);
    const sx = LW.spring(0, { response: 0.4, damping: 0.7, eps: 0.05 }, (v) => { k.style.transform = `translateX(${v}px)`; });
    const sw = LW.spring(0, { response: 0.25, damping: 1, eps: 0.05 }, (v) => { k.style.width = `calc(${(el.offsetHeight || 28) - 4}px + ${v}px)`; });
    const sync = (snap) => {
      el.classList.toggle("on", state);
      el.setAttribute("aria-checked", state ? "true" : "false");
      if (snap) sx.set(state ? travel() : 0); else sx.to(state ? travel() : 0);
    };
    el.addEventListener("pointerdown", () => { sw.to(6); if (state) sx.to(travel() - 6); });
    el.addEventListener("pointerleave", () => { sw.to(0); sx.to(state ? travel() : 0); });
    el.addEventListener("click", () => { state = !state; sw.to(0); sync(false); if (onChange) onChange(state); });
    root.requestAnimationFrame(() => sync(true));
    return { set(v) { if (!!v === state) return; state = !!v; sync(false); }, get on() { return state; } };
  };

  /* Stepper: [−] value [+] with rolling value text. */
  ui.stepper = (el, opts) => {
    const o = Object.assign({ min: -Infinity, max: Infinity, value: 0, step: 1, format: (v) => String(v) }, opts || {});
    el.classList.add("step");
    el.textContent = "";
    const minus = LW.h("button", { type: "button", "aria-label": o.label ? `Decrease ${o.label}` : "Decrease", "data-press": "sink", text: "−" });
    const val = LW.h("div", { class: "roll sv", "aria-live": "polite" });
    const plus = LW.h("button", { type: "button", "aria-label": o.label ? `Increase ${o.label}` : "Increase", "data-press": "sink", text: "+" });
    el.append(minus, val, plus);
    let v = o.value;
    const show = () => LW.swap(val, o.format(v));
    const change = (nv) => { nv = LW.clamp(nv, o.min, o.max); if (nv === v) return; v = nv; show(); if (o.onChange) o.onChange(v); };
    minus.addEventListener("click", () => change(v - o.step));
    plus.addEventListener("click", () => change(v + o.step));
    ui.press(el);
    show();
    return { set(nv) { nv = LW.clamp(Number(nv) || 0, o.min, o.max); if (nv !== v) { v = nv; show(); } }, get() { return v; } };
  };

  /* Menu anchored to a button. items: [{icon,label,onClick,feature,danger}] or "sep". */
  let openMenu = null;
  ui.menu = (button, items) => {
    const m = LW.h("div", { class: "menu", role: "menu" });
    document.body.appendChild(m);
    const build = () => {
      m.textContent = "";
      (typeof items === "function" ? items() : items).forEach((it) => {
        if (it === "sep") { m.appendChild(LW.h("hr")); return; }
        const b = LW.h("button", { type: "button", role: "menuitem", class: it.danger ? "danger" : null, "data-feature": it.feature || null });
        if (it.icon) b.insertAdjacentHTML("beforeend", LW.icon(it.icon));
        b.appendChild(LW.h("span", { text: it.label }));
        b.addEventListener("click", () => { api.close(); it.onClick && it.onClick(); });
        m.appendChild(b);
      });
    };
    const api = {
      el: m,
      open() {
        if (openMenu && openMenu !== api) openMenu.close();
        build();
        const r = button.getBoundingClientRect();
        m.style.top = Math.round(r.bottom + 8) + "px";
        const left = Math.min(root.innerWidth - 240, Math.max(8, r.right - 230));
        m.style.left = Math.round(left) + "px";
        m.classList.add("open");
        openMenu = api;
      },
      close() { m.classList.remove("open"); if (openMenu === api) openMenu = null; },
      toggle() { m.classList.contains("open") ? api.close() : api.open(); },
    };
    button.addEventListener("click", (e) => { e.stopPropagation(); api.toggle(); });
    button.setAttribute("aria-haspopup", "menu");
    return api;
  };
  if (typeof document !== "undefined" && document.addEventListener) {
    document.addEventListener("click", (e) => { if (openMenu && !openMenu.el.contains(e.target)) openMenu.close(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && openMenu) { openMenu.close(); e.stopPropagation(); } }, true);
  }
})(typeof window !== "undefined" ? window : globalThis);
