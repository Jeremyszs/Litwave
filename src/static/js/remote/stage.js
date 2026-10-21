/* Phone · Stage tab: song key, MIDI input, giant live chord + Nashville, next chord countdown, drone pad. */
let g_lastRemoteDroneInteraction = -Infinity; // optimistic-UI window: telemetry may not undo a tap for 600 ms

(function (root) {
  const LW = root.LW;
  const R = LW.R;
  const $ = (id) => document.getElementById(id);
  const S = R.state;
  const ROOTS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const LABEL = { "C#": "C♯", "D#": "E♭", "F#": "F♯", "G#": "A♭", "A#": "B♭" };
  let sw = null, vol = null, lastChord = null, lastNext = null;

  const pct = (v) => `${Math.round((v / 127) * 100)}%`;
  const post = (body) => LW.api.post("/api/drone-pad", body);

  function syncDrone() {
    const d = S.drone;
    if (sw) sw.set(!!d.active);
    LW.$$(".rk", $("droneRoots")).forEach((b) => b.classList.toggle("on", b.dataset.k === d.root));
    $("droneDot").className = "dot" + (d.active ? " ok" : "");
    LW.setText($("droneSub"), d.active ? `${LABEL[d.root] || d.root} · running` : "Off");
    if (vol && !vol.dragging) { vol.set(d.volume); LW.setText($("droneVolV"), pct(d.volume)); }
    if (R.isl) R.isl.bubble(!!d.active);
  }
  async function apply(p) {
    try { const data = await p; if (data && data.drone_pad) { S.drone = data.drone_pad; syncDrone(); } } catch (_) {}
  }

  R.drone = {
    toggle(force) {
      g_lastRemoteDroneInteraction = performance.now();
      const on = force == null ? !S.drone.active : !!force;
      S.drone.active = on;
      syncDrone();
      LW.alert({ icon: "wave", tone: on ? "ok" : "", title: on ? `Drone ${LABEL[S.drone.root] || S.drone.root}` : "Drone off" }, 1300);
      return apply(post({ action: on ? "start" : "stop", root: S.drone.root }));
    },
    setRoot(k) {
      g_lastRemoteDroneInteraction = performance.now();
      S.drone.root = k;
      syncDrone();
      if (S.drone.active) LW.alert({ icon: "wave", title: `Drone · ${LABEL[k] || k}` }, 1100);
      return apply(post({ action: "set_root", root: k }));
    },
    // Dragging only previews (live value + readout); the server hears about it once, on release.
    previewVolume(v) {
      g_lastRemoteDroneInteraction = performance.now();
      S.drone.volume = Math.round(v);
      LW.setText($("droneVolV"), pct(v));
    },
    setVolume(v) {
      R.drone.previewVolume(v);
      return post({ action: "set_volume", volume: Math.round(v) }).catch(() => {});
    },
    setVoice(val) {
      const [bank, preset] = String(val).split(":").map((x) => parseInt(x, 10));
      post({ action: "set_voice", bank, preset }).catch(() => {});
    },
  };

  function renderChord() {
    const c = R.current();
    const label = c.chord === "--" ? "—" : c.chord;
    if (label !== lastChord) { lastChord = label; LW.swap($("liveChord"), label); }
    LW.setText($("liveNash"), c.nashville || "");
    if (c.next !== lastNext) { lastNext = c.next; LW.swap($("nextChord"), c.next || "—"); }
    const inS = c.nextAt != null ? Math.max(0, c.nextAt - c.t) : null;
    LW.setText($("nextIn"), inS == null ? "--" : inS >= 10 ? `${Math.round(inS)}s` : inS.toFixed(1));
    let f = 0;
    if (c.nextAt != null && c.start != null && c.nextAt > c.start) f = LW.clamp((c.t - c.start) / (c.nextAt - c.start), 0, 1);
    const ring = document.querySelector && document.querySelector(".next-card .p");
    if (ring) ring.setAttribute("stroke-dashoffset", (144.5 * (1 - f)).toFixed(1));
  }

  LW.on("r-ready", () => {
    const roots = $("droneRoots");
    ROOTS.forEach((k) => {
      const b = LW.h("button", { class: "rk", type: "button", data: { k }, "data-press": "sink", text: LABEL[k] || k });
      b.addEventListener("click", () => R.drone.setRoot(k));
      roots.append(b);
    });
    sw = LW.ui.toggle($("droneSwitch"), false, (on) => R.drone.toggle(on));
    vol = LW.ui.slider($("droneVol"), { min: 0, max: 127, step: 1, value: 95, label: "Drone volume", format: pct, onInput: (v) => R.drone.previewVolume(v), onChange: (v) => R.drone.setVolume(v) });
    $("droneVol").classList.add("thin");
    $("droneVoice").addEventListener("change", (e) => R.drone.setVoice(e.target.value));
    $("keySelect").addEventListener("change", (e) => { S.key = e.target.value; lastChord = null; renderChord(); });
    syncDrone();
    renderChord();
  });

  LW.on("r-key", (k) => { const sel = $("keySelect"); if (sel) sel.value = k; });

  LW.on("r-telemetry", (msg) => {
    if (msg.drone_pad && performance.now() - g_lastRemoteDroneInteraction > 600 && !(vol && vol.dragging)) {
      const prev = S.drone, next = msg.drone_pad;
      const changed = prev.root !== next.root || prev.active !== next.active || prev.volume !== next.volume;
      S.drone = Object.assign({}, prev, next);
      if (changed) syncDrone();
    }
    const m = msg.midi;
    if (m) {
      const names = m.active_note_names || [];
      LW.setText($("lastNote"), names.length ? names.join(" ") : "Ready");
    }
    renderChord();
  });

  LW.on("r-midi", (data) => {
    if (!data.active_notes) return;
    S.midi = Object.assign({}, S.midi || {}, { active_notes: data.active_notes, active_note_names: data.active_note_names || [] });
    LW.setText($("lastNote"), data.active_note_names && data.active_note_names.length ? data.active_note_names.join(" ") : "Ready");
    renderChord();
  });
})(window);
