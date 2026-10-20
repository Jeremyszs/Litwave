/* Phone remote: shared state, telemetry intake, transport helpers. Feature files listen to "r-telemetry". */
(function (root) {
  const LW = root.LW;
  const sceneNames = {};
  for (let s = 1; s <= 8; s++) sceneNames[s] = `Scene ${s}`;

  const state = {
    connected: false,
    song: {},
    audio: {},
    montage: {},
    engine: {},
    midi: null,
    key: "C",
    engineType: "yamaha",
    engineRunning: false,
    drone: { active: false, root: "C", volume: 95, cutoff: 68 },
    fxPads: { bus_volume: 0.85, active_bank: "A", pad_indicators: {}, pads: {} },
    scenes: { names: sceneNames, active: 1 },
    dragging: {},
    lastMessageAt: 0,
  };

  const R = (LW.R = {
    state,
    sceneName: (n) => state.scenes.names[n] || `Scene ${n}`,
    transport(action, extra) {
      return LW.api.post("/api/transport", Object.assign({ action }, extra || {})).catch(() => null);
    },
    playAction() { return state.song && state.song.is_playing ? "pause" : "play"; },
    chordFromNotes(notes) {
      const TL = root.ChordTimeline;
      if (!notes || notes.length < 3) return { chord: "--", nashville: "" };
      const c = TL.detectAdvancedChord(notes);
      return { chord: c, nashville: c && c !== "--" ? TL.getChordWithNashville(c, state.key).nashville : "" };
    },
    /* Current chord: the song chart at the playhead if analysed, otherwise the live MIDI chord. */
    current() {
      const TL = root.ChordTimeline;
      const s = state.song || {};
      const t = s.current_time_seconds || 0;
      const chart = s.chord_chart || [];
      const cur = chart.length ? TL.playableChord(TL.chordAtTime(chart, t)) : null;
      const nxt = chart.length ? TL.nextPlayableChord(chart, t) : null;
      const midi = state.midi;
      const live = midi && midi.active_notes && midi.active_notes.length >= 3 ? R.chordFromNotes(midi.active_notes) : null;
      return {
        chord: live ? live.chord : cur ? cur.chord : "--",
        nashville: live ? live.nashville : cur && cur.nashville && cur.nashville !== "-" ? `[${cur.nashville}]` : "",
        next: nxt ? nxt.chord : "", nextAt: nxt ? nxt.time : null, start: cur ? cur.time : null, t,
      };
    },
    ingest(msg) {
      if (!msg) return;
      state.lastMessageAt = Date.now();
      if (msg.type === "fx_pad_pulse") { LW.emit("r-fx-pulse", msg); return; }
      if (msg.type === "midi_event") { LW.emit("r-midi", msg.data || {}); return; }
      if (msg.type !== "telemetry") return;
      if (msg.song) state.song = msg.song;
      if (msg.audio) state.audio = msg.audio;
      if (msg.engine) state.engine = msg.engine;
      if (msg.midi) state.midi = msg.midi;
      if (msg.montage) {
        state.montage = Object.assign({}, state.montage, msg.montage);
        if (msg.montage.engine_type) state.engineType = msg.montage.engine_type;
        state.engineRunning = Boolean(msg.montage.is_running || (msg.engine && msg.engine.reachable));
        if (msg.montage.scene_names) for (const k in msg.montage.scene_names) if (msg.montage.scene_names[k]) state.scenes.names[k] = msg.montage.scene_names[k];
        if (msg.montage.current_scene !== undefined && !LW.local.recent("scene", 800)) state.scenes.active = msg.montage.current_scene;
      }
      // Follow the analysed song key for Nashville numbers, like the classic remote.
      const a = msg.song && msg.song.analysis;
      const k = a ? (a.key_root || a.key) : null;
      if (typeof k === "string" && k) {
        const rootKey = k.replace("m", "");
        if (rootKey && rootKey !== state.key) { state.key = rootKey; LW.emit("r-key", rootKey); }
      }
      LW.emit("r-telemetry", msg);
    },
  });
})(window);
