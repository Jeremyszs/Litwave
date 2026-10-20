/* Phone · Mix tab: track/synth/FX/master/click levels, metronome (toggle, tap, sound, time), 4-band master EQ.
   Network writes are throttled to ~50 ms while dragging; telemetry never moves a slider you are holding. */
(function (root) {
  const LW = root.LW;
  const R = LW.R;
  const $ = (id) => document.getElementById(id);
  const S = R.state;
  const sliders = {};
  let taps = [], metroSw = null, eqLastEdit = 0;
  const bands = [{ freq: 100, q: 0.707, gain: 0 }, { freq: 500, q: 1, gain: 0 }, { freq: 2500, q: 1, gain: 0 }, { freq: 8000, q: 0.707, gain: 0 }];

  function throttle(fn, ms) {
    let last = 0, timer = null, pending = null;
    const run = () => { timer = null; last = Date.now(); fn(...pending); };
    return (...args) => {
      pending = args;
      const remain = ms - (Date.now() - last);
      if (remain <= 0) { clearTimeout(timer); run(); } else if (!timer) timer = setTimeout(run, remain);
    };
  }
  const send = throttle((path, body) => LW.api.post(path, body).catch(() => {}), 50);
  const sendFx = throttle((v) => LW.api.post("/api/fx-pads", { action: "bus", volume: v }).catch(() => {}), 50);
  const levelTxt = (v) => (v > 1 ? `Boost ${Math.round(v * 100)}%` : `${Math.round(v * 100)}%`);

  const CH = {
    track: { el: "volTrack", v: "volTrackV", max: 1, fmt: LW.db, send: (v) => send("/api/mixer", { track_volume: v }) },
    synth: { el: "volSynth", v: "volSynthV", max: 1, fmt: LW.db, send: (v) => send("/api/montage/volume", { master_volume: Math.round(v * 127) }) },
    fx: { el: "volFx", v: "volFxV", max: 1.5, fmt: LW.db, send: (v) => sendFx(v) },
    master: { el: "volMaster", v: "volMasterV", max: 1.2, fmt: LW.db, send: (v) => send("/api/mixer", { master_volume: v }) },
    metro: { el: "clickLevel", v: "clickLevelV", max: 2, fmt: levelTxt, send: (v) => send("/api/mixer", { metronome_volume: v }) },
  };

  function syncFx(v) {
    const top = R.faders && R.faders.fxTop;
    if (top && !top.dragging) top.set(v);
    LW.setText($("fxLevelV"), LW.db(v));
    if (sliders.fx && !sliders.fx.dragging) { sliders.fx.set(v); LW.setText($("volFxV"), LW.db(v)); }
  }

  R.mix = {
    eqGain: (ratio) => Math.round((LW.clamp(ratio, 0, 1) * 36 - 18) * 10) / 10,
    sendFx(v) { syncFx(v); sendFx(v); },
    async toggleMetro() {
      try { await LW.api.post("/api/mixer", { toggle_metronome: true }); } catch (_) {}
    },
    tap() {
      const now = performance.now();
      taps.push(now); if (taps.length > 4) taps.shift();
      if (taps.length < 2) return;
      const gaps = []; for (let i = 1; i < taps.length; i++) gaps.push(taps[i] - taps[i - 1]);
      const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      if (avg > 200 && avg < 2000) {
        const bpm = Math.round(60000 / avg);
        LW.setText($("bpm"), `${bpm} BPM`);
        LW.api.post("/api/mixer", { metronome_bpm: bpm }).catch(() => {});
      }
    },
  };

  function eqRow(i) {
    const v = LW.h("b", { class: "v num", text: "0.0" });
    const host = LW.h("div", { class: "grow" });
    const s = LW.ui.slider(host, {
      min: -18, max: 18, step: 0.5, value: 0, label: `EQ band ${i + 1}`,
      onInput: (g) => {
        eqLastEdit = performance.now();
        bands[i].gain = g;
        LW.setText(v, `${g > 0 ? "+" : ""}${g.toFixed(1)}`);
        send("/api/mixer", { equalizer_band: { index: i, gain: g, freq: bands[i].freq, q: bands[i].q } });
      },
    });
    host.classList.add("thin");
    bands[i].slider = s; bands[i].label = v;
    return LW.h("div", { class: "gr" }, LW.h("span", { class: "k", text: ["Low", "Low-mid", "High-mid", "High"][i] }), host, v);
  }

  LW.on("r-ready", () => {
    Object.keys(CH).forEach((ch) => {
      const c = CH[ch];
      const s = LW.ui.slider($(c.el), {
        min: 0, max: c.max, value: ch === "metro" ? 1 : ch === "track" ? 0.8 : ch === "fx" ? 0.85 : 1, label: ch, format: c.fmt,
        onInput: (v) => { S.dragging[ch] = true; LW.setText($(c.v), c.fmt(v)); if (ch === "fx") syncFx(v); c.send(v); },
        onChange: () => setTimeout(() => { S.dragging[ch] = false; }, 300),
      });
      $(c.el).classList.add("thin");
      sliders[ch] = s;
      LW.setText($(c.v), c.fmt(s.get()));
    });
    metroSw = LW.ui.toggle($("metroSwitch"), false, () => R.mix.toggleMetro());
    $("btnTap").addEventListener("click", () => R.mix.tap());
    $("metroSound").addEventListener("change", (e) => LW.api.post("/api/mixer", { metronome_profile: e.target.value }).catch(() => {}));
    $("timeSig").addEventListener("change", (e) => LW.api.post("/api/mixer", { metronome_time_sig: parseInt(e.target.value, 10) }).catch(() => {}));
    const box = $("eqBands");
    for (let i = 0; i < 4; i++) box.append(eqRow(i));
    $("eqFlat").addEventListener("click", () => {
      eqLastEdit = performance.now();
      bands.forEach((b) => { b.gain = 0; b.slider.set(0); LW.setText(b.label, "0.0"); });
      LW.alert({ icon: "flat", title: "EQ flat" }, 900);
      LW.api.post("/api/mixer", { equalizer_reset: true }).catch(() => {});
    });
  });

  LW.on("r-telemetry", (msg) => {
    const a = msg.audio, m = msg.montage;
    const sync = (ch, val) => {
      const s = sliders[ch];
      if (val === undefined || !s || S.dragging[ch] || s.dragging) return;
      s.set(val);
      LW.setText($(CH[ch].v), CH[ch].fmt(s.get()));
    };
    if (a) {
      sync("track", a.track_volume);
      sync("master", a.master_volume);
      sync("metro", a.metronome_volume);
      if (a.fx_pad_volume !== undefined && !S.dragging.fx) syncFx(a.fx_pad_volume);
      if (a.metronome_enabled !== undefined && metroSw) metroSw.set(Boolean(a.metronome_enabled));
      if (a.metronome_bpm !== undefined) LW.setText($("bpm"), `${Math.round(a.metronome_bpm)} BPM`);
      if (a.metronome_profile !== undefined && document.activeElement !== $("metroSound")) $("metroSound").value = a.metronome_profile;
      if (a.metronome_time_sig !== undefined && document.activeElement !== $("timeSig")) $("timeSig").value = String(a.metronome_time_sig);
      const eqT = a.equalizer && a.equalizer.bands;
      if (Array.isArray(eqT) && performance.now() - eqLastEdit > 1500) {
        eqT.forEach((b, i) => {
          const loc = bands[i];
          if (!loc || !loc.slider || loc.slider.dragging) return;
          if (b.freq !== undefined) loc.freq = b.freq;
          if (b.q !== undefined) loc.q = b.q;
          if (b.gain !== undefined && Math.abs(b.gain - loc.gain) > 0.05) { loc.gain = b.gain; loc.slider.set(b.gain); LW.setText(loc.label, `${b.gain > 0 ? "+" : ""}${Number(b.gain).toFixed(1)}`); }
        });
      }
    }
    if (m && m.master_volume !== undefined) sync("synth", m.master_volume / 127);
  });
})(window);
