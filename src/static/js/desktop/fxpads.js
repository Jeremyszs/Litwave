/* FX Pads sampler: banks A–F, 8 pads per bank with live playing state, bus level, stop all,
   pad editor (sound, trigger mode, label, choke group, pitch, custom sample upload). */
(function (root) {
  const LW = root.LW;
  const $ = (id) => document.getElementById(id);
  const S = () => LW.state;
  // One solid colour per pad position (hardware-style colour coding, no gradients).
  const COLORS = ["#FF453A", "#FF9F0A", "#FFD60A", "#30D158", "#64D2FF", "#0A84FF", "#5E5CE6", "#FF375F"];
  const BANK_NAMES = { A: "Perc", B: "Hits", C: "Trans", D: "Special", E: "Wide", F: "Live" };
  const CATS = { percussion: "Acoustic & electronic percussion", hits: "Impacts, hits & 808 drops", transitions: "Whooshes, risers & sweeps", special: "Atmospheres, swells & vocal chops" };
  let sheet = null, bankTabs = null, bus = null, editing = null, renderedKey = "";
  const containers = new Set(); // grids currently showing pads (sheet + Stage)

  const padsForBank = (bank) => Object.values(S().fxPads.pads || {}).filter((p) => p.bank === bank).sort((a, b) => a.pad_index - b.pad_index);

  function padEl(p) {
    const playing = Boolean(S().fxPads.pad_indicators && S().fxPads.pad_indicators[p.id]);
    const el = LW.h("button", { class: "pad" + (playing ? " playing" : ""), type: "button", data: { pad: p.id }, style: { "--pc": COLORS[p.pad_index % COLORS.length] }, "aria-label": `Pad ${p.bank}${p.pad_index + 1}: ${p.name}` },
      LW.h("span", { class: "pt" }, LW.h("i", { class: "sw-dot" }), `${p.bank}${p.pad_index + 1}`,
        p.trigger_mode && p.trigger_mode !== "oneshot" ? LW.h("span", { text: p.trigger_mode === "gate" ? "· Gate" : "· Toggle" }) : null,
        p.choke_group > 0 ? LW.h("span", { text: `· Choke ${p.choke_group}` }) : null),
      LW.h("span", { class: "pn", text: p.name || "Empty" }),
      LW.h("span", { class: "pb" }, LW.h("span", { text: "Vol" }), LW.h("span", { text: `${p.volume == null ? 100 : p.volume}%` })));
    const edit = LW.h("span", { class: "edit", role: "button", tabindex: "0", "aria-label": `Edit pad ${p.bank}${p.pad_index + 1}`, html: LW.icon("edit") });
    edit.addEventListener("pointerdown", (e) => e.stopPropagation());
    edit.addEventListener("click", (e) => { e.stopPropagation(); openEditor(p.id); });
    el.append(edit);
    el.addEventListener("pointerdown", (e) => {
      if (e.button > 0) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      el.style.setProperty("--px", e.clientX - r.left + "px");
      el.style.setProperty("--py", e.clientY - r.top + "px");
      LW.fx.trigger(p.id, "press");
    });
    const release = () => { if (el._down) { el._down = false; LW.fx.trigger(p.id, "release"); } };
    el.addEventListener("pointerdown", () => { el._down = true; });
    el.addEventListener("pointerup", release);
    el.addEventListener("pointerleave", release);
    el.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); LW.fx.trigger(p.id, "press"); } });
    el.addEventListener("keyup", (e) => { if (e.key === "Enter" || e.key === " ") LW.fx.trigger(p.id, "release"); });
    return el;
  }

  function renderGrid(grid, force) {
    const bank = S().fxPads.active_bank || "A";
    const list = padsForBank(bank);
    const key = bank + JSON.stringify(list.map((p) => [p.id, p.name, p.trigger_mode, p.choke_group, p.volume]));
    if (!force && grid._key === key) return;
    grid._key = key;
    grid.textContent = "";
    if (!list.length) { grid.append(LW.h("div", { class: "empty", text: "Pads are loading from the sampler…" })); return; }
    list.forEach((p) => grid.append(padEl(p)));
  }
  function renderAll(force) { containers.forEach((g) => { if (g.isConnected) renderGrid(g, force); else containers.delete(g); }); }

  function paintIndicators() {
    const ind = S().fxPads.pad_indicators || {};
    containers.forEach((g) => LW.$$(".pad", g).forEach((el) => el.classList.toggle("playing", Boolean(ind[el.dataset.pad]))));
    const playing = Object.values(ind).filter(Boolean).length;
    LW.setText($("sbFxSub"), `Bank ${S().fxPads.active_bank || "A"} · ${BANK_NAMES[S().fxPads.active_bank || "A"]}${playing ? ` · ${playing} playing` : ""}`);
  }

  function hit(id) {
    containers.forEach((g) => {
      const el = g.querySelector(`[data-pad="${CSS.escape(id)}"]`);
      if (el) { el.classList.remove("hit"); void el.offsetWidth; el.classList.add("hit"); }
    });
  }

  function openEditor(id) {
    const p = S().fxPads.pads[id];
    if (!p) return;
    editing = id;
    if (!sheet.isOpen) LW.openSheet("fxpads");
    $("fxEditor").hidden = false;
    LW.setText($("fxEdTitle"), `Pad ${p.bank}${p.pad_index + 1}`);
    $("fxEdName").value = p.name || "";
    $("fxEdMode").value = p.trigger_mode || "oneshot";
    $("fxEdChoke").value = String(p.choke_group || 0);
    $("fxEdPitch").value = p.pitch || 0;
    const sel = $("fxEdSound");
    sel.textContent = "";
    const cat = S().fxPads.sound_catalog || {};
    for (const c in CATS) {
      const g = LW.h("optgroup", { label: CATS[c] });
      for (const sid in cat) {
        const sc = cat[sid];
        if (sc.category !== c) continue;
        const o = LW.h("option", { value: sid, text: sc.name });
        if (p.sound_id === sid || p.sample_path === sc.sample_path) o.selected = true;
        g.append(o);
      }
      if (g.children.length) sel.append(g);
    }
    LW.setText($("fxEdSample"), p.sample_path ? String(p.sample_path).split(/[\\/]/).pop() : "None");
    setTimeout(() => $("fxEditor").scrollIntoView({ behavior: "smooth", block: "nearest" }), 60);
  }

  function saveField(field, val) {
    if (!editing || !S().fxPads.pads[editing]) return;
    S().fxPads.pads[editing][field] = val;
    renderAll();
    LW.api.post("/api/fx-pads", { action: "update_pad", pad_id: editing, [field]: val }).catch(() => {});
  }

  LW.fx = {
    COLORS, padsForBank, BANK_NAMES,
    trigger(id, type) {
      const pressType = type || "press";
      if (pressType === "press") hit(id);
      LW.api.post("/api/fx-pads", { action: "trigger", pad_id: id, velocity: 127, press_type: pressType }).catch(() => {});
    },
    stopAll() {
      LW.api.post("/api/fx-pads", { action: "stop_all" }).catch(() => {});
      LW.alert({ icon: "stop", title: "Pads stopped", sub: "All sampler voices silenced" }, 1100);
    },
    selectBank(b) {
      S().fxPads.active_bank = b;
      if (bankTabs) bankTabs.select("ABCDEF".indexOf(b), false);
      renderAll(true);
      paintIndicators();
      LW.emit("fx-bank", b);
      LW.api.post("/api/fx-pads", { action: "bank", bank: b }).catch(() => {});
    },
    setBus(v) { if (LW.mixer) LW.mixer.set("fx", v); },
    mount(grid) { containers.add(grid); renderGrid(grid, true); },
  };

  LW.on("ready", () => {
    sheet = LW.sheet($("sheetFx"), { onClose: () => { $("fxEditor").hidden = true; editing = null; } });
    LW.registerSheet("fxpads", sheet, () => { LW.fx.mount($("fxGrid")); paintIndicators(); });
    bankTabs = LW.ui.tabs($("fxBanks"), (i, k) => LW.fx.selectBank(k));
    $("fxStopAll").addEventListener("click", () => LW.fx.stopAll());
    bus = LW.ui.slider($("fxBus"), {
      min: 0, max: 1.5, value: S().fxPads.bus_volume, label: "FX pads level",
      format: (v) => LW.db(v),
      onInput: (v) => { S().dragging.fx = true; LW.setText($("fxBusV"), LW.db(v)); if (LW.faders.fx) LW.faders.fx.set(v); LW.api.post("/api/fx-pads", { action: "bus", volume: v }).catch(() => {}); },
      onChange: () => setTimeout(() => { S().dragging.fx = false; }, 250),
    });
    $("fxBus").classList.add("thin");
    LW.on("fader", (ch, v) => { if (ch === "fx" && bus && !bus.dragging) { bus.set(v); LW.setText($("fxBusV"), LW.db(v)); } });
    $("fxEdDone").addEventListener("click", () => { $("fxEditor").hidden = true; editing = null; });
    $("fxEdSound").addEventListener("change", (e) => {
      const sid = e.target.value, meta = (S().fxPads.sound_catalog || {})[sid];
      if (!editing || !meta) return;
      const p = S().fxPads.pads[editing];
      Object.assign(p, { sound_id: sid, name: meta.name, sample_path: meta.sample_path, category: meta.category });
      $("fxEdName").value = meta.name;
      LW.setText($("fxEdSample"), String(meta.sample_path).split(/[\\/]/).pop());
      renderAll();
      LW.api.post("/api/fx-pads", { action: "update_pad", pad_id: editing, sound_id: sid }).catch(() => {});
    });
    $("fxEdMode").addEventListener("change", (e) => saveField("trigger_mode", e.target.value));
    $("fxEdName").addEventListener("change", (e) => saveField("name", e.target.value));
    $("fxEdChoke").addEventListener("change", (e) => saveField("choke_group", parseInt(e.target.value, 10)));
    $("fxEdPitch").addEventListener("change", (e) => saveField("pitch", LW.clamp(parseInt(e.target.value, 10) || 0, -12, 12)));
    $("fxEdReplace").addEventListener("click", () => $("fxSampleInput").click());
    $("fxSampleInput").addEventListener("change", async (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!f || !editing) return;
      const fd = new FormData();
      fd.append("file", f);
      fd.append("pad_id", editing);
      LW.alert({ icon: "upload", title: "Uploading sample", sub: f.name }, 4000);
      try {
        const data = await LW.api.upload("/api/upload", fd);
        if (data && data.success && data.filename) {
          saveField("sample_path", `assets/fx-pads/custom/${data.filename}`);
          LW.setText($("fxEdSample"), data.filename);
          LW.alert({ icon: "check", tone: "ok", title: "Sample loaded", sub: `${data.filename} on ${editing}` }, 1800);
        }
      } catch (_) {}
    });
    LW.api.get("/api/fx-pads").then((d) => { if (d && d.pads) { Object.assign(S().fxPads, d); renderAll(true); paintIndicators(); } }).catch(() => {});
  });

  LW.on("telemetry", (d) => {
    const fx = d.fx_pads;
    if (!fx) return;
    const st = S().fxPads;
    const hadNone = !st.pads || !Object.keys(st.pads).length;
    if (fx.pads && Object.keys(fx.pads).length) st.pads = fx.pads;
    if (fx.sound_catalog) st.sound_catalog = fx.sound_catalog;
    ["bus_volume", "bus_muted", "active_voices"].forEach((k) => { if (fx[k] !== undefined) st[k] = fx[k]; });
    if (fx.active_bank !== undefined && fx.active_bank !== st.active_bank) {
      st.active_bank = fx.active_bank;
      if (bankTabs) bankTabs.select("ABCDEF".indexOf(fx.active_bank), false);
      renderAll(true);
      LW.emit("fx-bank", fx.active_bank);
    }
    if (fx.pad_indicators) st.pad_indicators = fx.pad_indicators;
    if (hadNone && st.pads && Object.keys(st.pads).length) renderAll(true);
    paintIndicators();
  });
  LW.on("fx_pulse", (msg) => { if (msg.action === "press") hit(msg.pad_id); });
})(window);
