/* Phone · Pads tab: banks A–F, level, stop all, 8 large touch pads with live playing state. */
(function (root) {
  const LW = root.LW;
  const R = LW.R;
  const $ = (id) => document.getElementById(id);
  const S = R.state;
  const COLORS = ["#FF453A", "#FF9F0A", "#FFD60A", "#30D158", "#64D2FF", "#0A84FF", "#5E5CE6", "#FF375F"];
  const NAMES = { A: "Perc", B: "Hits", C: "Trans", D: "Special", E: "Wide", F: "Live" };
  let banks = null, level = null, gridKey = "";

  const forBank = (b) => Object.values(S.fxPads.pads || {}).filter((p) => p.bank === b).sort((a, c) => a.pad_index - c.pad_index);

  function trigger(id, type, el) {
    if (type === "press" && el) { el.classList.remove("hit"); void el.offsetWidth; el.classList.add("hit"); }
    LW.api.post("/api/fx-pads", { action: "trigger", pad_id: id, velocity: 127, press_type: type }).catch(() => {});
  }

  function render(force) {
    const grid = $("fxGrid");
    const b = S.fxPads.active_bank || "A";
    const list = forBank(b);
    const key = b + JSON.stringify(list.map((p) => [p.id, p.name, p.trigger_mode]));
    if (!force && key === gridKey) return;
    gridKey = key;
    grid.textContent = "";
    LW.setText($("bankName"), `Bank ${b} · ${NAMES[b]}`);
    if (!list.length) { grid.append(LW.h("div", { class: "empty", text: "Pads are loading…" })); return; }
    list.forEach((p) => {
      const el = LW.h("button", { class: "pad", type: "button", data: { pad: p.id }, style: { "--pc": COLORS[p.pad_index % COLORS.length] }, "aria-label": `Pad ${p.bank}${p.pad_index + 1}: ${p.name}` },
        LW.h("span", { class: "pt" }, LW.h("i", { class: "sw-dot" }), `${p.bank}${p.pad_index + 1}`),
        LW.h("span", { class: "pn", text: p.name || "Empty" }),
        LW.h("span", { class: "pb", text: p.trigger_mode && p.trigger_mode !== "oneshot" ? (p.trigger_mode === "gate" ? "Hold" : "Toggle") : "One shot" }));
      el.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        const r = el.getBoundingClientRect();
        el.style.setProperty("--px", e.clientX - r.left + "px");
        el.style.setProperty("--py", e.clientY - r.top + "px");
        el._down = true;
        trigger(p.id, "press", el);
        if (R.isl) R.isl.alert({ icon: "grid", title: p.name || "Pad", sub: `Pad ${p.bank}${p.pad_index + 1}`, right: `${p.bank}${p.pad_index + 1}` }, 900);
      });
      const release = () => { if (el._down) { el._down = false; trigger(p.id, "release"); } };
      el.addEventListener("pointerup", release);
      el.addEventListener("pointercancel", release);
      el.addEventListener("pointerleave", release);
      el.addEventListener("contextmenu", (e) => e.preventDefault());
      grid.append(el);
    });
    paint();
  }

  function paint() {
    const ind = S.fxPads.pad_indicators || {};
    LW.$$(".pad", $("fxGrid")).forEach((el) => el.classList.toggle("playing", Boolean(ind[el.dataset.pad])));
  }

  R.pads = {
    selectBank(b) {
      S.fxPads.active_bank = b;
      if (banks) banks.select("ABCDEF".indexOf(b), false);
      render(true);
      LW.api.post("/api/fx-pads", { action: "bank", bank: b }).catch(() => {});
    },
  };

  LW.on("r-ready", () => {
    banks = LW.ui.tabs($("fxBanks"), (i, k) => R.pads.selectBank(k));
    level = LW.ui.slider($("fxLevel"), {
      min: 0, max: 1.5, value: S.fxPads.bus_volume, label: "FX pads level", format: LW.db,
      onInput: (v) => { S.dragging.fx = true; LW.setText($("fxLevelV"), LW.db(v)); R.mix && R.mix.sendFx(v); },
      onChange: () => setTimeout(() => { S.dragging.fx = false; }, 300),
    });
    $("fxLevel").classList.add("thin");
    R.faders = R.faders || {};
    R.faders.fxTop = level;
    $("fxStop").addEventListener("click", () => { LW.api.post("/api/fx-pads", { action: "stop_all" }).catch(() => {}); LW.alert({ icon: "stop", title: "Pads stopped" }, 900); });
    LW.api.get("/api/fx-pads").then((d) => { if (d && d.pads) { Object.assign(S.fxPads, d); render(true); } }).catch(() => {});
  });

  LW.on("r-telemetry", (msg) => {
    const fx = msg.fx_pads;
    if (!fx) return;
    const hadNone = !Object.keys(S.fxPads.pads || {}).length;
    if (fx.pads && Object.keys(fx.pads).length) S.fxPads.pads = fx.pads;
    if (fx.bus_volume !== undefined) S.fxPads.bus_volume = fx.bus_volume;
    if (fx.pad_indicators) S.fxPads.pad_indicators = fx.pad_indicators;
    if (fx.active_bank !== undefined && fx.active_bank !== S.fxPads.active_bank) {
      S.fxPads.active_bank = fx.active_bank;
      if (banks) banks.select("ABCDEF".indexOf(fx.active_bank), false);
      render(true);
    } else if (hadNone) render(true);
    paint();
  });
  LW.on("r-fx-pulse", (msg) => {
    if (msg.action !== "press") return;
    const el = $("fxGrid").querySelector(`[data-pad="${CSS.escape(msg.pad_id)}"]`);
    if (el) { el.classList.remove("hit"); void el.offsetWidth; el.classList.add("hit"); }
  });
})(window);
