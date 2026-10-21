/* Ambient drone pad (root + 5th on part 8): start/stop, 12 roots, voice, volume, cutoff.
   Optimistic UI: incoming telemetry can't undo a user change for 600 ms. Island bubble while running. */
(function (root) {
  const LW = root.LW;
  const $ = (id) => document.getElementById(id);
  const S = () => LW.state;
  const ROOTS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const LABEL = { "C#": "C♯", "D#": "E♭", "F#": "F♯", "G#": "A♭", "A#": "B♭" };
  let lastUser = -Infinity, sheet = null, vol = null, cut = null, sbSwitch = null;
  const subs = new Set();

  const post = (body) => LW.api.post("/api/drone-pad", body);
  const pct = (v) => `${Math.round((v / 127) * 100)}%`;

  function sync() {
    const d = S().drone;
    if ($("droneKeys")) LW.$$(".dkey", $("droneKeys")).forEach((b) => b.classList.toggle("on", b.dataset.k === d.root));
    const t = $("droneToggle");
    if (t) { t.classList.toggle("on", !!d.active); LW.setText(t, d.active ? `Stop drone pad (${LABEL[d.root] || d.root})` : "Start drone pad"); }
    if ($("droneDot")) $("droneDot").className = "dot" + (d.active ? " ok" : "");
    if (sbSwitch) sbSwitch.set(!!d.active);
    LW.setText($("sbDroneSub"), d.active ? `${LABEL[d.root] || d.root} · running` : "Off");
    if (vol && !vol.dragging) { vol.set(d.volume); LW.setText($("droneVolV"), pct(d.volume)); }
    if (cut && !cut.dragging) { cut.set(d.cutoff); LW.setText($("droneCutV"), pct(d.cutoff)); }
    if (LW.isl) LW.isl.bubble(!!d.active);
    subs.forEach((fn) => fn(d));
  }

  async function apply(promise) {
    try { const data = await promise; if (data && data.drone_pad) { S().drone = data.drone_pad; sync(); } } catch (_) {}
  }

  LW.drone = {
    ROOTS, LABEL,
    toggle(force) {
      lastUser = performance.now();
      LW.local.mark("drone");
      const d = S().drone;
      const on = force == null ? !d.active : !!force;
      d.active = on;
      sync();
      LW.alert({ icon: "wave", tone: on ? "ok" : "", title: on ? `Drone pad ${LABEL[d.root] || d.root}` : "Drone pad off", sub: on ? "Root + fifth, part 8" : "Fading out" }, 1500);
      return apply(post({ action: on ? "start" : "stop", root: d.root }));
    },
    setRoot(k) {
      lastUser = performance.now();
      LW.local.mark("drone");
      S().drone.root = k;
      sync();
      if (S().drone.active) LW.alert({ icon: "wave", title: `Drone · ${LABEL[k] || k}`, sub: "Crossfading over 2 s" }, 1300);
      return apply(post({ action: "set_root", root: k }));
    },
    setVoice(v) {
      const [bank, preset] = String(v).split(":").map((x) => parseInt(x, 10));
      post({ action: "set_voice", bank, preset }).catch(() => {});
    },
    // Dragging only previews (live value + readout); the server hears about it once, on release.
    previewVolume(v) { lastUser = performance.now(); S().drone.volume = Math.round(v); LW.setText($("droneVolV"), pct(v)); },
    previewCutoff(v) { lastUser = performance.now(); S().drone.cutoff = Math.round(v); LW.setText($("droneCutV"), pct(v)); },
    setVolume(v) { LW.drone.previewVolume(v); return post({ action: "set_volume", volume: Math.round(v) }).catch(() => {}); },
    setCutoff(v) { LW.drone.previewCutoff(v); return post({ action: "set_cutoff", cutoff: Math.round(v) }).catch(() => {}); },
    onChange(fn) { subs.add(fn); return () => subs.delete(fn); },
  };

  LW.on("ready", () => {
    sheet = LW.sheet($("sheetDrone"));
    LW.registerSheet("drone", sheet, sync);
    const keys = $("droneKeys");
    ROOTS.forEach((k) => {
      const b = LW.h("button", { class: "dkey", type: "button", data: { k }, "data-press": "sink", text: LABEL[k] || k });
      b.addEventListener("click", () => LW.drone.setRoot(k));
      keys.append(b);
    });
    LW.ui.press(keys);
    $("droneToggle").addEventListener("click", () => LW.drone.toggle());
    $("droneVoice").addEventListener("change", (e) => LW.drone.setVoice(e.target.value));
    vol = LW.ui.slider($("droneVol"), { min: 0, max: 127, step: 1, value: S().drone.volume, label: "Drone volume", format: pct, onInput: (v) => LW.drone.previewVolume(v), onChange: (v) => LW.drone.setVolume(v) });
    cut = LW.ui.slider($("droneCut"), { min: 0, max: 127, step: 1, value: S().drone.cutoff, label: "Drone warmth", format: pct, onInput: (v) => LW.drone.previewCutoff(v), onChange: (v) => LW.drone.setCutoff(v) });
    $("droneVol").classList.add("thin"); $("droneCut").classList.add("thin");
    sbSwitch = LW.ui.toggle($("sbDroneSwitch"), false, (on) => LW.drone.toggle(on));
    $("sbDroneSwitch").addEventListener("click", (e) => e.stopPropagation());
    const row = $("sbDrone");
    row.addEventListener("click", () => LW.openSheet("drone", row));
    sync();
  });

  LW.on("telemetry", (d) => {
    if (!d.drone_pad) return;
    if (performance.now() - lastUser <= 600 || (vol && vol.dragging) || (cut && cut.dragging)) return;
    const prev = S().drone;
    const next = d.drone_pad;
    const changed = prev.root !== next.root || prev.active !== next.active || prev.volume !== next.volume || prev.cutoff !== next.cutoff;
    S().drone = Object.assign({}, prev, next);
    if (changed) sync();
  });
})(window);
