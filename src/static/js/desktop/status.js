/* Audio engine status: sidebar footer summary + popover details, island alerts on load changes. */
(function (root) {
  const LW = root.LW;
  const $ = (id) => document.getElementById(id);
  let lastUi = 0, lastState = "", lastReachable = null;

  function update(force) {
    const now = performance.now();
    if (!force && now - lastUi < 180) return;
    lastUi = now;
    const engine = LW.state.engine || {};
    const audio = LW.state.audio || {};
    const reachable = Boolean(engine.reachable);
    root.g_nativeEngineRunning = reachable;
    const sr = reachable ? (engine.sample_rate || 44100) : (audio.samplerate || 48000);
    const buf = reachable ? (engine.buffer_frames || 256) : (audio.blocksize || 256);
    const latency = Number(reachable ? engine.total_latency_ms : (audio.latency_ms || 6.8)) || 0;
    const dsp = reachable ? Math.max(0, engine.dsp_load_percent || 0) : 0;
    const peak = reachable ? (engine.peak_dsp_load_percent || 0) : 0;
    const xruns = reachable ? (engine.xruns || 0) : 0;
    let state = "Stable", cls = "ok";
    if (dsp >= 90) { state = "Overloaded"; cls = "bad"; }
    else if (dsp >= 70 || (reachable && peak >= 98)) { state = "Warning"; cls = "warn"; }

    $("engineDot").className = "dot " + (audio.samplerate || reachable ? cls : "");
    LW.setText($("engineSummary"), !reachable && !audio.samplerate
      ? "Audio status"
      : `${Math.round(sr / 1000)}k · ${buf} spl · ${latency.toFixed(1)} ms · DSP ${Math.round(dsp)}% · XRUN ${xruns}`);
    LW.setText($("epState"), state);
    $("epState").style.color = cls === "bad" ? "var(--bad)" : cls === "warn" ? "var(--rec)" : "var(--ok)";
    LW.setText($("epDriver"), reachable ? `${engine.backend || "native"} (${audio.hostapi || "ASIO"})` : (audio.hostapi || "ASIO"));
    LW.setText($("epDevice"), reachable ? (engine.device || audio.device_name || "Default") : (audio.device_name || "Default"));
    LW.setText($("epSr"), `${sr} Hz`);
    LW.setText($("epBuf"), `${buf} frames`);
    LW.setText($("epLat"), `${reachable ? engine.buffer_latency_ms : (latency / 2).toFixed(1)} ms / ${latency.toFixed(1)} ms`);
    LW.setText($("epDsp"), `${dsp.toFixed(1)}% (peak ${peak.toFixed(1)}%)`);
    LW.setText($("epXruns"), String(xruns));

    if (lastState && state !== lastState && state !== "Stable") {
      LW.alert({ icon: "alert", tone: cls === "bad" ? "bad" : "rec", title: `Audio engine ${state.toLowerCase()}`, sub: `DSP ${Math.round(dsp)}% · ${xruns} dropouts` }, 2400);
    }
    lastState = state;
    if (lastReachable !== null && reachable !== lastReachable) {
      LW.alert(reachable
        ? { icon: "synth", tone: "ok", title: "Sound engine connected", sub: engine.device || "Native host" }
        : { icon: "synth", tone: "bad", title: "Sound engine stopped", sub: "Using the built-in audio path" }, 2200);
    }
    lastReachable = reachable;
    if (reachable && engine.warmth) LW.emit("warmth-meter", Math.max(0, engine.warmth.meter || 0));
  }

  LW.status = { update };
  LW.on("telemetry", () => update(false));
  LW.on("engine-popover", () => update(true));

  // MIDI device plug / unplug
  let lastPort;
  LW.on("telemetry", (d) => {
    if (!d.midi) return;
    const port = d.midi.connected ? (d.midi.port_name || "MIDI keyboard") : null;
    const dot = $("midiDot");
    if (dot) dot.className = "dot " + (port ? "ok" : "");
    if (lastPort !== undefined && port !== lastPort) {
      LW.alert(port ? { icon: "midi", tone: "ok", title: `${port} connected`, sub: "MIDI input ready" } : { icon: "midi", tone: "bad", title: "MIDI keyboard disconnected", sub: lastPort || "" }, 2200);
    }
    lastPort = port;
  });
})(window);
