// Litwave desktop/core — extracted verbatim from index.html (see README section 2). Plain classic script, global scope, no modules.
    function showAppToast(msg, durationMs = 2500) {
      const toast = document.getElementById("appToastNotice");
      if (!toast) return;
      toast.innerText = msg;
      toast.style.opacity = "1";
      clearTimeout(window._toastTimer);
      window._toastTimer = setTimeout(() => {
        toast.style.opacity = "0";
      }, durationMs);
    }
    let ws = null;
    let waveformPeaks = [];
    const START_KEY = 21;
    const END_KEY = 108;
    let currentTrackPitch = 0;
    let cachedMarkers = [];
    let currentSongDuration = 0;
    let hasLoadedTrack = false;

    // Real-time Master DSP & Monitoring state
    let nativeEngineData = null;
    let lastKnownAudioTelemetry = {};
    let masterSpectrumBins = [];
    let analyzerEnabled = true;
    let stageWarmthSettings = { enabled: true, drive: 1.2, mode: 0 };
    let lastStatusUiUpdate = 0;

    // Fader values
    let valTrack = 0.8;
    let valSynth = 1.0;
    let valFx = 0.85;
    let valMaster = 1.0;

    function toggleAccordion(id) {
      const panel = document.getElementById(id);
      panel.classList.toggle("is-minimized");
      const btn = id === "pitchDeck" 
        ? document.getElementById("pitchCollapseBtn") 
        : (id === "mixerDeck" ? document.getElementById("mixerCollapseBtn") : document.getElementById("othersCollapseBtn"));
      if (btn) {
        const isMin = panel.classList.contains("is-minimized");
        btn.innerHTML = isMin 
          ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>'
          : '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
      }
      if (id === "mixerDeck") {
        const isMin = panel.classList.contains("is-minimized");
        fetch("/api/master/dsp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ analyzer_visible: !isMin && analyzerEnabled })
        }).catch(() => {});
        if (!isMin) setTimeout(drawEqSpline, 50);
      }
    }

    // Tap Tempo State
    function toggleEnginePopover(e) {
      if (e) e.stopPropagation();
      const pop = document.getElementById("enginePopover");
      if (!pop) return;
      const isShown = pop.style.display === "flex";
      pop.style.display = isShown ? "none" : "flex";
      if (!isShown) updateEngineStatusUi(true);
    }

    // Header Tools Hamburger Menu Handlers
    function toggleHeaderMenu(e) {
      if (e) e.stopPropagation();
      const menu = document.getElementById("headerMenuDropdown");
      const btn = document.getElementById("headerMenuBtn");
      if (!menu) return;
      const isOpen = menu.classList.toggle("is-open");
      if (btn) btn.classList.toggle("btn-active", isOpen);
    }
    function closeHeaderMenu() {
      const menu = document.getElementById("headerMenuDropdown");
      const btn = document.getElementById("headerMenuBtn");
      if (menu) menu.classList.remove("is-open");
      if (btn) btn.classList.remove("btn-active");
    }
    async function triggerMidiPanic() {
      const btn = document.getElementById("panicBtn");
      if (btn) {
        btn.classList.add("btn-active");
        setTimeout(() => btn.classList.remove("btn-active"), 400);
      }
      activeNotes = [];
      const currentActives = document.querySelectorAll(".piano-key.active, .piano-white-key.active, .piano-black-key.active");
      currentActives.forEach(el => el.classList.remove("active"));
      try {
        const res = await fetch("/api/midi/panic", { method: "POST" });
        const data = await res.json();
        showAppToast(`Panic sent: All notes off & controllers reset (${data.released_notes || 0} notes)`);
      } catch (e) {
        showAppToast("Panic request failed");
      }
    }
    let tapTimes = [];
    function handleTapTempo() {
      const now = performance.now();
      tapTimes.push(now);
      if (tapTimes.length > 4) tapTimes.shift();

      if (tapTimes.length >= 2) {
        let intervals = [];
        for (let i = 1; i < tapTimes.length; i++) {
          intervals.push(tapTimes[i] - tapTimes[i - 1]);
        }
        if (intervals[intervals.length - 1] > 2000) {
          tapTimes = [now];
          return;
        }
        const avgInterval = intervals.reduce((a, b) => a + b) / intervals.length;
        const bpm = Math.round(60000 / avgInterval);
        if (bpm >= 40 && bpm <= 280) {
          document.getElementById("bpmInput").value = bpm;
          updateMixer("metronome_bpm", bpm);
        }
      }
    }
    function handleTimeSigChange(val) {
      updateMixer("metronome_time_sig", parseInt(val));
    }
    function handleMetroSoundChange(val) {
      updateMixer("metronome_profile", val);
    }

    // Chord Progression Recording State
    let isRecordingChords = false;
    let activeChordChart = [];

    function toggleRecordChords() {
      isRecordingChords = !isRecordingChords;
      const btn = document.getElementById("recordChordsBtn");
      const dot = document.getElementById("recDot");
      if (btn && dot) {
        btn.classList.toggle("btn-active", isRecordingChords);
        dot.style.background = isRecordingChords ? "var(--success)" : "var(--danger)";
        btn.querySelector("span:last-child").innerText = isRecordingChords ? "Recording Chords..." : "Learn Chords";
      }
    }
    function updateNextChordHUD(currentSeconds) {
      const hud = document.getElementById("nextChordAttention");
      const nameEl = document.getElementById("nextChordName");
      const cdEl = document.getElementById("nextChordCountdown");
      if (!hud || !nameEl || !cdEl) return;

      if (!activeChordChart || activeChordChart.length === 0) {
        hud.style.display = "none";
        return;
      }

      // Find the upcoming playable chord within 0.3s to 8s
      const nextChord = activeChordChart.find(c => c.time > (currentSeconds + 0.3) && c.time <= (currentSeconds + 8.0) && ChordTimeline.playableChord(c));
      if (nextChord) {
        hud.style.display = "inline-flex";
        const diff = (nextChord.time - currentSeconds).toFixed(1);
        nameEl.innerText = `${nextChord.chord}`;
        cdEl.innerText = `in ${diff}s`;
      } else {
        hud.style.display = "none";
      }
    }

    // Modal Handlers
    function openSettingsModal() {
      document.getElementById("preferencesModal").style.display = "flex";
      loadDevices();
    }
    function closeSettingsModal() { document.getElementById("preferencesModal").style.display = "none"; }
    function connectWS() {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

      ws.onmessage = (evt) => {
        const msg = JSON.parse(evt.data);
        if (msg.type === "fx_pad_pulse") {
          const padId = msg.pad_id;
          const padEl = document.getElementById(`dtFxPad_${padId}`);
          const p = g_fxPadsState.pads ? g_fxPadsState.pads[padId] : null;
          if (padEl && p && msg.action === "press") {
            const padColor = FX_PAD_PALETTE[p.pad_index % FX_PAD_PALETTE.length];
            padEl.style.background = padColor.border;
            padEl.style.boxShadow = `0 0 20px ${padColor.glow}`;
            setTimeout(() => {
              if (padEl) {
                padEl.style.background = padColor.bg;
                padEl.style.boxShadow = "none";
              }
            }, 140);
          }
          return;
        }
        if (msg.type === "telemetry") renderTelemetry(msg);
        else if (msg.type === "midi_event") handleLiveMidiEvent(msg.data);
      };

      ws.onclose = () => setTimeout(connectWS, 1500);
    }
    let lastSpectrumDraw = 0;
    let lastRecordedChord = "";
    let lastRecordedChordTime = 0;
    function renderTelemetry(data) {
      if (data.audio) lastKnownAudioTelemetry = data.audio;
      const audio = data.audio || lastKnownAudioTelemetry;
      const song = data.song;
      const midi = data.midi;
      const montage = data.montage;

      if (data.engine) {
        nativeEngineData = data.engine;
        if (data.engine.analyzer_enabled !== undefined) {
          analyzerEnabled = Boolean(data.engine.analyzer_enabled);
          const btn = document.getElementById("analyzerToggleBtn");
          if (btn) btn.classList.toggle("btn-active", analyzerEnabled);
        }
        if (data.engine.warmth && (performance.now() - lastWarmthUserInteraction > 1200)) {
          stageWarmthSettings.enabled = Boolean(data.engine.warmth.enabled);
          stageWarmthSettings.drive = Number(data.engine.warmth.drive);
          stageWarmthSettings.mode = Number(data.engine.warmth.mode);
          applyWarmthDomState();
        }
      }
      if (data.fx_pads) {
        let padsLoaded = false;
        if (data.fx_pads.pads && Object.keys(data.fx_pads.pads).length > 0) {
          const hadNoPads = !g_fxPadsState.pads || Object.keys(g_fxPadsState.pads).length === 0;
          g_fxPadsState.pads = data.fx_pads.pads;
          if (hadNoPads) padsLoaded = true;
        }
        if (data.fx_pads.sound_catalog) {
          g_fxPadsState.sound_catalog = data.fx_pads.sound_catalog;
        }
        if (data.fx_pads.bus_volume !== undefined) g_fxPadsState.bus_volume = data.fx_pads.bus_volume;
        if (data.fx_pads.bus_muted !== undefined) g_fxPadsState.bus_muted = data.fx_pads.bus_muted;
        if (data.fx_pads.active_bank !== undefined) g_fxPadsState.active_bank = data.fx_pads.active_bank;
        if (data.fx_pads.active_voices !== undefined) g_fxPadsState.active_voices = data.fx_pads.active_voices;
        if (data.fx_pads.pad_indicators) g_fxPadsState.pad_indicators = data.fx_pads.pad_indicators;

        if (padsLoaded) {
          renderDesktopFxPads();
        }

        if (g_fxPadsState.pad_indicators) {
          for (const pid in g_fxPadsState.pad_indicators) {
            const el = document.getElementById(`dtFxPad_${pid}`);
            const p = g_fxPadsState.pads ? g_fxPadsState.pads[pid] : null;
            if (el && p) {
              const active = Boolean(g_fxPadsState.pad_indicators[pid]);
              const padColor = FX_PAD_PALETTE[p.pad_index % FX_PAD_PALETTE.length];
              el.classList.toggle("is-playing", active);
              el.style.background = active ? padColor.border : padColor.bg;
              el.style.borderColor = padColor.border;
              el.style.boxShadow = active ? `0 0 16px ${padColor.glow}` : "none";
            }
          }
        }
      }
      if (data.drone_pad) {
        // Prevent incoming 25fps WebSocket telemetry from clobbering optimistic UI click during user interaction
        if (performance.now() - g_lastDroneUserInteraction > 600) {
          const prevRoot = g_dronePadState.root;
          const prevActive = g_dronePadState.active;
          g_dronePadState = data.drone_pad;
          if (prevRoot !== g_dronePadState.root || prevActive !== g_dronePadState.active) {
            syncDroneModalUi();
          }
        }
      }
      updateEngineStatusUi();

      if (data.spectrum && Array.isArray(data.spectrum)) {
        masterSpectrumBins = data.spectrum;
        const now = performance.now();
        const mixerMin = document.getElementById("mixerDeck")?.classList.contains("is-minimized");
        if (analyzerEnabled && !mixerMin && (now - lastSpectrumDraw > 90)) {
          lastSpectrumDraw = now;
          requestAnimationFrame(drawEqSpline);
        }
      }

      // When server sends periodic hotplug device list, update open preference dropdowns dynamically
      if (data.devices) {
        const prefModal = document.getElementById("preferencesModal");
        if (prefModal && prefModal.style.display !== "none") {
          loadDevices(data);
        }
      }

      // Remote bidirectional synchronization for volumes (when not locally dragging)
      if (!draggingFader && audio) {
        if (audio.track_volume !== undefined && Math.abs(audio.track_volume - valTrack) > 0.02) {
          valTrack = audio.track_volume;
          const db = valTrack > 0 ? (20 * Math.log10(valTrack)).toFixed(1) : "-inf";
          document.getElementById("trackVolText").innerText = `${db} dB`;
          renderCustomFaders();
        }
        if (audio.master_volume !== undefined && Math.abs(audio.master_volume - valMaster) > 0.02) {
          valMaster = audio.master_volume;
          const db = valMaster > 0 ? (20 * Math.log10(valMaster)).toFixed(1) : "-inf";
          document.getElementById("masterVolText").innerText = `${db} dB`;
          renderCustomFaders();
        }
        if (audio.fx_pad_volume !== undefined && Math.abs(audio.fx_pad_volume - valFx) > 0.02) {
          valFx = audio.fx_pad_volume;
          const db = valFx > 0 ? (20 * Math.log10(valFx)).toFixed(1) : "-inf";
          const el = document.getElementById("fxPadVolText");
          if (el) el.innerText = `${db} dB`;
          const elTop = document.getElementById("desktopFxBusVolText");
          if (elTop) elTop.innerText = `${db} dB`;
          const pct = (valFx / 1.5) * 100;
          const fTop = document.getElementById("dtFxTopVolFill");
          const thTop = document.getElementById("dtFxTopVolThumb");
          if (fTop) fTop.style.width = `${pct}%`;
          if (thTop) thTop.style.left = `${pct}%`;
          renderCustomFaders();
        }
        if (montage && montage.master_volume !== undefined) {
          const normSynth = montage.master_volume / 127.0;
          if (Math.abs(normSynth - valSynth) > 0.02) {
            valSynth = normSynth;
            const db = valSynth > 0 ? (20 * Math.log10(valSynth)).toFixed(1) : "-inf";
            document.getElementById("synthVolText").innerText = `${db} dB`;
            renderCustomFaders();
          }
        }
        if (audio.metronome_volume !== undefined) {
          const mRange = document.getElementById("metroVolRange");
          if (mRange && Math.abs(parseFloat(mRange.value) - audio.metronome_volume) > 0.04) {
            mRange.value = audio.metronome_volume;
            const pct = Math.round(audio.metronome_volume * 100);
            document.getElementById("metroVolText").innerText = audio.metronome_volume > 1.0 ? `Boost ${pct}%` : `${pct}%`;
            const fillPct = (audio.metronome_volume / 2.0) * 100;
            const fill = document.getElementById("metroVolFill");
            const thumb = document.getElementById("metroVolThumb");
            if (fill) fill.style.width = `${fillPct}%`;
            if (thumb) thumb.style.left = `${fillPct}%`;
          }
        }
        if (audio.metronome_enabled !== undefined) {
          const mBtn = document.getElementById("metroBtn");
          if (mBtn) {
            const isEn = Boolean(audio.metronome_enabled);
            mBtn.innerText = isEn ? "Click [On]" : "Click [Off]";
            mBtn.classList.toggle("btn-active", isEn);
          }
        }
        if (audio.metronome_bpm !== undefined) {
          const bpmInp = document.getElementById("bpmInput");
          if (bpmInp && document.activeElement !== bpmInp && Math.abs(parseFloat(bpmInp.value) - audio.metronome_bpm) >= 1) {
            bpmInp.value = Math.round(audio.metronome_bpm);
          }
        }
        if (audio.metronome_time_sig !== undefined) {
          const sigSel = document.getElementById("timeSigSelect");
          if (sigSel && parseInt(sigSel.value) !== audio.metronome_time_sig) {
            sigSel.value = audio.metronome_time_sig;
          }
        }
        if (audio.metronome_profile !== undefined) {
          const profSel = document.getElementById("metroSoundSelect");
          if (profSel && profSel.value !== audio.metronome_profile) {
            profSel.value = audio.metronome_profile;
          }
        }
      }

      if (montage) {
        let sceneNamesChanged = false;
        if (montage.scene_names) {
          const oldNamesStr = JSON.stringify(desktopSceneNames);
          desktopSceneNames = { ...desktopSceneNames, ...montage.scene_names };
          if (oldNamesStr !== JSON.stringify(desktopSceneNames)) {
            sceneNamesChanged = true;
          }
        }
        if (montage.current_scene !== undefined && (montage.current_scene !== activeScene || sceneNamesChanged)) {
          activeScene = montage.current_scene;
          const sName = desktopSceneNames[activeScene] || `Scene ${activeScene}`;
          const activeTextEl = document.getElementById("activeSceneText");
          if (activeTextEl) activeTextEl.innerText = sName;
          for (let s = 1; s <= 8; s++) {
            const b = document.getElementById(`sceneBtn_${s}`);
            if (b) b.classList.toggle("btn-active", s === activeScene);
          }
          renderScenesUI();
        }
        if (sceneNamesChanged) {
          renderScenesUI();
          if (cachedMarkers && cachedMarkers.length > 0) {
            renderMarkersUI(cachedMarkers, currentSongDuration);
          }
        }
        if (montage.part_names) {
          for (let p = 1; p <= 8; p++) {
            if (montage.part_names[p]) desktopPartsState[p - 1].name = montage.part_names[p];
          }
        }
        if (montage.part_pans) {
          for (let p = 1; p <= 8; p++) {
            if (montage.part_pans[p] !== undefined) desktopPartsState[p - 1].pan = montage.part_pans[p];
          }
        }
        if (montage.part_cutoffs) {
          for (let p = 1; p <= 8; p++) {
            if (montage.part_cutoffs[p] !== undefined) desktopPartsState[p - 1].cutoff = montage.part_cutoffs[p];
          }
        }
        if (montage.part_resonances) {
          for (let p = 1; p <= 8; p++) {
            if (montage.part_resonances[p] !== undefined) desktopPartsState[p - 1].resonance = montage.part_resonances[p];
          }
        }
        if (montage.part_attacks) {
          for (let p = 1; p <= 8; p++) {
            if (montage.part_attacks[p] !== undefined) desktopPartsState[p - 1].attack = montage.part_attacks[p];
          }
        }
        if (montage.part_releases) {
          for (let p = 1; p <= 8; p++) {
            if (montage.part_releases[p] !== undefined) desktopPartsState[p - 1].release = montage.part_releases[p];
          }
        }
        if (montage.part_chorus) {
          for (let p = 1; p <= 8; p++) {
            if (montage.part_chorus[p] !== undefined) desktopPartsState[p - 1].chorus = montage.part_chorus[p];
          }
        }
        if (montage.part_volumes) {
          for (let p = 1; p <= 8; p++) {
            if (montage.part_volumes[p] !== undefined && g_activeDtPartDrag !== `vol_${p}`) {
              const val = montage.part_volumes[p];
              desktopPartsState[p - 1].val = val;
              const t = document.getElementById(`dtPartVal_${p}`);
              if (t) t.innerText = `Volume: ${val}`;
              const pct = ((val / 127) * 100).toFixed(1);
              const fill = document.getElementById(`dtVolFill_${p}`);
              const thumb = document.getElementById(`dtVolThumb_${p}`);
              if (fill) fill.style.width = `${pct}%`;
              if (thumb) thumb.style.left = `${pct}%`;
            }
          }
        }
        if (montage.part_reverbs) {
          for (let p = 1; p <= 8; p++) {
            if (montage.part_reverbs[p] !== undefined) {
              const rVal = montage.part_reverbs[p];
              desktopPartsState[p - 1].rev = rVal;
              const t = document.getElementById(`dtPartRev_${p}`);
              if (t) t.innerText = `Reverb: ${rVal}`;
              const pct = ((rVal / 127) * 100).toFixed(1);
              const fill = document.getElementById(`dtRevFill_${p}`);
              const thumb = document.getElementById(`dtRevThumb_${p}`);
              if (fill) fill.style.width = `${pct}%`;
              if (thumb) thumb.style.left = `${pct}%`;
            }
          }
        }
        if (montage.part_mutes) {
          for (let p = 1; p <= 8; p++) {
            if (montage.part_mutes[p] !== undefined) {
              desktopPartsState[p - 1].mute = Boolean(montage.part_mutes[p]);
            }
          }
        }
        if (montage.part_solos) {
          for (let p = 1; p <= 8; p++) {
            if (montage.part_solos[p] !== undefined) {
              desktopPartsState[p - 1].solo = Boolean(montage.part_solos[p]);
            }
          }
        }
      }

      // VU meters
      const dbToPercent = (db) => Math.max(0, Math.min(100, ((db + 55) / 55) * 100));
      const trkDb = audio.vu_track !== undefined ? audio.vu_track : -60.0;
      const synDb = audio.vu_synth !== undefined ? audio.vu_synth : -60.0;
      const fxDb = audio.vu_fx !== undefined ? audio.vu_fx : -60.0;
      const mstLDb = audio.vu_master_l !== undefined ? audio.vu_master_l : -60.0;
      const mstRDb = audio.vu_master_r !== undefined ? audio.vu_master_r : -60.0;

      document.getElementById("vuTrack").style.height = `${dbToPercent(trkDb)}%`;
      document.getElementById("vuSynth").style.height = `${dbToPercent(synDb)}%`;
      const vuFx = document.getElementById("vuFxPad");
      if (vuFx) vuFx.style.height = `${dbToPercent(fxDb)}%`;
      document.getElementById("vuMasterL").style.height = `${dbToPercent(mstLDb)}%`;
      document.getElementById("vuMasterR").style.height = `${dbToPercent(mstRDb)}%`;

      // Song / Transport
      if (song && song.has_track) {
        hasLoadedTrack = true;
        document.getElementById("addBookmarkBtn").disabled = false;
        document.getElementById("songStatusDot").className = "status-dot active";
        document.getElementById("songFilename").innerText = song.filename || "";
        document.getElementById("songEmptyState").style.display = "none";
        document.getElementById("clearTrackBtn").style.display = "inline-flex";
        document.getElementById("analyzeTrackBtn").style.display = "inline-flex";
        if (song.analysis) {
          displayTrackIntelligence(song.analysis);
        }

        const curSec = song.current_time_seconds || 0;
        const durSec = song.duration_seconds || 0;
        currentSongDuration = durSec;
        document.getElementById("timecodeDisplay").innerText = `${formatTime(curSec)} / ${formatTime(durSec)}`;
        
        if (song.chord_chart) {
          activeChordChart = song.chord_chart;
        }
        if (song.lyrics_sheet && song.lyrics_sheet.length > 0) {
          if (activeLyricsSheet.length !== song.lyrics_sheet.length || !document.getElementById("lyricLine_0")) {
            renderLyricsSheet(song.lyrics_sheet);
          }
        } else if (activeLyricsSheet.length > 0) {
          renderLyricsSheet([]);
        }
        updateNextChordHUD(curSec);
        updateSongChordTracker(curSec);
        updateLyricsHighlight(curSec);
        
        if (durSec > 0) {
          const ratio = curSec / durSec;
          document.getElementById("playheadLine").style.left = `${ratio * 100}%`;
        }

        const loopOverlay = document.getElementById("loopOverlay");
        if (song.loop_enabled && song.loop_a !== null && song.loop_b !== null && durSec > 0) {
          const leftPct = (song.loop_a / durSec) * 100;
          const widthPct = ((song.loop_b - song.loop_a) / durSec) * 100;
          loopOverlay.style.display = "block";
          loopOverlay.style.left = `${leftPct}%`;
          loopOverlay.style.width = `${widthPct}%`;
          document.getElementById("loopToggleBtn").className = "btn btn-active";
          document.getElementById("loopToggleBtn").innerText = "Loop [On]";
        } else {
          loopOverlay.style.display = "none";
          document.getElementById("loopToggleBtn").className = "btn";
          document.getElementById("loopToggleBtn").innerText = "Loop [Off]";
        }

        const playBtn = document.getElementById("playBtn");
        if (song.is_playing) {
          playBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Pause`;
        } else {
          playBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg> Play`;
        }

        if (song.waveform_peaks && song.waveform_peaks.length > 0 && waveformPeaks.length === 0) {
          waveformPeaks = song.waveform_peaks;
          drawWaveform();
        }

        if (song.pitch_shift !== undefined && song.pitch_shift !== currentTrackPitch) {
          currentTrackPitch = song.pitch_shift;
          updatePitchUI();
        }

        // Render Section Markers
        if (song.markers && JSON.stringify(song.markers) !== JSON.stringify(cachedMarkers)) {
          cachedMarkers = song.markers;
          renderMarkersUI(song.markers, durSec);
        }
        // Auto-Trigger Scene assigned to section bookmark during playback
        if (song.is_playing) {
          checkMarkerAutoSceneTrigger(curSec, song.markers);
        }
      } else {
        hasLoadedTrack = false;
        currentSongDuration = 0;
        document.getElementById("addBookmarkBtn").disabled = true;
        document.getElementById("songStatusDot").className = "status-dot";
        document.getElementById("songFilename").innerText = "";
        document.getElementById("songEmptyState").style.display = "flex";
        document.getElementById("clearTrackBtn").style.display = "none";
        document.getElementById("timecodeDisplay").innerText = "00:00.00 / 00:00.00";
        document.getElementById("playheadLine").style.left = "0%";
        document.getElementById("loopOverlay").style.display = "none";
        document.getElementById("markerFlagsOverlay").innerHTML = "";
        document.getElementById("markersRibbon").innerHTML = '<span style="font-size: 9px; font-weight: 600; text-transform: uppercase; color: var(--text-faint);">Sections:</span><span id="noMarkersText" style="font-size: 10px; color: var(--text-faint);">Upload a backing track to add section bookmarks</span>';
        waveformPeaks = [];
        cachedMarkers = [];
        const canvas = document.getElementById("waveformCanvas");
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }

      // MIDI telemetry
      if (midi) {
        const p = midi.pedals;
        const isSustain = p.sustain >= 64;
        document.getElementById("sustainVal").className = `pedal-indicator ${isSustain ? "on" : ""}`;
        document.getElementById("sustainBar").style.width = `${(p.sustain / 127) * 100}%`;

        const exprPct = Math.round((p.expression / 127) * 100);
        document.getElementById("expressionVal").innerText = `${exprPct}%`;
        document.getElementById("expressionBar").style.width = `${exprPct}%`;

        const isSoft = p.soft >= 64;
        document.getElementById("softVal").className = `pedal-indicator ${isSoft ? "on" : ""}`;
        document.getElementById("softBar").style.width = `${(p.soft / 127) * 100}%`;

        const volPct = Math.round((p.volume / 127) * 100);
        document.getElementById("volumeVal").innerText = `${volPct}%`;
        document.getElementById("volPedalBar").style.width = `${volPct}%`;

        if (midi.active_notes && midi.active_notes.length > 0) {
          document.getElementById("lastNoteDisplay").innerText = `NOTE ${midi.active_note_names[midi.active_note_names.length - 1]}`;
        }
        const activeNotes = midi.active_notes || [];
        const container = document.getElementById("pianoWrapper");
        if (container) {
          const currentActives = container.querySelectorAll(".active");
          currentActives.forEach(el => el.classList.remove("active"));
          activeNotes.forEach(note => {
            const el = document.getElementById(`key-${note}`);
            if (el) el.classList.add("active");
          });
        }

        if (midi.active_note_names && midi.active_note_names.length > 0) {
          document.getElementById("chordNotesDisplay").innerText = midi.active_note_names.join(" ");
          const cName = detectAdvancedChord(midi.active_notes);
          const nashObj = getChordWithNashville(cName, userNashvilleKey);
          document.getElementById("chordNameDisplay").innerText = cName;
          document.getElementById("chordNashvilleDisplay").innerText = nashObj.nashville;

          if (isRecordingChords && cName && cName !== "--" && !cName.includes("Poly")) {
            const nowTime = currentSongDuration > 0 ? (song ? (song.current_time_seconds || 0) : 0) : 0;
            if (cName !== lastRecordedChord || (nowTime - lastRecordedChordTime) > 1.5) {
              lastRecordedChord = cName;
              lastRecordedChordTime = nowTime;
              transportAction("record_chord", { chord: cName, nashville: nashObj.nashville, time: nowTime });
            }
          }
        } else {
          document.getElementById("chordNameDisplay").innerText = "--";
          document.getElementById("chordNashvilleDisplay").innerText = "";
          document.getElementById("chordNotesDisplay").innerText = "READY";
        }
      }
    }
    function formatTime(sec) {
      const m = Math.floor(sec / 60);
      const s = Math.floor(sec % 60);
      const ms = Math.floor((sec % 1) * 100);
      return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
    }
