/* Studio bootstrap: layout, Dynamic Island, keyboard shortcuts, live connection. Loaded last. */
(function (root) {
  const LW = root.LW;
  const $ = (id) => document.getElementById(id);

  function sectionJump(dir) {
    const list = [...(LW.state.markers || [])].sort((a, b) => a.time - b.time);
    const t = LW.state.time;
    if (dir < 0) {
      const prev = list.filter((m) => m.time < t - 1.5).pop();
      LW.transport.seek(prev ? prev.time : 0);
    } else {
      const next = list.find((m) => m.time > t + 0.25);
      if (next) LW.transport.seek(next.time);
    }
  }

  function initIsland() {
    LW.isl = LW.island.create($("island"), $("bubble"), {
      onAction: (a) => {
        if (a === "play") LW.transport.toggle();
        if (a === "prev") sectionJump(-1);
        if (a === "next") sectionJump(1);
      },
      onSeek: (f) => { if (LW.state.duration > 0) LW.transport.seek(f * LW.state.duration); },
      onBubble: () => LW.openSheet("drone"),
    });
    $("bubble").innerHTML = LW.icon("wave");
    LW.on("alert", (a, ms) => LW.isl.alert(a, ms));
    LW.updateIsland && LW.updateIsland();
  }

  function shortcuts() {
    root.addEventListener("keydown", LW.keys.handle);
  }

  LW.keys = { handle(e) {
      // Dialogs focus a text field, so Escape must still close them while typing. It never rewinds from a field.
      if (e.key === "Escape" && LW.isTyping(e)) {
        if (LW.sheets.closeTop()) { e.preventDefault(); if (e.target.blur) e.target.blur(); }
        return;
      }
      if (LW.isTyping(e)) return;
      if (e.target.getAttribute && e.target.getAttribute("role") === "button" && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault(); e.target.click(); return;
      }
      if (e.code === "F12" || (e.code === "KeyP" && (e.ctrlKey || e.metaKey) && e.shiftKey)) { e.preventDefault(); LW.transport.panic(); return; }
      if (e.key === "Escape") {
        if (LW.layout.closePopover && LW.layout.closePopover()) return;
        if (LW.sheets.closeTop()) return;
        if (LW.stage && LW.stage.active) { LW.stage.exit(); return; }
        if (LW.layout.collapsePanel && LW.layout.collapsePanel()) return;
        LW.transport.seek(0);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === "z" || e.key === "Z") && LW.undo && LW.undo.available) {
        e.preventDefault(); LW.undo.run(); return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target.closest && e.target.closest(".sl, .tabbar, .seg") && e.key.startsWith("Arrow")) return;
      if (e.code === "Space") { e.preventDefault(); LW.transport.toggle(); }
      else if (e.key === "[") LW.transport.loopA();
      else if (e.key === "]") LW.transport.loopB();
      else if (e.key === "l" || e.key === "L") LW.transport.toggleLoop();
      else if (e.key === "t" || e.key === "T") { if (LW.metronome) LW.metronome.tap(); }
      else if (e.key === "b" || e.key === "B") LW.markers.openDialog();
      else if (e.key === "p" || e.key === "P") { if (LW.stage) LW.stage.active ? LW.stage.exit() : LW.stage.enter(); }
  } };

  function boot() {
    LW.layout.init();
    initIsland();
    LW.emit("ready");
    LW.ui.press(document);
    LW.hydrateIcons(document);
    shortcuts();
    LW.ws.connect();
    setTimeout(() => {
      if (!LW.state.connected) LW.alert({ icon: "alert", tone: "bad", title: "Waiting for Litwave", sub: "Is the Litwave server running?" }, 2600);
    }, 2500);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(window);
