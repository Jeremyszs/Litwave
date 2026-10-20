/* Phone · Parts tab: scenes 1–8 (recall, save, rename) and parts 1–8 (volume, reverb, pan, cutoff, resonance,
   attack, release, chorus, mute/solo, rename, voice preset for the Community engine). */
(function (root) {
  const LW = root.LW;
  const R = LW.R;
  const $ = (id) => document.getElementById(id);
  const S = R.state;
  const PARAMS = [["pan", "Pan", 64], ["cutoff", "Cutoff", 64], ["resonance", "Reson", 64], ["attack", "Attack", 64], ["release", "Release", 64], ["chorus", "Chorus", 0]];
  const parts = [100, 100, 90, 95, 105, 85, 100, 95].map((v, i) => ({ part: i + 1, name: `Part ${i + 1}`, val: v, rev: 40, mute: false, solo: false, pan: 64, cutoff: 64, resonance: 64, attack: 64, release: 64, chorus: 0 }));
  const sliders = {}, dragging = new Set();
  let voices = null, renderedEngine = null, scenesKey = "", dlgPart = null, dlgScene = null, renaming = 1;

  const post = (body) => LW.api.post("/api/montage/volume", body);

  function scenes() {
    const key = JSON.stringify(S.scenes);
    if (key === scenesKey) return;
    scenesKey = key;
    const box = $("scenes");
    box.textContent = "";
    for (let n = 1; n <= 8; n++) {
      const b = LW.h("button", { class: "scene" + (n === S.scenes.active ? " on" : ""), type: "button", "data-press": "sink", text: R.sceneName(n) });
      b.addEventListener("click", () => R.parts.selectScene(n));
      box.append(b);
    }
    LW.ui.press(box);
    LW.setText($("sceneActive"), R.sceneName(S.scenes.active));
  }

  function sliderFor(p, field, label, valueEl) {
    const host = LW.h("div", { class: "grow" });
    const s = LW.ui.slider(host, {
      min: 0, max: 127, step: 1, value: p[field], label: `Part ${p.part} ${label}`,
      onInput: (v) => {
        dragging.add(`${p.part}:${field}`);
        p[field] = Math.round(v);
        LW.setText(valueEl, String(Math.round(v)));
        const key = field === "val" ? "volume" : field === "rev" ? "reverb" : field;
        post({ part: p.part, [key]: Math.round(v) }).catch(() => {});
      },
      onChange: () => setTimeout(() => dragging.delete(`${p.part}:${field}`), 300),
    });
    host.classList.add("thin");
    sliders[`${p.part}:${field}`] = { s, valueEl };
    return host;
  }

  function render() {
    const box = $("parts");
    box.textContent = "";
    const community = S.engineType === "community";
    renderedEngine = S.engineType;
    LW.setText($("partsEngine"), community ? "Community" : "MONTAGE M");
    parts.forEach((p) => {
      const nameBtn = LW.h("button", { class: "pname", type: "button", "aria-label": `Rename part ${p.part}` }, LW.h("span", { text: p.name }), LW.h("span", { class: "ed", html: LW.icon("edit") }));
      nameBtn.addEventListener("click", () => R.parts.openRename(p.part));
      const m = LW.h("button", { class: "ms m" + (p.mute ? " on" : ""), type: "button", "aria-label": `Mute part ${p.part}`, text: "M" });
      const so = LW.h("button", { class: "ms s" + (p.solo ? " on" : ""), type: "button", "aria-label": `Solo part ${p.part}`, text: "S" });
      m.addEventListener("click", () => R.parts.toggleMute(p.part));
      so.addEventListener("click", () => R.parts.toggleSolo(p.part));
      let voiceSel = null;
      if (community && voices) {
        voiceSel = LW.h("select", { class: "sel", "aria-label": `Voice for part ${p.part}` });
        voiceSel.append(LW.h("option", { value: "", text: "Voice…" }));
        const cats = {};
        voices.forEach((v) => { (cats[v.category] = cats[v.category] || []).push(v); });
        for (const c in cats) {
          const g = LW.h("optgroup", { label: c });
          cats[c].forEach((v) => g.append(LW.h("option", { value: `${v.bank}:${v.preset}:${v.name}`, text: v.name })));
          voiceSel.append(g);
        }
        voiceSel.addEventListener("change", () => R.parts.assignVoice(p.part, voiceSel.value));
      }
      const volV = LW.h("b", { class: "num", text: String(p.val) }), revV = LW.h("b", { class: "num", text: String(p.rev) });
      const six = LW.h("div", { class: "p6" });
      PARAMS.forEach(([f, label]) => {
        const v = LW.h("b", { class: "num", text: String(p[f]) });
        six.append(LW.h("div", { class: "p6c" }, LW.h("div", { class: "p6h" }, LW.h("span", { text: label }), v), sliderFor(p, f, label, v)));
      });
      box.append(LW.h("div", { class: "ph-card part" + (p.mute ? " muted-p" : ""), data: { part: String(p.part) } },
        LW.h("div", { class: "part-h" }, LW.h("span", { class: "no", text: String(p.part) }), nameBtn, m, so),
        voiceSel,
        LW.h("div", { class: "sl-row" }, LW.h("span", { class: "faint", text: "Volume" }), sliderFor(p, "val", "volume", volV), volV),
        LW.h("div", { class: "sl-row" }, LW.h("span", { class: "faint", text: "Reverb" }), sliderFor(p, "rev", "reverb", revV), revV),
        six));
    });
  }

  function syncValues() {
    parts.forEach((p) => {
      ["val", "rev", ...PARAMS.map((x) => x[0])].forEach((f) => {
        const k = `${p.part}:${f}`, e = sliders[k];
        if (!e || dragging.has(k)) return;
        e.s.set(p[f]); LW.setText(e.valueEl, String(p[f]));
      });
      const card = $("parts").querySelector(`[data-part="${p.part}"]`);
      if (!card) return;
      card.classList.toggle("muted-p", p.mute);
      const [m, s] = card.querySelectorAll(".ms");
      if (m) m.classList.toggle("on", p.mute);
      if (s) s.classList.toggle("on", p.solo);
      const nm = card.querySelector(".pname span");
      if (nm) LW.setText(nm, p.name);
    });
  }

  R.parts = {
    async selectScene(n) {
      LW.local.mark("scene");
      S.scenes.active = n;
      scenesKey = ""; scenes();
      LW.alert({ icon: "layers", title: R.sceneName(n), sub: `Scene ${n} recalled` }, 1100);
      try {
        const d = await LW.api.post("/api/montage/scene", { action: "recall", scene: n });
        if (d && d.snapshot && d.snapshot.parts) { for (const k in d.snapshot.parts) { const p = parts[parseInt(k, 10) - 1]; if (p) p.val = d.snapshot.parts[k]; } syncValues(); }
      } catch (_) {}
    },
    async saveScene() {
      const n = S.scenes.active;
      try {
        const d = await LW.api.post("/api/montage/scene", { action: "save", scene: n });
        if (d && d.success) {
          LW.alert({ icon: "save", tone: "ok", title: "Mix saved", sub: R.sceneName(n) }, 1300);
          LW.setText($("sceneSaveTxt"), `Saved to ${R.sceneName(n)}`);
          setTimeout(() => LW.setText($("sceneSaveTxt"), "Save mix to scene"), 1500);
        }
      } catch (_) {}
    },
    openRename(part) { renaming = part; LW.setText($("rpTitle"), `Rename part ${part}`); $("rpName").value = parts[part - 1].name; dlgPart.open(); setTimeout(() => $("rpName").focus(), 80); },
    async confirmRename() {
      const name = ($("rpName").value.trim() || `Part ${renaming}`).slice(0, 24);
      dlgPart.close();
      parts[renaming - 1].name = name; syncValues();
      LW.alert({ icon: "edit", title: `Part ${renaming}`, sub: `Renamed to ${name}` }, 1200);
      await LW.api.post("/api/montage/names", { parts: { [renaming]: name } }).catch(() => {});
    },
    openSceneRename() { LW.setText($("rsTitle"), `Rename scene ${S.scenes.active}`); $("rsName").value = R.sceneName(S.scenes.active); dlgScene.open(); setTimeout(() => $("rsName").focus(), 80); },
    async confirmSceneRename() {
      const n = S.scenes.active, name = ($("rsName").value.trim() || `Scene ${n}`).slice(0, 24);
      dlgScene.close();
      S.scenes.names[n] = name; scenesKey = ""; scenes();
      await LW.api.post("/api/montage/names", { scenes: { [n]: name } }).catch(() => {});
    },
    async toggleMute(part) { const p = parts[part - 1]; p.mute = !p.mute; syncValues(); await post({ part, mute: p.mute }).catch(() => {}); },
    async toggleSolo(part) {
      try {
        const d = await post({ part, solo: true });
        if (d && d.solos) for (let s = 1; s <= 8; s++) { parts[s - 1].solo = Boolean(d.solos[s]); parts[s - 1].mute = Boolean(d.mutes && d.mutes[s]); }
      } catch (_) {}
      syncValues();
    },
    async assignVoice(part, val) {
      if (!val) return;
      const [bank, preset, ...rest] = val.split(":");
      const name = rest.join(":");
      try {
        await LW.api.post("/api/montage/assign_voice", { part, bank: parseInt(bank, 10), preset: parseInt(preset, 10), name });
        parts[part - 1].name = name; syncValues();
        LW.alert({ icon: "synth", tone: "ok", title: `Part ${part}`, sub: name }, 1300);
      } catch (_) {}
    },
    render,
  };

  LW.on("r-ready", () => {
    dlgPart = LW.dialog($("dlgRenamePart"));
    dlgScene = LW.dialog($("dlgRenameScene"));
    $("rpSave").addEventListener("click", () => R.parts.confirmRename());
    $("rpName").addEventListener("keydown", (e) => { if (e.key === "Enter") R.parts.confirmRename(); });
    $("rsSave").addEventListener("click", () => R.parts.confirmSceneRename());
    $("rsName").addEventListener("keydown", (e) => { if (e.key === "Enter") R.parts.confirmSceneRename(); });
    $("sceneRename").addEventListener("click", () => R.parts.openSceneRename());
    $("sceneSave").addEventListener("click", () => R.parts.saveScene());
    LW.api.get("/api/montage/voices").then((d) => { voices = Array.isArray(d) ? d : []; if (S.engineType === "community") render(); }).catch(() => {});
    render();
    scenes();
  });

  const MAP = { part_names: "name", part_pans: "pan", part_cutoffs: "cutoff", part_resonances: "resonance", part_attacks: "attack", part_releases: "release", part_chorus: "chorus", part_volumes: "val", part_reverbs: "rev", part_mutes: "mute", part_solos: "solo" };
  LW.on("r-telemetry", (msg) => {
    const m = msg.montage;
    if (!m) return;
    let touched = false;
    for (const key in MAP) {
      if (!m[key]) continue;
      const f = MAP[key];
      for (let n = 1; n <= 8; n++) {
        if (m[key][n] === undefined || dragging.has(`${n}:${f}`)) continue;
        const v = f === "mute" || f === "solo" ? Boolean(m[key][n]) : m[key][n];
        if (parts[n - 1][f] !== v) { parts[n - 1][f] = v; touched = true; }
      }
    }
    if (renderedEngine !== S.engineType) render();
    else if (touched) syncValues();
    scenes();
  });
})(window);
