/* Arrangement: waveform canvas, time ruler, playhead, loop band, chord lane, click-to-seek. */
(function (root) {
  const LW = root.LW;
  const $ = (id) => document.getElementById(id);
  const S = () => LW.state;
  let drawnPeaks = null, drawnW = 0, drawnTheme = "";
  let chartKey = "", rulerKey = "";

  function drawWaveform(force) {
    const canvas = $("waveCanvas");
    if (!canvas) return;
    const peaks = S().peaks || [];
    const r = canvas.getBoundingClientRect();
    const theme = LW.theme.current();
    if (!force && peaks === drawnPeaks && Math.round(r.width) === drawnW && theme === drawnTheme) return;
    drawnPeaks = peaks; drawnW = Math.round(r.width); drawnTheme = theme;
    const dpr = root.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);
    $("waveEmpty").hidden = peaks.length > 0;
    if (!peaks.length) return;
    ctx.fillStyle = LW.token("--wave", "#0A84FF");
    const mid = r.height / 2;
    const bw = r.width / peaks.length;
    for (let i = 0; i < peaks.length; i++) {
      const bh = Math.max(2, peaks[i] * r.height * 0.82);
      ctx.fillRect(i * bw, mid - bh / 2, Math.max(0.8, bw - 0.6), bh);
    }
  }

  function renderRuler() {
    const d = S().duration;
    const key = d + ":" + Math.round($("ruler").offsetWidth / 40);
    if (key === rulerKey) return;
    rulerKey = key;
    const ruler = $("ruler");
    ruler.textContent = "";
    if (!d) return;
    const w = ruler.offsetWidth || 800;
    const steps = [5, 10, 15, 30, 60, 120];
    const step = steps.find((s) => (w / (d / s)) >= 64) || 300;
    for (let t = 0; t <= d; t += step) {
      const pct = (t / d) * 100;
      ruler.append(LW.h("i", { style: { left: pct + "%" } }));
      if (pct < 97) ruler.append(LW.h("span", { style: { left: pct + "%" }, text: LW.fmt(t) }));
    }
  }

  function renderChordLane() {
    const lane = $("chordLane");
    const chart = S().chart || [];
    const d = S().duration;
    const key = d + ":" + chart.length + ":" + (chart[0] ? chart[0].time : "") + ":" + (chart.length ? chart[chart.length - 1].chord : "");
    if (key === chartKey) return;
    chartKey = key;
    lane.textContent = "";
    if (!d || !chart.length) return;
    chart.forEach((c, i) => {
      if (!root.ChordTimeline.playableChord(c)) return;
      const end = Number.isFinite(c.end) ? c.end : Number.isFinite(c.duration) ? c.time + c.duration : (chart[i + 1] ? chart[i + 1].time : d);
      const left = (c.time / d) * 100, width = Math.max(0.2, ((end - c.time) / d) * 100);
      const blk = LW.h("div", { class: "blk", style: { left: left + "%", width: width + "%" }, title: `${c.chord} · ${LW.fmt(c.time)}` }, c.chord);
      if (c.nashville && c.nashville !== "-") blk.append(LW.h("em", { text: c.nashville }));
      blk._t0 = c.time; blk._t1 = end;
      lane.append(blk);
    });
    fitChordLabels();
  }

  // Blocks too narrow for their label show only the colour; the title still names the chord.
  function fitChordLabels() {
    root.requestAnimationFrame(() => {
      for (const b of $("chordLane").children) b.classList.toggle("tiny", b.offsetWidth < 34);
    });
  }

  let activeBlk = null;
  function markActiveChord(t) {
    const lane = $("chordLane");
    let found = null;
    for (const b of lane.children) if (t >= b._t0 && t < b._t1) { found = b; break; }
    if (found === activeBlk) return;
    if (activeBlk) activeBlk.classList.remove("on");
    activeBlk = found;
    if (found) found.classList.add("on");
  }

  function renderPosition() {
    const s = S().song || {};
    const d = S().duration;
    const ph = $("playhead");
    const wave = $("waveWrap");
    const x = d > 0 ? (S().time / d) * wave.offsetWidth : 0;
    ph.style.transform = `translateX(${x}px)`;
    ph.style.opacity = S().hasTrack ? "1" : "0";
    const band = $("loopBand");
    const on = s.has_track && s.loop_enabled && s.loop_a != null && s.loop_b != null && d > 0;
    band.classList.toggle("on", !!on);
    if (on) { band.style.left = (s.loop_a / d) * 100 + "%"; band.style.width = ((s.loop_b - s.loop_a) / d) * 100 + "%"; }
    markActiveChord(S().time);
  }

  LW.waveform = { draw: drawWaveform };

  LW.on("ready", () => {
    $("waveWrap").addEventListener("click", (e) => {
      if (LW.markers && LW.markers.dragging) return;
      if (e.target.closest(".flag-tag")) return;
      const d = S().duration;
      if (!d) return;
      const r = $("waveWrap").getBoundingClientRect();
      LW.transport.seek(LW.clamp((e.clientX - r.left) / r.width, 0, 1) * d);
    });
    $("chordLane").addEventListener("click", (e) => {
      const b = e.target.closest(".blk");
      if (b) LW.transport.seek(b._t0);
    });
    let t = null;
    const redraw = () => { clearTimeout(t); t = setTimeout(() => { rulerKey = ""; drawWaveform(true); renderRuler(); renderPosition(); fitChordLabels(); }, 120); };
    root.addEventListener("resize", redraw);
    LW.on("layout", redraw);
    LW.on("theme", () => drawWaveform(true));
    LW.on("panel-expand", redraw);
  });

  LW.on("telemetry", (d) => {
    if (!d.song) return;
    drawWaveform(false);
    renderRuler();
    renderChordLane();
    renderPosition();
  });
})(window);
