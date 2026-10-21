/* Song header: title, timecode, load/upload, analyze, clear, track intelligence, sync click, key shift,
   and the island's live content (chord, position, progress). */
(function (root) {
  const LW = root.LW;
  const $ = (id) => document.getElementById(id);
  const S = () => LW.state;
  let pitchStepper = null, lastAnalysisKey = "", lastFile = null, analyzing = false;

  function displayTrackIntelligence(intel) {
    if (!intel) return;
    const key = JSON.stringify([intel.key, intel.key_full, intel.bpm, intel.time_sig, intel.time_signature]);
    if (key === lastAnalysisKey) return;
    lastAnalysisKey = key;
    $("intel").hidden = false;
    $("intelKey").textContent = `Key ${intel.key || intel.key_full || "--"}`;
    $("intelBpm").textContent = `${intel.bpm ? Math.round(intel.bpm) : "--"} BPM`;
    const meter = String(intel.time_sig || intel.time_signature || "--");
    $("intelMeter").textContent = /^\d+$/.test(meter) ? `${meter}/4` : meter;
    const detected = intel.key || intel.key_root;
    if (detected) {
      const rootKey = String(detected).replace("m", "");
      S().nashKey = rootKey;
      const sel = $("nashKeySelect");
      if (sel) sel.value = rootKey;
      LW.emit("nash-key", rootKey);
    }
  }

  function sectionAt(t) {
    const list = [...(S().markers || [])].sort((a, b) => a.time - b.time);
    let cur = null;
    for (const m of list) { if (t >= m.time - 0.05) cur = m; else break; }
    return cur;
  }

  function liveChord() {
    const midi = S().midi;
    if (!midi || !midi.active_notes || midi.active_notes.length < 3) return null;
    const c = root.ChordTimeline.detectAdvancedChord(midi.active_notes);
    return c && c !== "--" ? c : null;
  }

  /* Current/next chord for the island and Stage: chart chord at the playhead, else the live MIDI chord. */
  LW.chords = LW.chords || {};
  LW.chords.current = () => {
    const t = S().time, chart = S().chart || [];
    const TL = root.ChordTimeline;
    const cur = chart.length ? TL.playableChord(TL.chordAtTime(chart, t)) : null;
    const nxt = chart.length ? TL.nextPlayableChord(chart, t) : null;
    if (cur || nxt) {
      return {
        chord: cur ? cur.chord : "--", nashville: cur && cur.nashville && cur.nashville !== "-" ? cur.nashville : "",
        start: cur ? cur.time : null, next: nxt ? nxt.chord : "", nextAt: nxt ? nxt.time : null, fromChart: true,
      };
    }
    const live = liveChord();
    return { chord: live || "--", nashville: live ? root.ChordTimeline.getChordWithNashville(live, S().nashKey).nashville : "", next: "", nextAt: null, fromChart: false };
  };

  function updateIsland() {
    const isl = LW.isl;
    if (!isl) return;
    const s = S().song || {};
    const t = S().time, d = S().duration;
    const c = LW.chords.current();
    const sec = sectionAt(t);
    const a = S().analysis || {};
    const bits = [];
    if (sec) bits.push(sec.name);
    if (a.key || a.key_full) bits.push(`Key of ${a.key || a.key_full}`);
    if (a.bpm) bits.push(`${Math.round(a.bpm)} BPM`);
    let ring = 0;
    if (c.nextAt != null && c.start != null && c.nextAt > c.start) ring = LW.clamp((t - c.start) / (c.nextAt - c.start), 0, 1);
    else if (d > 0) ring = t / d;
    isl.update({
      title: S().hasTrack ? (s.filename || "Backing track") : "No track loaded",
      sub: bits.length ? bits.join(" · ") : (S().hasTrack ? "Ready" : "Load a song to start"),
      chord: c.chord === "--" ? (S().hasTrack ? LW.fmt(t) : "Litwave") : c.chord,
      next: c.next || "--",
      pos: S().hasTrack ? LW.fmt(t) : "",
      t0: LW.fmt(t), t1: LW.fmt(d),
      progress: d > 0 ? t / d : 0,
      ring,
      playing: Boolean(s.is_playing),
    });
  }
  LW.updateIsland = updateIsland;

  function renderHeader() {
    const s = S().song || {};
    const has = S().hasTrack;
    $("songDot").className = "dot" + (has ? (s.is_playing ? " on" : " ok") : "");
    LW.setText($("songTitle"), has ? (s.filename || "Backing track") : "No track loaded");
    LW.setText($("songSub"), has ? (s.is_playing ? "Playing" : "Ready") + (S().pitch ? ` · ${S().pitch > 0 ? "+" : ""}${S().pitch} st` : "") : "Load an audio file or pick one from the library");
    LW.setText($("tcNow"), LW.fmtMs(S().time));
    LW.setText($("tcDur"), LW.fmt(S().duration));
    $("btnBookmark").disabled = !has;
    $("btnClear").disabled = !has;
    $("btnAnalyze").disabled = !has || analyzing;
    if (!has) { $("intel").hidden = true; lastAnalysisKey = ""; }
    if (has && S().analysis) displayTrackIntelligence(S().analysis);
    if (s.filename !== lastFile) { lastFile = s.filename; LW.emit("song-changed", s.filename || null); }
    if (pitchStepper) pitchStepper.set(S().pitch || 0);
  }

  LW.song = {
    async upload(file) {
      if (!file) return;
      const fd = new FormData();
      fd.append("file", file);
      LW.setText($("songSub"), "Decoding track…");
      LW.alert({ icon: "upload", title: "Uploading", sub: file.name }, 4000);
      try {
        const data = await LW.api.upload("/api/upload", fd);
        if (data && data.success) {
          if (data.song && data.song.waveform_peaks) { S().peaks = data.song.waveform_peaks; LW.waveform.draw(true); }
          LW.alert({ icon: "check", tone: "ok", title: "Track loaded", sub: `${data.filename} saved to your library` }, 2000);
          LW.emit("library-changed");
        }
      } catch (_) {}
    },
    async clear() {
      // Everything needed to put the song back: the file (its chart, markers, analysis and lyrics live in a sidecar
      // file and come back with it) plus the playhead, speed, key shift and loop.
      const sg = S().song || {};
      const snap = S().hasTrack && sg.filename
        ? { filename: sg.filename, time: sg.current_time_seconds || 0, speed: sg.speed, pitch: sg.pitch_shift || 0, a: sg.loop_a, b: sg.loop_b, loop: !!sg.loop_enabled }
        : null;
      LW.local.mark("song");
      await LW.transport.action("clear_track");
      $("intel").hidden = true;
      lastAnalysisKey = "";
      if (!snap) { LW.alert({ icon: "close", title: "Track cleared" }, 1200); return; }
      LW.undo.push({ icon: "close", label: "Track cleared", sub: snap.filename, run: () => LW.song.restore(snap) });
    },
    async restore(snap) {
      LW.local.mark("song");
      const res = await LW.api.post("/api/playlist/select", { filename: snap.filename });
      if (res && res.success === false) throw new Error("Could not reload the track");
      if (snap.speed && snap.speed !== 1) await LW.transport.action("speed", { speed: snap.speed });
      if (snap.pitch) await LW.transport.action("pitch_shift", { semitones: snap.pitch });
      if (snap.a != null) await LW.transport.action("loop_a", { seconds: snap.a });
      if (snap.b != null) await LW.transport.action("loop_b", { seconds: snap.b });
      if (snap.loop && snap.a != null && snap.b != null) await LW.transport.action("toggle_loop");
      await LW.transport.action("seek", { seconds: snap.time });
    },
    async analyze() {
      if (analyzing) return;
      analyzing = true;
      $("btnAnalyze").disabled = true;
      LW.setText($("btnAnalyzeTxt"), "Analyzing…");
      LW.alert({ icon: "sparkle", title: "Analyzing track…", sub: "Key, tempo, chords and lyrics" }, 60000);
      try {
        const data = await LW.api.post("/api/analyze", {});
        if (data && data.success) {
          if (data.result) { lastAnalysisKey = ""; S().analysis = data.result; displayTrackIntelligence(data.result); }
          if (data.song) {
            if (Array.isArray(data.song.lyrics_sheet) && data.song.lyrics_sheet.length) S().lyrics = data.song.lyrics_sheet;
            if (Array.isArray(data.song.chord_chart) && data.song.chord_chart.length) S().chart = data.song.chord_chart;
            LW.emit("analysis", data);
          }
          const r = data.result || {};
          LW.alert({ icon: "check", tone: "ok", title: "Analysis done", sub: [r.key || r.key_full ? `Key of ${r.key || r.key_full}` : "", r.bpm ? `${Math.round(r.bpm)} BPM` : ""].filter(Boolean).join(" · ") || "Chords and lyrics updated" }, 2400);
        } else {
          LW.alert({ icon: "alert", tone: "bad", title: "Analysis failed", sub: (data && (data.error || data.message)) || "Try again" }, 2400);
        }
      } catch (_) {
        LW.alert({ icon: "alert", tone: "bad", title: "Analysis failed", sub: "The analyzer did not respond" }, 2400);
      } finally {
        analyzing = false;
        LW.setText($("btnAnalyzeTxt"), "Analyze");
        $("btnAnalyze").disabled = !S().hasTrack;
      }
    },
    syncClick() {
      const a = S().analysis || {};
      const bpm = Number(a.bpm);
      if (!(bpm > 30)) return;
      LW.api.post("/api/mixer", { metronome_bpm: bpm }).catch(() => {});
      const inp = $("bpmInput"); if (inp) inp.value = Math.round(bpm);
      LW.alert({ icon: "metro", title: "Click synced", sub: `${Math.round(bpm)} BPM` }, 1300);
    },
    setPitch(v) {
      const val = LW.clamp(Math.round(v), -12, 12);
      S().pitch = val;
      if (pitchStepper) pitchStepper.set(val);
      return LW.transport.action("pitch_shift", { semitones: val });
    },
  };

  LW.on("ready", () => {
    const input = $("songFileInput");
    const pick = () => input.click();
    $("btnLoad").addEventListener("click", pick);
    $("sbUpload").addEventListener("click", pick);
    input.addEventListener("change", () => { const f = input.files && input.files[0]; input.value = ""; LW.song.upload(f); });
    $("btnClear").addEventListener("click", () => LW.song.clear());
    $("btnAnalyze").addEventListener("click", () => LW.song.analyze());
    $("btnSyncClick").addEventListener("click", () => LW.song.syncClick());
    pitchStepper = LW.ui.stepper($("keyShift"), {
      min: -12, max: 12, value: 0, label: "key shift",
      format: (v) => (v > 0 ? "+" : "") + v + " st",
      onChange: (v) => LW.song.setPitch(v),
    });
    $("btnPitchReset").addEventListener("click", () => LW.song.setPitch(0));
    $("nashKeySelect").addEventListener("change", (e) => { S().nashKey = e.target.value; LW.emit("nash-key", e.target.value); });
  });

  LW.on("telemetry", (d) => {
    if (d.song) renderHeader();
    updateIsland();
  });
})(window);
