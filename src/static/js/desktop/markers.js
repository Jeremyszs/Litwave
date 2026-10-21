/* Section bookmarks: flags on the waveform (draggable), sections lane (jump, delete), bookmark dialog,
   and the scene auto-trigger when playback reaches a bookmark with a scene. */
(function (root) {
  const LW = root.LW;
  const $ = (id) => document.getElementById(id);
  const S = () => LW.state;
  let cacheKey = "";
  let lastTriggeredMarkerId = null, lastMarkerCheckTime = -1;
  let dlg = null;

  const sceneLabel = (n) => {
    const name = LW.sceneName(n);
    return name !== `Scene ${n}` ? `S${n} · ${name}` : `S${n}`;
  };
  const selectScene = (n) => {
    if (LW.scenes && LW.scenes.select) LW.scenes.select(n);
    else LW.api.post("/api/montage/scene", { action: "recall", scene: n }).catch(() => {});
  };

  function sorted() { return [...(S().markers || [])].sort((a, b) => a.time - b.time); }

  async function jump(m, next) {
    const scNum = m.scene ? parseInt(m.scene, 10) : null;
    if (scNum) selectScene(scNum);
    await LW.transport.seek(m.time);
    if (next && next.time > m.time) {
      await LW.transport.action("loop_a", { seconds: m.time });
      await LW.transport.action("loop_b", { seconds: next.time });
      await LW.transport.action("toggle_loop");
    }
    LW.alert({ icon: "bookmark", title: m.name, sub: next ? `Looping until ${next.name}` : `Jumped to ${LW.fmt(m.time)}` }, 1400);
  }

  function render() {
    const list = sorted();
    const d = S().duration;
    const key = JSON.stringify(list) + d + JSON.stringify(S().scenes.names);
    if (key === cacheKey) return;
    cacheKey = key;
    const flags = $("markerFlags"), lane = $("sectionLane");
    flags.textContent = ""; lane.textContent = "";
    if (!d) return;
    list.forEach((m, i) => {
      const next = list[i + 1] || null;
      const pct = (m.time / d) * 100;
      const scNum = m.scene ? parseInt(m.scene, 10) : null;
      flags.append(LW.h("div", { class: "flag", style: { left: pct + "%" } }));
      const tag = LW.h("div", { class: "flag-tag", style: { left: pct + "%" }, title: `${m.name} · ${LW.fmt(m.time)} — drag to move` }, scNum ? `${m.name} · ${sceneLabel(scNum)}` : m.name);
      bindDrag(tag, m, next);
      flags.append(tag);

      const endT = next ? next.time : d;
      const sec = LW.h("div", { class: "sec", role: "button", tabindex: "0", style: { left: pct + "%", width: Math.max(1, ((endT - m.time) / d) * 100) + "%" }, title: `${m.name} · ${LW.fmt(m.time)}` },
        LW.h("span", { text: m.name }),
        scNum ? LW.h("span", { class: "scn", text: sceneLabel(scNum) }) : null,
        LW.h("button", { class: "del", type: "button", "aria-label": `Delete bookmark ${m.name}`, html: LW.icon("close") }));
      sec.addEventListener("click", (e) => {
        if (e.target.closest(".del")) { e.stopPropagation(); LW.markers.remove(m.id); return; }
        jump(m, next);
      });
      sec.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); jump(m, next); } });
      lane.append(sec);
    });
  }

  function bindDrag(tag, m, next) {
    let startX = 0, moved = false;
    tag.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      tag.setPointerCapture(e.pointerId);
      startX = e.clientX; moved = false;
    });
    tag.addEventListener("pointermove", (e) => {
      if (!tag.hasPointerCapture(e.pointerId)) return;
      if (!moved && Math.abs(e.clientX - startX) < 4) return;
      moved = true; LW.markers.dragging = true; tag.classList.add("drag");
      const r = $("waveWrap").getBoundingClientRect();
      const pct = LW.clamp((e.clientX - r.left) / r.width, 0, 1) * 100;
      tag.style.left = pct + "%";
      if (tag.previousSibling) tag.previousSibling.style.left = pct + "%";
    });
    tag.addEventListener("pointerup", (e) => {
      if (!tag.hasPointerCapture(e.pointerId)) return;
      tag.releasePointerCapture(e.pointerId);
      tag.classList.remove("drag");
      if (!moved) { jump(m, next); return; }
      const r = $("waveWrap").getBoundingClientRect();
      const t = LW.clamp((e.clientX - r.left) / r.width, 0, 1) * S().duration;
      LW.transport.action("update_marker", { id: m.id, time: t });
      setTimeout(() => { LW.markers.dragging = false; }, 50);
    });
  }

  function checkAutoScene(curSec) {
    const list = sorted();
    if (!list.length) return;
    if (curSec < lastMarkerCheckTime - 0.5) lastTriggeredMarkerId = null; // rewound, seeked back or looped
    lastMarkerCheckTime = curSec;
    let active = null;
    for (const m of list) { if (curSec >= m.time - 0.05) active = m; else break; }
    if (active && active.scene) {
      const n = parseInt(active.scene, 10);
      if (n >= 1 && n <= 8 && active.id !== lastTriggeredMarkerId) {
        lastTriggeredMarkerId = active.id;
        LW.local.mark("scene");
        selectScene(n);
      }
    }
  }

  LW.markers = {
    dragging: false,
    openDialog() {
      if (!S().hasTrack) return;
      $("bmName").value = `Section ${(S().markers || []).length + 1}`;
      const sel = $("bmScene");
      sel.textContent = "";
      sel.append(LW.h("option", { value: "", text: "None (keep the current scene)" }));
      for (let n = 1; n <= 8; n++) {
        const name = LW.sceneName(n);
        sel.append(LW.h("option", { value: String(n), text: name !== `Scene ${n}` ? `Scene ${n} (${name})` : name }));
      }
      dlg.open($("btnBookmark"));
      setTimeout(() => { $("bmName").focus(); $("bmName").select(); }, 80);
    },
    async confirm() {
      const name = $("bmName").value.trim() || `Section ${(S().markers || []).length + 1}`;
      const sv = $("bmScene").value;
      dlg.close();
      await LW.transport.action("add_marker", { name, scene: sv ? parseInt(sv, 10) : null });
      LW.alert({ icon: "bookmark", tone: "ok", title: "Bookmark added", sub: `${name} · ${LW.fmt(S().time)}` }, 1500);
    },
    async remove(id) {
      const m = (S().markers || []).find((x) => x.id === Number(id));
      const res = await LW.transport.action("remove_marker", { id: Number(id) });
      if (m) {
        const back = { name: m.name, time: m.time, scene: m.scene == null ? null : m.scene };
        LW.undo.push({ icon: "bookmark", label: "Section deleted", sub: `${m.name} · ${LW.fmt(m.time)}`, run: () => LW.transport.action("add_marker", back) });
      }
      return res;
    },
    render() { cacheKey = ""; render(); },
  };

  LW.on("ready", () => {
    dlg = LW.dialog($("dlgBookmark"));
    $("btnBookmark").addEventListener("click", () => LW.markers.openDialog());
    $("bmSave").addEventListener("click", () => LW.markers.confirm());
    $("bmName").addEventListener("keydown", (e) => { if (e.key === "Enter") LW.markers.confirm(); });
    LW.on("layout", () => { cacheKey = ""; render(); });
  });

  LW.on("telemetry", (d) => {
    if (!d.song) return;
    if (!S().hasTrack) { if (cacheKey) { cacheKey = ""; $("markerFlags").textContent = ""; $("sectionLane").textContent = ""; } return; }
    render();
    if (d.song.is_playing) checkAutoScene(S().time);
  });
})(window);
