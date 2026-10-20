/* Parts mixer (sound-engine parts 1–8): volume, reverb, pan, cutoff, resonance, attack, release, chorus,
   mute/solo, rename, voice preset (Community engine). Telemetry keeps values in sync except while dragging. */
(function (root) {
  const LW = root.LW;
  const $ = (id) => document.getElementById(id);
  const PARAMS = [["pan", "Pan", 64], ["cutoff", "Cutoff", 64], ["resonance", "Reson", 64], ["attack", "Attack", 64], ["release", "Release", 64], ["chorus", "Chorus", 0]];
  const DEF_VOL = [100, 100, 90, 95, 105, 85, 100, 95];
  const state = DEF_VOL.map((v, i) => ({ part: i + 1, name: `Part ${i + 1}`, val: v, rev: 40, mute: false, solo: false, pan: 64, cutoff: 64, resonance: 64, attack: 64, release: 64, chorus: 0 }));
  const sliders = {}; // `${part}:${field}` -> slider api
  const dragging = new Set();
  let sheet = null, catalog = null, renderedEngine = null;

  const post = (body) => LW.api.post("/api/montage/volume", body);
  const engine = () => (LW.engine && LW.engine.active()) || "yamaha";

  function voiceSelect(p) {
    const sel = LW.h("select", { class: "sel", "aria-label": `Voice preset for part ${p.part}` });
    sel.append(LW.h("option", { value: "", text: "Voice preset…" }));
    if (catalog) {
      const cats = {};
      catalog.forEach((v) => { (cats[v.category] = cats[v.category] || []).push(v); });
      for (const c in cats) {
        const g = LW.h("optgroup", { label: c });
        cats[c].forEach((v) => g.append(LW.h("option", { value: `${v.bank}:${v.preset}:${v.name}`, text: v.name })));
        sel.append(g);
      }
    }
    sel.addEventListener("change", () => LW.parts.assignVoice(p.part, sel.value));
    return sel;
  }

  function slider(p, field, max, label, valueEl) {
    const el = LW.h("div");
    const s = LW.ui.slider(el, {
      min: 0, max, step: 1, value: p[field] == null ? 0 : p[field], label: `Part ${p.part} ${label}`,
      onInput: (v) => {
        dragging.add(`${p.part}:${field}`);
        p[field] = Math.round(v);
        if (valueEl) LW.setText(valueEl, String(Math.round(v)));
        LW.parts.send(p.part, field, Math.round(v));
      },
      onChange: () => setTimeout(() => dragging.delete(`${p.part}:${field}`), 300),
    });
    el.classList.add("thin");
    sliders[`${p.part}:${field}`] = { s, valueEl };
    return el;
  }

  function render() {
    const list = $("partsList");
    if (!list) return;
    list.textContent = "";
    const community = engine() === "community";
    renderedEngine = engine();
    LW.setText($("partsTitle"), community ? "Community SoundFont parts" : "MONTAGE M parts");
    LW.setText($("partsEngine"), community ? "Community" : "MONTAGE M");
    state.forEach((p) => {
      const name = LW.h("input", { class: "field", value: p.name, maxlength: "24", "aria-label": `Part ${p.part} name` });
      name.value = p.name;
      name.addEventListener("change", () => LW.parts.rename(p.part, name.value));
      const m = LW.h("button", { class: "ms m" + (p.mute ? " on" : ""), type: "button", "aria-pressed": p.mute ? "true" : "false", "aria-label": `Mute part ${p.part}`, text: "M" });
      const so = LW.h("button", { class: "ms s" + (p.solo ? " on" : ""), type: "button", "aria-pressed": p.solo ? "true" : "false", "aria-label": `Solo part ${p.part}`, text: "S" });
      m.addEventListener("click", () => LW.parts.toggleMute(p.part));
      so.addEventListener("click", () => LW.parts.toggleSolo(p.part));
      const volV = LW.h("b", { text: String(p.val) }), revV = LW.h("b", { text: String(p.rev) });
      const six = LW.h("div", { class: "pp6" });
      PARAMS.forEach(([f, label]) => {
        const v = LW.h("b", { text: String(p[f]) });
        six.append(LW.h("div", { class: "pv" }, LW.h("span", { text: label }), v, slider(p, f, 127, label, v)));
      });
      const card = LW.h("div", { class: "part" + (p.mute ? " muted-p" : ""), data: { part: String(p.part) } },
        LW.h("div", { class: "part-h" }, LW.h("span", { class: "no", text: String(p.part) }), name, community ? voiceSelect(p) : null, m, so),
        LW.h("div", { class: "pv" }, LW.h("span", { text: "Volume" }), slider(p, "val", 127, "volume", volV), volV),
        LW.h("div", { class: "pv" }, LW.h("span", { text: "Reverb" }), slider(p, "rev", 127, "reverb", revV), revV),
        six);
      list.append(card);
    });
  }

  function syncValues() {
    state.forEach((p) => {
      ["val", "rev", ...PARAMS.map((x) => x[0])].forEach((f) => {
        const k = `${p.part}:${f}`, e = sliders[k];
        if (!e || dragging.has(k)) return;
        e.s.set(p[f]);
        if (e.valueEl) LW.setText(e.valueEl, String(p[f]));
      });
      const card = $("partsList") && $("partsList").querySelector(`[data-part="${p.part}"]`);
      if (!card) return;
      card.classList.toggle("muted-p", p.mute);
      const [m, s] = card.querySelectorAll(".ms");
      if (m) { m.classList.toggle("on", p.mute); m.setAttribute("aria-pressed", p.mute ? "true" : "false"); }
      if (s) { s.classList.toggle("on", p.solo); s.setAttribute("aria-pressed", p.solo ? "true" : "false"); }
      const input = card.querySelector("input.field");
      if (input && document.activeElement !== input && input.value !== p.name) input.value = p.name;
    });
  }

  LW.parts = {
    state,
    send(part, field, v) {
      const key = field === "val" ? "volume" : field === "rev" ? "reverb" : field;
      post({ part, [key]: v }).catch(() => {});
    },
    async rename(part, name) {
      const n = (name || `Part ${part}`).trim().slice(0, 24) || `Part ${part}`;
      state[part - 1].name = n;
      await LW.api.post("/api/montage/names", { parts: { [part]: n } }).catch(() => {});
    },
    async toggleMute(part) {
      const p = state[part - 1];
      p.mute = !p.mute;
      syncValues();
      await post({ part, mute: p.mute }).catch(() => {});
    },
    async toggleSolo(part) {
      try {
        const data = await post({ part, solo: true });
        if (data && data.solos) {
          for (let s = 1; s <= 8; s++) { state[s - 1].solo = Boolean(data.solos[s]); state[s - 1].mute = Boolean(data.mutes && data.mutes[s]); }
        }
      } catch (_) {}
      syncValues();
    },
    async assignVoice(part, val) {
      if (!val) return;
      const [bank, preset, ...rest] = val.split(":");
      const name = rest.join(":");
      try {
        await LW.api.post("/api/montage/assign_voice", { part, bank: parseInt(bank, 10), preset: parseInt(preset, 10), name });
        state[part - 1].name = name;
        syncValues();
        LW.alert({ icon: "synth", tone: "ok", title: `Part ${part}`, sub: `Now playing ${name}` }, 1600);
      } catch (_) {}
    },
    render,
  };

  LW.on("ready", () => {
    sheet = LW.sheet($("sheetParts"));
    LW.registerSheet("parts", sheet, () => {
      if (!catalog) LW.api.get("/api/montage/voices").then((d) => { catalog = Array.isArray(d) ? d : []; if (engine() === "community") render(); }).catch(() => {});
      render();
    });
  });

  LW.on("scene-recalled", (snap) => {
    if (!snap || !snap.parts) return;
    for (const k in snap.parts) { const p = state[parseInt(k, 10) - 1]; if (p) p.val = snap.parts[k]; }
    syncValues();
  });

  const MAP = { part_names: "name", part_pans: "pan", part_cutoffs: "cutoff", part_resonances: "resonance", part_attacks: "attack", part_releases: "release", part_chorus: "chorus", part_volumes: "val", part_reverbs: "rev", part_mutes: "mute", part_solos: "solo" };
  LW.on("telemetry", (d) => {
    const m = d.montage;
    if (!m) return;
    let touched = false;
    for (const key in MAP) {
      const src = m[key];
      if (!src) continue;
      const f = MAP[key];
      for (let n = 1; n <= 8; n++) {
        if (src[n] === undefined || dragging.has(`${n}:${f}`)) continue;
        const v = f === "mute" || f === "solo" ? Boolean(src[n]) : src[n];
        if (state[n - 1][f] !== v) { state[n - 1][f] = v; touched = true; }
      }
    }
    if (touched && sheet && sheet.isOpen) syncValues();
    if (sheet && sheet.isOpen && renderedEngine !== engine()) render();
  });
})(window);
