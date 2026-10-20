/* Dynamic Island: compact live status, expanded now-playing card, transient alerts, secondary bubble.
   All text is set through textContent. */
(function (root) {
  const LW = root.LW;
  const h = (...a) => LW.h(...a);

  LW.island = {
    create(el, bubble, opts) {
      const o = opts || {};
      const sizes = Object.assign({ compact: { w: 252, h: 40 }, expanded: { w: 460, h: 158, r: 42 }, alert: { w: 360, h: 52 } }, o.sizes || {});
      const hover = o.hover !== false;
      const refs = {};
      const box = (k) => ({ width: sizes[k].w + "px", height: sizes[k].h + "px" });

      el.textContent = "";
      el.classList.add("island");
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");

      // compact
      refs.eq = h("div", { class: "isl-eq" }, h("i"), h("i"), h("i"), h("i"));
      refs.chord = h("div", { class: "c roll" });
      refs.pos = h("span", { class: "bb" });
      const ring = h("div", { html: '<svg class="mring" viewBox="0 0 20 20"><circle class="t" cx="10" cy="10" r="8"/><circle class="p" cx="10" cy="10" r="8" stroke-dasharray="50.3" stroke-dashoffset="50.3"/></svg>' });
      const compact = h("div", { class: "isl-layer isl-compact", data: { s: "compact" }, style: box("compact") }, refs.eq, refs.chord, h("span", { class: "sp" }), refs.pos, ring);

      // expanded
      refs.title = h("div", { class: "tt" });
      refs.sub = h("div", { class: "st" });
      refs.now = h("div", { class: "cc roll" });
      refs.t0 = h("span"); refs.t1 = h("span");
      refs.pbFill = h("i");
      refs.pb = h("div", { class: "pb" }, refs.pbFill);
      refs.next = h("b");
      const btn = (a, icon, label) => h("button", { type: "button", data: { a }, "aria-label": label, html: icon });
      refs.playBtn = h("button", { type: "button", data: { a: "play" }, "aria-label": "Play or pause", html: `<span class="pp">${LW.icon("play")}${LW.icon("pause")}</span>` });
      const expanded = h("div", { class: "isl-layer isl-exp", data: { s: "expanded" }, style: box("expanded") },
        h("div", { class: "r1" }, h("div", { class: "isl-art", html: LW.icon("note") }), h("div", { class: "meta" }, refs.title, refs.sub),
          h("div", { class: "now" }, h("div", { class: "k", text: "NOW" }), refs.now)),
        h("div", { class: "r2" }, refs.t0, refs.pb, refs.t1),
        h("div", { class: "r3" }, btn("prev", LW.icon("rew"), "Previous section"), refs.playBtn, btn("next", LW.icon("fwd"), "Next section"),
          h("span", { class: "nx" }, "Next ", refs.next)));

      // alert
      refs.aic = h("div", { class: "ic" });
      refs.a1 = h("div", { class: "a1" }); refs.a2 = h("div", { class: "a2" }); refs.ar = h("span", { class: "ar" });
      const alertL = h("div", { class: "isl-layer isl-alert", data: { s: "alert" }, style: box("alert") }, refs.aic, h("div", { class: "tx" }, refs.a1, refs.a2), refs.ar);

      el.append(compact, expanded, alertL);
      const layers = [compact, expanded, alertL];

      let W = sizes.compact.w, H = sizes.compact.h, R = H / 2, bx = -40;
      const placeBubble = () => { if (bubble) bubble.style.transform = `translateX(${W / 2 + 8 + bx}px)`; };
      const apply = () => { el.style.width = W + "px"; el.style.height = H + "px"; el.style.borderRadius = R + "px"; placeBubble(); };
      apply();
      const sw = LW.spring(W, { response: 0.5, damping: 0.74, eps: 0.1 }, (v) => { W = v; apply(); });
      const sh = LW.spring(H, { response: 0.5, damping: 0.74, eps: 0.1 }, (v) => { H = v; apply(); });
      const sr = LW.spring(R, { response: 0.5, damping: 0.9, eps: 0.1 }, (v) => { R = v; apply(); });

      let state = "compact", base = "compact", pinned = false, timer = null, playing = false, progress = 0;
      const go = (s) => {
        state = s; el.dataset.state = s;
        const z = sizes[s];
        sw.to(z.w); sh.to(z.h); sr.to(z.r != null ? z.r : z.h / 2);
        layers.forEach((l) => l.classList.toggle("on", l.dataset.s === s));
      };

      let bOn = false;
      const bs = LW.spring(0, { response: 0.5, damping: 0.62, eps: 0.001 }, (v) => { if (bubble) { bubble.style.scale = Math.max(0, v); placeBubble(); } });
      const bxs = LW.spring(-40, { response: 0.5, damping: 0.7, eps: 0.1 }, (v) => { bx = v; placeBubble(); });

      const api = {
        refs,
        get state() { return state; },
        go(s) { base = s; if (state !== "alert") go(s); },
        alert(a, ms) {
          const x = a || {};
          refs.aic.className = "ic " + (x.tone || "");
          refs.aic.innerHTML = LW.icon(x.icon || "info"); // static icon markup
          refs.a1.textContent = x.title == null ? "" : String(x.title);
          refs.a2.textContent = x.sub == null ? "" : String(x.sub);
          refs.ar.textContent = x.right == null ? "" : String(x.right);
          go("alert");
          clearTimeout(timer);
          timer = setTimeout(() => go(pinned ? "expanded" : base), ms || 2200);
        },
        update(d) {
          const u = d || {};
          if (u.title != null) refs.title.textContent = String(u.title);
          if (u.sub != null) refs.sub.textContent = String(u.sub);
          if (u.chord != null) { LW.swap(refs.chord, u.chord); LW.swap(refs.now, u.chord); }
          if (u.next != null) refs.next.textContent = String(u.next);
          if (u.pos != null) refs.pos.textContent = String(u.pos);
          if (u.t0 != null) refs.t0.textContent = String(u.t0);
          if (u.t1 != null) refs.t1.textContent = String(u.t1);
          if (u.progress != null) {
            progress = LW.clamp(Number(u.progress) || 0, 0, 1);
            refs.pbFill.style.width = progress * 100 + "%";
          }
          if (u.ring != null) {
            const p = el.querySelector && el.querySelector(".mring .p");
            if (p) p.setAttribute("stroke-dashoffset", (50.3 * (1 - LW.clamp(u.ring, 0, 1))).toFixed(1));
          }
          if (u.playing != null) { playing = !!u.playing; refs.playBtn.classList.toggle("on", playing); }
        },
        bubble(on) { if (!!on === bOn) return; bOn = !!on; bs.to(bOn ? 1 : 0); bxs.to(bOn ? 0 : -40); },
      };

      if (hover) {
        el.addEventListener("pointerenter", () => { if (state !== "alert") { base = "expanded"; go("expanded"); } });
        el.addEventListener("pointerleave", () => {
          if (pinned) return;
          base = "compact";
          setTimeout(() => { if (!pinned && base === "compact" && state === "expanded") go("compact"); }, 220);
        });
      }
      el.addEventListener("click", (e) => {
        const b = e.target.closest && e.target.closest("button[data-a]");
        if (b) { e.stopPropagation(); if (o.onAction) o.onAction(b.dataset.a); return; }
        if (e.target.closest && e.target.closest(".pb")) {
          const r = refs.pb.getBoundingClientRect();
          if (o.onSeek && r.width) o.onSeek(LW.clamp((e.clientX - r.left) / r.width, 0, 1));
          return;
        }
        if (state === "alert") { clearTimeout(timer); go(pinned ? "expanded" : base); return; }
        pinned = !pinned;
        base = pinned ? "expanded" : "compact";
        go(base);
      });
      if (bubble && o.onBubble) bubble.addEventListener("click", o.onBubble);

      // equaliser bars dance only while playing
      const eqs = Array.from(refs.eq.children);
      if (LW.onFrame) LW.onFrame((dt, t) => {
        for (let i = 0; i < eqs.length; i++) {
          const s = playing ? 0.25 + 0.75 * Math.abs(Math.sin(t / (140 + i * 37) + i)) : 0.2;
          eqs[i].style.transform = `scaleY(${s.toFixed(3)})`;
        }
      });

      go("compact");
      return api;
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
