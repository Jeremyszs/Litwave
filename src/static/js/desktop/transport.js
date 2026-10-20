/* Transport: play/pause, rewind, A–B loop, speed, panic. Same /api/transport bodies as the classic UI. */
(function (root) {
  const LW = root.LW;
  const $ = (id) => document.getElementById(id);

  LW.transport = {
    action(action, extra) {
      return LW.api.post("/api/transport", Object.assign({ action }, extra || {})).catch(() => null);
    },
    toggle() { LW.local.mark("play"); return LW.transport.action("toggle"); },
    seek(seconds) { return LW.transport.action("seek", { seconds: Math.max(0, Number(seconds) || 0) }); },
    rewind() { return LW.transport.seek(0); },
    toggleLoop() { LW.local.mark("loop"); return LW.transport.action("toggle_loop"); },
    loopA() { LW.alert({ icon: "loop", title: "Loop start set", sub: LW.fmt(LW.state.time) }, 1100); return LW.transport.action("loop_a"); },
    loopB() { LW.alert({ icon: "loop", title: "Loop end set", sub: LW.fmt(LW.state.time) }, 1100); return LW.transport.action("loop_b"); },
    clearLoop() { LW.local.mark("loop"); return LW.transport.action("clear_loop"); },
    speed(v) { return LW.transport.action("speed", { speed: parseFloat(v) }); },
    async panic() {
      LW.emit("panic");
      try {
        const data = await LW.api.post("/api/midi/panic", {});
        LW.alert({ icon: "alert", tone: "bad", title: "All notes off", sub: `Controllers reset · ${(data && data.released_notes) || 0} notes released` }, 2000);
      } catch (_) { /* api already alerted */ }
    },
  };

  LW.on("ready", () => {
    $("btnPlay").addEventListener("click", () => LW.transport.toggle());
    $("btnRewind").addEventListener("click", () => LW.transport.rewind());
    $("btnLoop").addEventListener("click", () => LW.transport.toggleLoop());
    $("btnLoopA").addEventListener("click", () => LW.transport.loopA());
    $("btnLoopB").addEventListener("click", () => LW.transport.loopB());
    $("btnLoopReset").addEventListener("click", () => LW.transport.clearLoop());
    $("speedSelect").addEventListener("change", (e) => LW.transport.speed(e.target.value));
    $("btnPanic").addEventListener("click", () => LW.transport.panic());
  });

  let lastPlaying = null, lastLoop = null;
  LW.on("telemetry", (d) => {
    const s = d.song;
    if (!s) return;
    const playing = Boolean(s.has_track && s.is_playing);
    const loop = Boolean(s.has_track && s.loop_enabled && s.loop_a != null && s.loop_b != null);
    if (playing !== lastPlaying) {
      lastPlaying = playing;
      $("btnPlay").classList.toggle("on", playing);
      LW.emit("playing", playing);
    }
    if (loop !== lastLoop) {
      lastLoop = loop;
      $("btnLoop").setAttribute("aria-pressed", loop ? "true" : "false");
      LW.emit("loop", loop);
    }
    if (s.speed !== undefined) {
      const sel = $("speedSelect");
      if (document.activeElement !== sel && parseFloat(sel.value) !== Number(s.speed)) sel.value = String(Number(s.speed).toFixed(2)).replace(/0$/, "");
    }
  });
})(window);
