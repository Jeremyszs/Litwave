/* Output mixer: Track, Synth, FX Pads and Master faders with meters. Same endpoints/ranges as the classic UI:
   track 0–1 and master 0–1.2 via /api/mixer, synth 0–1 → 0–127 via /api/montage/volume, FX bus 0–1.5 via /api/fx-pads. */
(function (root) {
  const LW = root.LW;
  const $ = (id) => document.getElementById(id);
  const S = () => LW.state;

  const CH = {
    track: { el: "fdTrack", db: "dbTrack", max: 1.0, send: (v) => LW.api.post("/api/mixer", { track_volume: v }) },
    synth: { el: "fdSynth", db: "dbSynth", max: 1.0, send: (v) => LW.api.post("/api/montage/volume", { master_volume: Math.round(v * 127) }) },
    fx: { el: "fdFx", db: "dbFx", max: 1.5, send: (v) => LW.api.post("/api/fx-pads", { action: "bus", volume: v }) },
    master: { el: "fdMaster", db: "dbMaster", max: 1.2, send: (v) => LW.api.post("/api/mixer", { master_volume: v }) },
  };
  const dbText = (v) => (v > 0 ? (20 * Math.log10(v)).toFixed(1) : "-inf");

  // Sends at most every 40 ms while dragging, plus the final value on release.
  function throttled(ch) {
    let last = 0, timer = null, pending = null;
    const flush = () => {
      clearTimeout(timer); timer = null; // an overdue update sent at once must not leave its timer behind
      if (pending === null) return;      // nothing waiting: never send an empty value
      last = performance.now(); const v = pending; pending = null; CH[ch].send(v).catch(() => {});
    };
    return (v, final) => {
      pending = v;
      if (final) { flush(); return; }
      const wait = 40 - (performance.now() - last);
      if (wait <= 0) flush(); else if (!timer) timer = setTimeout(flush, wait);
    };
  }

  LW.mixer = {
    set(ch, v, opts) {
      const c = CH[ch];
      if (!c) return;
      const val = LW.clamp(Number(v) || 0, 0, c.max);
      if (LW.faders[ch]) LW.faders[ch].set(val);
      LW.setText($(c.db), dbText(val));
      LW.emit("fader", ch, val);
      if (!opts || !opts.silent) c.send(val).catch(() => {});
    },
    get(ch) { return LW.faders[ch] ? LW.faders[ch].get() : 0; },
    max: (ch) => CH[ch].max,
  };

  LW.on("ready", () => {
    Object.keys(CH).forEach((ch) => {
      const c = CH[ch];
      const send = throttled(ch);
      const slider = LW.ui.slider($(c.el), {
        min: 0, max: c.max, value: ch === "fx" ? 0.85 : ch === "track" ? 0.8 : 1.0, vertical: true, label: `${ch} volume`,
        format: (v) => `${dbText(v)} dB`,
        onInput: (v) => { S().dragging[ch] = true; LW.setText($(c.db), dbText(v)); LW.emit("fader", ch, v); send(v); },
        onChange: (v) => { send(v, true); setTimeout(() => { S().dragging[ch] = false; }, 250); },
      });
      const origSet = slider.set;
      slider.set = (v) => { origSet(v); LW.setText($(c.db), dbText(slider.get())); LW.emit("fader", ch, slider.get()); };
      LW.faders[ch] = slider;
      LW.setText($(c.db), dbText(slider.get()));
    });
  });

  // VU meters: dB → 0–100 % over a 55 dB window, like the classic meters.
  const pct = (db) => LW.clamp(((db + 55) / 55) * 100, 0, 100);
  const meter = (id, db) => {
    const i = $(id);
    if (!i) return;
    const p = pct(db == null ? -60 : db);
    i.style.clipPath = `inset(${(100 - p).toFixed(1)}% 0 0 0)`;
    i.parentNode.classList.toggle("hot", p > 92);
  };
  LW.on("telemetry", (d) => {
    const a = d.audio;
    if (!a) return;
    meter("vuTrack", a.vu_track);
    meter("vuSynth", a.vu_synth);
    meter("vuFx", a.vu_fx);
    meter("vuMasterL", a.vu_master_l);
    meter("vuMasterR", a.vu_master_r);
  });
})(window);
