/* MONTAGE scenes 1–8: recall, rename, save the current mix. Names and the active scene sync from telemetry. */
(function (root) {
  const LW = root.LW;
  const $ = (id) => document.getElementById(id);
  const S = () => LW.state;
  let dlg = null, renaming = 1, gridKey = "";

  function render() {
    const grid = $("scenesGrid");
    if (!grid) return;
    const key = JSON.stringify(S().scenes);
    if (key === gridKey) return;
    gridKey = key;
    grid.textContent = "";
    for (let n = 1; n <= 8; n++) {
      const name = LW.sceneName(n);
      const b = LW.h("button", { class: "scene" + (n === S().scenes.active ? " on" : ""), type: "button", title: `Scene ${n}: ${name}`, "data-press": "sink" },
        name !== `Scene ${n}` ? `${n} · ${name}` : `Scene ${n}`);
      b.addEventListener("click", () => LW.scenes.select(n));
      grid.append(b);
    }
    LW.ui.press(grid);
    LW.setText($("sceneActive"), LW.sceneName(S().scenes.active));
    LW.emit("scenes", S().scenes);
  }

  LW.scenes = {
    render,
    async select(n) {
      LW.local.mark("scene");
      S().scenes.active = n;
      gridKey = "";
      render();
      LW.alert({ icon: "layers", title: LW.sceneName(n), sub: `Scene ${n} recalled` }, 1200);
      try {
        const data = await LW.api.post("/api/montage/scene", { action: "recall", scene: n });
        if (data && data.snapshot) LW.emit("scene-recalled", data.snapshot);
      } catch (_) {}
    },
    async save() {
      const n = S().scenes.active;
      try {
        const data = await LW.api.post("/api/montage/scene", { action: "save", scene: n });
        if (data && data.success) {
          LW.alert({ icon: "save", tone: "ok", title: "Mix saved", sub: `Stored in ${LW.sceneName(n)}` }, 1500);
          LW.setText($("btnSceneSaveTxt"), `Saved to ${LW.sceneName(n)}`);
          setTimeout(() => LW.setText($("btnSceneSaveTxt"), "Save mix to scene"), 1500);
        }
      } catch (_) {}
    },
    openRename(n) {
      renaming = n || S().scenes.active;
      LW.setText($("dlgRsTitle"), `Rename scene ${renaming}`);
      $("rsName").value = LW.sceneName(renaming);
      dlg.open($("btnSceneRename"));
      setTimeout(() => { $("rsName").focus(); $("rsName").select(); }, 80);
    },
    async confirmRename() {
      const name = ($("rsName").value.trim() || `Scene ${renaming}`).slice(0, 24);
      dlg.close();
      S().scenes.names[renaming] = name;
      gridKey = "";
      render();
      if (LW.markers) LW.markers.render();
      await LW.api.post("/api/montage/names", { scenes: { [renaming]: name } }).catch(() => {});
    },
  };

  LW.on("ready", () => {
    dlg = LW.dialog($("dlgRenameScene"));
    $("btnSceneRename").addEventListener("click", () => LW.scenes.openRename());
    $("rsSave").addEventListener("click", () => LW.scenes.confirmRename());
    $("rsName").addEventListener("keydown", (e) => { if (e.key === "Enter") LW.scenes.confirmRename(); });
    $("btnSceneSave").addEventListener("click", () => LW.scenes.save());
    render();
  });

  LW.on("telemetry", (d) => {
    const m = d.montage;
    if (!m) return;
    let changed = false;
    if (m.scene_names) {
      for (const k in m.scene_names) if (m.scene_names[k] && S().scenes.names[k] !== m.scene_names[k]) { S().scenes.names[k] = m.scene_names[k]; changed = true; }
    }
    if (m.current_scene !== undefined && m.current_scene !== S().scenes.active && !LW.local.recent("scene", 800)) { S().scenes.active = m.current_scene; changed = true; }
    if (changed) { gridKey = ""; render(); }
  });
})(window);
