/* Sound engine manager: choose Yamaha MONTAGE M VST3 or the Community SoundFont host, open its window, stop it. */
(function (root) {
  const LW = root.LW;
  const $ = (id) => document.getElementById(id);
  let active = "yamaha", pending = "yamaha", sheet = null;
  try { active = root.localStorage.getItem("litwave_active_engine") || "yamaha"; } catch (_) {}
  pending = active;

  const running = () => Boolean(LW.state.engine && LW.state.engine.reachable) || Boolean(root.g_nativeEngineRunning);
  const label = (e) => (e === "community" ? "Community SoundFont" : "MONTAGE M");

  function paint() {
    LW.$$("#sheetEngine .eng").forEach((b) => {
      const on = b.dataset.engine === pending;
      b.classList.toggle("sel-on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    LW.$$("#sheetEngine [data-badge]").forEach((b) => { b.hidden = !(running() && b.dataset.badge === active); });
    const st = $("engineStatusTxt");
    if (st) { LW.setText(st, running() ? `Running · ${label(active)}` : "Stopped"); st.style.color = running() ? "var(--ok)" : "var(--ink2)"; }
    LW.setText($("sbEngineSub"), `${label(active)}${running() ? " · running" : ""}`);
  }

  LW.engine = {
    active: () => active,
    choose(e) { pending = e; paint(); },
    async open() {
      active = pending;
      try { root.localStorage.setItem("litwave_active_engine", active); } catch (_) {}
      sheet.close();
      try {
        if (active === "yamaha") {
          await LW.api.post("/api/montage/editor", { action: "show", engine: "yamaha" });
          root.g_nativeEngineRunning = true;
          LW.alert({ icon: "synth", tone: "ok", title: "MONTAGE M window opened" }, 1600);
        } else {
          await LW.api.post("/api/montage/editor", { action: "start", engine: "community", hidden: true });
          root.g_nativeEngineRunning = true;
          LW.alert({ icon: "synth", tone: "ok", title: "Community SoundFont running", sub: "Opening its parts mixer" }, 1600);
          LW.openSheet("parts");
        }
      } catch (_) {}
      paint();
    },
    async kill() {
      try { await LW.api.post("/api/montage/editor", { action: "kill" }); } catch (_) {}
      root.g_nativeEngineRunning = false;
      sheet.close();
      LW.alert({ icon: "power", tone: "bad", title: "Sound engine stopped", sub: "Process closed completely" }, 1800);
      paint();
    },
  };

  LW.on("ready", () => {
    sheet = LW.sheet($("sheetEngine"));
    LW.registerSheet("engine", sheet, () => { pending = active; paint(); });
    LW.$$("#sheetEngine .eng").forEach((b) => b.addEventListener("click", () => LW.engine.choose(b.dataset.engine)));
    $("engineOpen").addEventListener("click", () => LW.engine.open());
    $("engineKill").addEventListener("click", () => LW.engine.kill());
    paint();
  });
  let lastRun = null;
  LW.on("telemetry", (d) => { if (!d.engine) return; const r = running(); if (r !== lastRun) { lastRun = r; paint(); } });
})(window);
