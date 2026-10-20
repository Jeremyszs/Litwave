/* Sheets and dialogs: solid, elevated, materialise from their trigger, Esc / drag-down to dismiss. */
(function (root) {
  const LW = root.LW;
  const stack = [];
  let scrim = null;
  const ensureScrim = () => {
    if (scrim || typeof document === "undefined" || !document.body) return scrim;
    scrim = LW.h("div", { class: "scrim" });
    scrim.addEventListener("click", () => { const top = stack[stack.length - 1]; if (top && !top.modal) top.close(); });
    document.body.appendChild(scrim);
    return scrim;
  };
  const syncScrim = () => { const s = ensureScrim(); if (s) s.classList.toggle("on", stack.length > 0); };

  LW.sheet = (el, opts) => {
    const o = opts || {};
    let open = false, y = 0, p = 0;
    const render = () => {
      el.style.opacity = LW.clamp(p, 0, 1);
      el.style.transform = `translateY(${(1 - p) * 24 + y}px) scale(${0.92 + 0.08 * p})`;
    };
    const ps = LW.spring(0, { response: 0.42, damping: 0.86, eps: 0.001 }, (v) => { p = v; render(); });
    const ys = LW.spring(0, { response: 0.4, damping: 0.8, eps: 0.2 }, (v) => { y = v; render(); });
    const api = {
      el,
      modal: !!o.modal,
      get isOpen() { return open; },
      open(origin) {
        if (origin && origin.getBoundingClientRect) {
          const r = origin.getBoundingClientRect();
          const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          el.style.setProperty("--ox", `calc(50% + ${Math.round(cx - root.innerWidth / 2)}px)`);
          el.style.setProperty("--oy", `calc(50% + ${Math.round(cy - root.innerHeight / 2)}px)`);
        }
        if (open) return;
        open = true;
        stack.push(api);
        el.classList.remove("closing");
        el.classList.add("open");
        el.setAttribute("aria-hidden", "false");
        ys.set(0);
        ps.to(1, { response: 0.42, damping: 0.84 });
        syncScrim();
        if (o.onOpen) o.onOpen();
        const f = el.querySelector("[autofocus]");
        if (f) setTimeout(() => f.focus(), 60);
      },
      close(velocity) {
        if (!open) return;
        open = false;
        const i = stack.indexOf(api); if (i >= 0) stack.splice(i, 1);
        el.classList.remove("open");
        el.setAttribute("aria-hidden", "true");
        if (velocity) ys.to(y + 80, { velocity });
        ps.to(0, { response: 0.3, damping: 1 });
        el.classList.add("closing");
        setTimeout(() => { if (!open) el.classList.remove("closing"); }, 340);
        syncScrim();
        if (o.onClose) o.onClose();
      },
      toggle(origin) { open ? api.close() : api.open(origin); },
    };
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-hidden", "true");
    LW.$$("[data-close]", el).forEach((b) => b.addEventListener("click", () => api.close()));

    const g = el.querySelector(".grab");
    if (g) {
      let sy = 0, hist = [];
      g.addEventListener("pointerdown", (e) => { g.setPointerCapture(e.pointerId); sy = e.clientY; hist = [[e.clientY, performance.now()]]; });
      g.addEventListener("pointermove", (e) => {
        if (!g.hasPointerCapture(e.pointerId)) return;
        hist.push([e.clientY, performance.now()]); if (hist.length > 5) hist.shift();
        let d = e.clientY - sy;
        if (d < 0) d = LW.rubber(d, 200);
        ys.set(d);
      });
      g.addEventListener("pointerup", (e) => {
        if (!g.hasPointerCapture(e.pointerId)) return;
        const a = hist[0], b = hist[hist.length - 1];
        const v = ((b[0] - a[0]) / Math.max(1, b[1] - a[1])) * 1000;
        if (y + LW.project(v, 0.99) > 140) api.close(v);
        else ys.to(0, { velocity: v, response: 0.4, damping: 0.75 });
      });
    }
    return api;
  };
  LW.dialog = (el, opts) => LW.sheet(el, Object.assign({}, opts || {}, { modal: true }));

  LW.sheets = {
    top() { return stack[stack.length - 1] || null; },
    closeTop() { const t = stack[stack.length - 1]; if (t) { t.close(); return true; } return false; },
    anyOpen() { return stack.length > 0; },
  };
})(typeof window !== "undefined" ? window : globalThis);
