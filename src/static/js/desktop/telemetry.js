/* Telemetry hub: the WebSocket feed (25 fps) lands here, updates LW.state, keeps controls in sync
   (never while the user is dragging them) and notifies feature modules via LW.emit("telemetry"). */
let lastRecordedChord = "";
let lastRecordedChordTime = 0;
let g_prevRemote = null; // previous values used to spot changes made by another client

function renderTelemetry(data) {
  const LW = window.LW;
  const S = LW.state;
  if (!data) return;
  if (data.audio) S.audio = data.audio;
  const audio = S.audio || {};
  if (data.engine) {
    S.engine = data.engine;
    if (data.engine.analyzer_enabled !== undefined) S.analyzerEnabled = Boolean(data.engine.analyzer_enabled);
  }
  if (data.montage) S.montage = Object.assign({}, S.montage, data.montage);
  if (data.devices) S.devices = data.devices;
  if (Array.isArray(data.spectrum)) S.spectrum = data.spectrum;
  if (data.midi) S.midi = data.midi;

  // Fader sync from server (another client or a scene recall) unless the user holds the control.
  const syncFader = (ch, value) => {
    if (value === undefined || value === null) return;
    const f = LW.faders[ch];
    if (!f || S.dragging[ch] || f.dragging) return;
    f.set(value);
  };
  syncFader("track", audio.track_volume);
  syncFader("master", audio.master_volume);
  syncFader("fx", audio.fx_pad_volume);
  syncFader("metro", audio.metronome_volume);
  if (data.montage && data.montage.master_volume !== undefined) syncFader("synth", data.montage.master_volume / 127);

  // Song / transport
  const song = data.song;
  if (song) {
    S.song = song;
    S.hasTrack = Boolean(song.has_track);
    S.time = song.current_time_seconds || 0;
    S.duration = song.duration_seconds || 0;
    if (song.chord_chart) S.chart = song.chord_chart;
    if (Array.isArray(song.lyrics_sheet)) S.lyrics = song.lyrics_sheet;
    if (song.markers) S.markers = song.markers;
    if (song.waveform_peaks && song.waveform_peaks.length) S.peaks = song.waveform_peaks;
    if (song.pitch_shift !== undefined) S.pitch = song.pitch_shift;
    if (song.analysis) S.analysis = song.analysis;
    if (!S.hasTrack) { S.peaks = []; S.markers = []; S.chart = []; S.lyrics = []; S.analysis = null; }
  }

  // Learn Chords: record what the player holds into the song's chord timeline.
  const midi = data.midi;
  if (midi && S.recordingChords && midi.active_notes && midi.active_notes.length) {
    const cName = window.ChordTimeline.detectAdvancedChord(midi.active_notes);
    if (cName && cName !== "--" && !cName.includes("Poly")) {
      const nash = window.ChordTimeline.getChordWithNashville(cName, S.nashKey).nashville;
      const nowTime = S.duration > 0 ? S.time : 0;
      if (cName !== lastRecordedChord || (nowTime - lastRecordedChordTime) > 1.5) {
        lastRecordedChord = cName;
        lastRecordedChordTime = nowTime;
        if (LW.transport) LW.transport.action("record_chord", { chord: cName, nashville: nash, time: nowTime });
      }
    }
  }

  detectRemoteChanges(data);
  LW.emit("telemetry", data);
}

// Show an island alert when state changes that this desktop did not cause (phone remote, other tab).
function detectRemoteChanges(data) {
  const LW = window.LW;
  const now = {
    scene: data.montage && data.montage.current_scene !== undefined ? data.montage.current_scene : undefined,
    drone: data.drone_pad ? `${data.drone_pad.active ? 1 : 0}:${data.drone_pad.root}` : undefined,
    play: data.song && data.song.has_track ? Boolean(data.song.is_playing) : undefined,
    loop: data.song && data.song.has_track ? Boolean(data.song.loop_enabled) : undefined,
    song: data.song ? (data.song.filename || "") : undefined,
  };
  if (!g_prevRemote) { g_prevRemote = now; return; }
  const changed = (k) => now[k] !== undefined && g_prevRemote[k] !== undefined && now[k] !== g_prevRemote[k] && !LW.local.recent(k, 1800);
  if (changed("scene")) LW.alert({ icon: "layers", title: `Remote · ${LW.sceneName ? LW.sceneName(now.scene) : "Scene " + now.scene}`, sub: "Scene recalled" }, 1800);
  if (changed("drone")) {
    const [on, root] = now.drone.split(":");
    LW.alert({ icon: "wave", tone: on === "1" ? "ok" : "", title: on === "1" ? `Remote · Drone ${root}` : "Remote · Drone off", sub: "Ambient pad" }, 1600);
  }
  if (changed("play")) LW.alert({ icon: now.play ? "play" : "pause", title: now.play ? "Remote · Play" : "Remote · Pause", sub: now.song || "" }, 1200);
  if (changed("loop")) LW.alert({ icon: "loop", title: now.loop ? "Remote · Loop on" : "Remote · Loop off" }, 1200);
  if (changed("song") && now.song) LW.alert({ icon: "check", tone: "ok", title: "Remote · Song loaded", sub: now.song }, 1800);
  for (const k in now) if (now[k] !== undefined) g_prevRemote[k] = now[k];
}

(function (root) {
  const LW = root.LW;
  LW.renderTelemetry = renderTelemetry;
  LW.ws = {
    client: null,
    connect() {
      if (!root.WsTelemetry || LW.ws.client) return;
      let wasConnected = false;
      LW.ws.client = root.WsTelemetry.createWsClient({
        path: "/ws",
        handlers: {
          telemetry: (msg) => renderTelemetry(msg),
          midi_event: (msg) => LW.emit("midi_event", msg.data || {}),
          fx_pad_pulse: (msg) => LW.emit("fx_pulse", msg),
        },
        onOpen: () => {
          LW.state.connected = true;
          if (wasConnected) LW.alert({ icon: "check", tone: "ok", title: "Reconnected", sub: "Live link to Litwave restored" }, 1600);
          wasConnected = true;
          LW.emit("connection", true);
        },
        onClose: () => {
          if (LW.state.connected) LW.alert({ icon: "alert", tone: "bad", title: "Connection lost", sub: "Reconnecting to Litwave…" }, 2600);
          LW.state.connected = false;
          LW.emit("connection", false);
        },
      });
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
