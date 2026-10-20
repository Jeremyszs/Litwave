/* Stage Warmth (analog soft saturation): on/off, drive 1.0–2.5, Tape/Crisp, saturation meter.
   Also owns the inspector's Mix / EQ / Click tabs. */
(function (root) {
  const LW = root.LW;
  const $ = (id) => document.getElementById(id);
  const S = () => LW.state;
  let lastUser = 0, sw = null, drive = null, mode = null, debounce = null;

  const post = () => LW.api.post("/api/master/dsp", { warmth: S().warmth }).catch(() => {});
  function paint() {
    const w = S().warmth;
    if (sw) sw.set(w.enabled);
    if (drive) drive.set(w.drive);
    LW.setText($("warmthDriveV"), `${Number(w.drive).toFixed(2)}×`);
    if (mode && mode.index !== (w.mode === 1 ? 1 : 0)) mode.select(w.mode === 1 ? 1 : 0, false);
  }

  LW.warmth = {
    toggle(v) { lastUser = performance.now(); S().warmth.enabled = v; post(); LW.alert({ icon: "eq", title: v ? "Stage warmth on" : "Stage warmth bypassed" }, 1100); },
    setDrive(v) { lastUser = performance.now(); S().warmth.drive = v; LW.setText($("warmthDriveV"), `${v.toFixed(2)}×`); clearTimeout(debounce); debounce = setTimeout(post, 100); },
    setMode(m) { lastUser = performance.now(); S().warmth.mode = m; post(); },
  };

  LW.on("ready", () => {
    sw = LW.ui.toggle($("warmthSwitch"), S().warmth.enabled, (on) => LW.warmth.toggle(on));
    drive = LW.ui.slider($("warmthDrive"), { min: 1, max: 2.5, step: 0.05, value: S().warmth.drive, label: "Warmth drive", onInput: (v) => LW.warmth.setDrive(v) });
    $("warmthDrive").classList.add("thin");
    mode = LW.ui.tabs($("warmthMode"), (i) => LW.warmth.setMode(i));
    paint();

    // Inspector tabs: panes slide in from the side you're moving towards.
    const panes = LW.$$("#inspector .ip");
    let cur = 0;
    LW.ui.tabs($("inspTabs"), (i, k) => {
      const dir = i > cur ? 1 : -1;
      panes.forEach((p, j) => { p.style.setProperty("--dir", dir); p.classList.toggle("on", j === i); });
      cur = i;
      if (LW.eq) LW.eq.setVisible(k === "eq");
      LW.emit("inspector-tab", k);
    });
  });

  LW.on("telemetry", (d) => {
    const w = d.engine && d.engine.warmth;
    if (!w || performance.now() - lastUser < 1200) return;
    S().warmth = { enabled: Boolean(w.enabled), drive: Number(w.drive), mode: Number(w.mode) };
    paint();
  });
  LW.on("warmth-meter", (sat) => {
    const i = $("warmthSat");
    if (i) i.style.clipPath = `inset(0 ${100 - Math.min(100, Math.round(sat * 300))}% 0 0)`;
  });
})(window);
