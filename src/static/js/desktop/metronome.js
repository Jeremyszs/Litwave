/* Metronome: on/off (inspector + toolbar), BPM 40–280, tap tempo, sound, time signature, click level 0–200 %,
   and a pulse light that follows the tempo while the click runs. */
(function (root) {
  const LW = root.LW;
  const $ = (id) => document.getElementById(id);
  const S = () => LW.state;
  let taps = [], enabled = false, bpm = 120, sig = 4, sw = null, level = null;

  const mixer = (key, val) => LW.api.post("/api/mixer", { [key]: val }).catch(() => {});

  function bpmFromTaps(times) {
    if (!times || times.length < 2) return null;
    const gaps = [];
    for (let i = 1; i < times.length; i++) gaps.push(times[i] - times[i - 1]);
    if (gaps[gaps.length - 1] > 2000) return null;
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const v = Math.round(60000 / avg);
    return v >= 40 && v <= 280 ? v : null;
  }
  const levelText = (v) => (v > 1 ? `Boost ${Math.round(v * 100)}%` : `${Math.round(v * 100)}%`);

  function paintEnabled() {
    if (sw) sw.set(enabled);
    $("tbMetro").setAttribute("aria-pressed", enabled ? "true" : "false");
  }

  LW.metronome = {
    bpmFromTaps,
    async toggle() {
      enabled = !enabled;
      paintEnabled();
      try { await LW.api.post("/api/mixer", { toggle_metronome: true }); }
      catch (_) { enabled = !enabled; paintEnabled(); return; }
      LW.alert({ icon: "metro", title: enabled ? "Click on" : "Click off", sub: `${bpm} BPM · ${sig === 6 ? "6/8" : sig === 7 ? "7/8" : sig + "/4"}` }, 1100);
    },
    tap() {
      const now = performance.now();
      taps.push(now);
      if (taps.length > 4) taps.shift();
      if (taps.length >= 2 && now - taps[taps.length - 2] > 2000) { taps = [now]; return; }
      const v = bpmFromTaps(taps);
      if (v) { bpm = v; $("bpmInput").value = v; mixer("metronome_bpm", v); LW.alert({ icon: "tap", title: `${v} BPM`, sub: "Tap tempo" }, 900); }
    },
    setBpm(v) {
      const n = LW.clamp(Math.round(Number(v) || 120), 40, 280);
      bpm = n; $("bpmInput").value = n; mixer("metronome_bpm", n);
    },
  };

  LW.on("ready", () => {
    sw = LW.ui.toggle($("metroSwitch"), false, () => LW.metronome.toggle());
    $("tbMetro").addEventListener("click", () => LW.metronome.toggle());
    $("btnTap").addEventListener("click", () => LW.metronome.tap());
    $("bpmInput").addEventListener("change", (e) => LW.metronome.setBpm(e.target.value));
    $("metroSound").addEventListener("change", (e) => mixer("metronome_profile", e.target.value));
    $("timeSig").addEventListener("change", (e) => { sig = parseInt(e.target.value, 10); mixer("metronome_time_sig", sig); });
    level = LW.ui.slider($("clickLevel"), {
      min: 0, max: 2, value: 1, label: "Click level", format: levelText,
      onInput: (v) => { S().dragging.metro = true; LW.setText($("clickLevelV"), levelText(v)); mixer("metronome_volume", v); },
      onChange: () => setTimeout(() => { S().dragging.metro = false; }, 250),
    });
    $("clickLevel").classList.add("thin");
    const set = level.set;
    level.set = (v) => { set(v); LW.setText($("clickLevelV"), levelText(level.get())); };
    LW.faders.metro = level;

    // Pulse light: beat 1 in yellow, other beats in blue.
    let beatAt = 0, beat = 0;
    const pulse = $("metroPulse");
    LW.onFrame(() => {
      if (!enabled) { if (pulse.className !== "metro-pulse") pulse.className = "metro-pulse"; return; }
      const now = performance.now(), period = 60000 / bpm;
      if (now - beatAt >= period) { beatAt = now; beat = (beat + 1) % (sig || 4); }
      const on = now - beatAt < 110;
      pulse.className = "metro-pulse" + (on ? (beat === 0 ? " down" : " beat") : "");
    });
  });

  LW.on("telemetry", (d) => {
    const a = d.audio;
    if (!a) return;
    if (a.metronome_enabled !== undefined && Boolean(a.metronome_enabled) !== enabled) { enabled = Boolean(a.metronome_enabled); paintEnabled(); }
    if (a.metronome_bpm !== undefined) {
      bpm = Math.round(a.metronome_bpm);
      const inp = $("bpmInput");
      if (inp && document.activeElement !== inp && Math.abs(parseFloat(inp.value) - a.metronome_bpm) >= 1) inp.value = bpm;
    }
    if (a.metronome_time_sig !== undefined) {
      sig = a.metronome_time_sig;
      const sel = $("timeSig");
      if (sel && document.activeElement !== sel && parseInt(sel.value, 10) !== sig) sel.value = String(sig);
    }
    if (a.metronome_profile !== undefined) {
      const sel = $("metroSound");
      if (sel && document.activeElement !== sel && sel.value !== a.metronome_profile) sel.value = a.metronome_profile;
    }
  });
})(window);
