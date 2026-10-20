/* Preferences: audio output, buffer size, MIDI input (hot-plug refresh while open), velocity curve/scale/offset,
   appearance. Plus the phone remote sheet (QR + copyable address). */
(function (root) {
  const LW = root.LW;
  const $ = (id) => document.getElementById(id);
  let sheet = null, scale = null, offset = null, themeTabs = null, velTimer = null, remoteSheet = null, lastDevKey = "";

  function fillDevices(data) {
    if (!data || !data.devices) return;
    const key = JSON.stringify([data.devices, data.audio && data.audio.device_id, data.midi && data.midi.port_name]);
    if (key === lastDevKey) return;
    lastDevKey = key;
    const audioSel = $("prefAudio");
    const prev = audioSel.value;
    audioSel.textContent = "";
    (data.devices.audio_outputs || []).forEach((d) => {
      const o = LW.h("option", { value: String(d.id), text: `${d.is_asio ? "ASIO · " : ""}${d.name} (${d.hostapi})` });
      if (data.audio && d.id === data.audio.device_id) o.selected = true;
      else if (!data.audio && String(d.id) === prev) o.selected = true;
      audioSel.append(o);
    });
    const midiSel = $("prefMidi");
    midiSel.textContent = "";
    const ports = data.devices.midi_inputs || [];
    if (!ports.length) midiSel.append(LW.h("option", { value: "", text: "No MIDI input connected" }));
    ports.forEach((p) => { const o = LW.h("option", { value: p, text: p }); if (data.midi && p === data.midi.port_name) o.selected = true; midiSel.append(o); });
    if (data.audio && data.audio.blocksize) $("prefBuffer").value = String(data.audio.blocksize);
    const vc = data.midi && data.midi.velocity_config;
    if (vc) {
      if (vc.curve) $("prefVelCurve").value = vc.curve;
      if (vc.scale !== undefined && scale && !scale.dragging) { scale.set(vc.scale); LW.setText($("prefVelScaleV"), `${Number(vc.scale).toFixed(2)}×`); }
      if (vc.offset !== undefined && offset && !offset.dragging) { offset.set(vc.offset); LW.setText($("prefVelOffsetV"), `${vc.offset > 0 ? "+" : ""}${vc.offset}`); }
    }
  }

  async function loadDevices(prefetched) {
    let data = prefetched;
    if (!data) { try { data = await LW.api.get("/api/status"); } catch (_) { return; } }
    fillDevices(data);
  }

  function sendVelocity() {
    clearTimeout(velTimer);
    velTimer = setTimeout(() => {
      LW.api.post("/api/midi/velocity", { curve: $("prefVelCurve").value, scale: scale.get(), offset: Math.round(offset.get()) }).catch(() => {});
    }, 120);
  }

  LW.prefs = { loadDevices };

  LW.on("ready", () => {
    sheet = LW.sheet($("sheetPrefs"));
    LW.registerSheet("prefs", sheet, () => { lastDevKey = ""; loadDevices(); themeTabs.select(["system", "light", "dark"].indexOf(LW.theme.pref()), false); });
    $("prefAudio").addEventListener("change", async (e) => {
      await LW.api.post("/api/audio/device", { device_id: parseInt(e.target.value, 10) }).catch(() => {});
      LW.alert({ icon: "gear", title: "Audio output changed", sub: e.target.selectedOptions[0] ? e.target.selectedOptions[0].textContent : "" }, 1600);
      lastDevKey = ""; loadDevices();
    });
    $("prefBuffer").addEventListener("change", async (e) => {
      try {
        const st = await LW.api.get("/api/status");
        await LW.api.post("/api/audio/device", { device_id: st.audio.device_id, blocksize: parseInt(e.target.value, 10) });
        LW.alert({ icon: "gear", title: "Buffer size changed", sub: `${e.target.value} samples` }, 1400);
      } catch (_) {}
    });
    $("prefMidi").addEventListener("change", async (e) => {
      if (!e.target.value) return;
      await LW.api.post("/api/midi/device", { port: e.target.value }).catch(() => {});
      lastDevKey = ""; loadDevices();
    });
    $("prefVelCurve").addEventListener("change", sendVelocity);
    scale = LW.ui.slider($("prefVelScale"), { min: 0.5, max: 1.5, step: 0.01, value: 1, label: "Velocity scale", onInput: (v) => { LW.setText($("prefVelScaleV"), `${v.toFixed(2)}×`); sendVelocity(); } });
    offset = LW.ui.slider($("prefVelOffset"), { min: -30, max: 30, step: 1, value: 0, label: "Velocity offset", onInput: (v) => { LW.setText($("prefVelOffsetV"), `${v > 0 ? "+" : ""}${Math.round(v)}`); sendVelocity(); } });
    $("prefVelScale").classList.add("thin"); $("prefVelOffset").classList.add("thin");
    themeTabs = LW.ui.tabs($("prefTheme"), (i, k) => LW.theme.set(k));

    // Phone remote
    remoteSheet = LW.sheet($("sheetRemote"));
    LW.registerSheet("remote", remoteSheet, async () => {
      let url = `${root.location.origin}/remote`;
      try { const d = await LW.api.get("/api/remote-info"); if (d && d.local_url) url = d.local_url; } catch (_) {}
      $("remoteUrl").value = url;
      const img = $("qrImg");
      img.onload = () => { img.hidden = false; };
      img.onerror = () => { img.hidden = true; };
      img.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}`;
    });
    $("remoteCopy").addEventListener("click", async () => {
      const v = $("remoteUrl").value;
      try { await root.navigator.clipboard.writeText(v); LW.alert({ icon: "copy", tone: "ok", title: "Address copied", sub: v }, 1500); }
      catch (_) { $("remoteUrl").select(); }
    });
    $("remoteUrl").addEventListener("click", (e) => e.target.select());
  });

  LW.on("telemetry", (d) => { if (d.devices && sheet && sheet.isOpen) fillDevices(Object.assign({}, LW.state.lastStatus || {}, d)); });
})(window);
