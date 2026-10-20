/* Desktop shared state. Filled by renderTelemetry and by local actions. */
(function (root) {
  const LW = root.LW;
  const sceneNames = {};
  for (let s = 1; s <= 8; s++) sceneNames[s] = `Scene ${s}`;
  LW.state = {
    connected: false,
    song: {},            // telemetry.song
    audio: {},           // last known telemetry.audio
    midi: null,
    montage: {},
    engine: {},
    devices: null,
    spectrum: [],
    chart: [],           // analysis chord chart
    lyrics: [],          // synced lyrics sheet
    markers: [],
    peaks: [],           // waveform peaks
    duration: 0,
    time: 0,
    hasTrack: false,
    pitch: 0,
    nashKey: "C",        // key used for Nashville numbers
    recordingChords: false,
    analysis: null,
    scenes: { names: sceneNames, active: 1 },
    fxPads: { bus_volume: 0.85, bus_muted: false, active_bank: "A", pad_indicators: {}, pads: {} },
    drone: { active: false, root: "C", volume: 95, cutoff: 68 },
    warmth: { enabled: true, drive: 1.2, mode: 0 },
    analyzerEnabled: true,
    dragging: {},        // channel -> true while the user holds that control
  };
  LW.faders = {};        // channel -> slider API (track, synth, fx, master, metro)
  LW.sceneName = (n) => LW.state.scenes.names[n] || `Scene ${n}`;
})(typeof window !== "undefined" ? window : globalThis);
