// Litwave remote/core — extracted verbatim from remote.html (see README section 2). Plain classic script, global scope, no modules.
    function showRemoteToast(msg, durationMs = 2500) {
      const toast = document.getElementById("remoteToastNotice");
      if (!toast) return;
      toast.innerText = msg;
      toast.style.opacity = "1";
      clearTimeout(window._rToastTimer);
      window._rToastTimer = setTimeout(() => {
        toast.style.opacity = "0";
      }, durationMs);
    }
    // State for Parts 1 to 8 (Standard clean Part 1 - 8 labeling with Reverb, Mute & Solo)
    const partsState = [
      { part: 1, name: "Part 1", val: 100, rev: 40, mute: false, solo: false },
      { part: 2, name: "Part 2", val: 100, rev: 40, mute: false, solo: false },
      { part: 3, name: "Part 3", val: 90, rev: 40, mute: false, solo: false },
      { part: 4, name: "Part 4", val: 95, rev: 40, mute: false, solo: false },
      { part: 5, name: "Part 5", val: 105, rev: 40, mute: false, solo: false },
      { part: 6, name: "Part 6", val: 85, rev: 40, mute: false, solo: false },
      { part: 7, name: "Part 7", val: 100, rev: 40, mute: false, solo: false },
      { part: 8, name: "Part 8", val: 95, rev: 40, mute: false, solo: false }
    ];

    let isPlaying = false;
    let isLooping = false;
    let currentPitch = 0;
    let currentBpm = 120;
    let metroEnabled = false;
    let tapTimes = [];
    let songDuration = 0;
    let currentPosition = 0;

    let remoteNashvilleKey = 'C';

    // ==========================================
    // PWA Installation Hook
    // ==========================================
    let g_deferredPrompt = null;
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      g_deferredPrompt = e;
      const installBtn = document.getElementById("remotePwaInstallBtn");
      if (installBtn) installBtn.style.display = "inline-flex";
    });

    async function installLitwavePwa() {
      if (!g_deferredPrompt) return;
      g_deferredPrompt.prompt();
      const choiceResult = await g_deferredPrompt.userChoice;
      if (choiceResult.outcome === "accepted") {
        const installBtn = document.getElementById("remotePwaInstallBtn");
        if (installBtn) installBtn.style.display = "none";
      }
      g_deferredPrompt = null;
    }

    // ==========================================
    // Top-Bar Quick Refresh Function
    // ==========================================
    function refreshRemotePage() {
      const icon = document.getElementById("refreshIconSvg");
      if (icon) {
        icon.style.transition = "transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)";
        icon.style.transform = "rotate(360deg)";
      }
      setTimeout(() => {
        window.location.reload();
      }, 250);
    }

    // ==========================================
    // Native Fullscreen Toggle for Mobile
    function togglePhoneFullscreen() {
      if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        const docEl = document.documentElement;
        if (docEl.requestFullscreen) {
          docEl.requestFullscreen().catch(() => {});
        } else if (docEl.webkitRequestFullscreen) {
          docEl.webkitRequestFullscreen();
        }
      } else {
        if (document.exitFullscreen) {
          document.exitFullscreen().catch(() => {});
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        }
      }
    }
    function setStagePage(pageNum) {
      g_stageCurrentPage = Math.max(1, Math.min(5, pageNum));
      const track = document.getElementById("stageCarouselTrack");
      const title = document.getElementById("stageViewPageTitle");
      const prevBtn = document.getElementById("stagePrevBtn");
      const nextBtn = document.getElementById("stageNextBtn");

      if (track) {
        track.style.transform = `translateX(-${(g_stageCurrentPage - 1) * 20}%)`;
      }
      if (title) {
        title.innerText = STAGE_PAGE_TITLES[g_stageCurrentPage] || "STAGE VIEW";
      }
      for (let i = 1; i <= 5; i++) {
        const dot = document.getElementById(`stageDot${i}`);
        if (dot) dot.style.background = (g_stageCurrentPage === i) ? "var(--accent)" : "#333";
      }
      if (prevBtn) prevBtn.style.opacity = g_stageCurrentPage === 1 ? "0.4" : "1";
      if (nextBtn) nextBtn.style.opacity = g_stageCurrentPage === 5 ? "0.4" : "1";
    }
    function nextStagePage() {
      if (g_stageCurrentPage < 5) setStagePage(g_stageCurrentPage + 1);
    }
    function prevStagePage() {
      if (g_stageCurrentPage > 1) setStagePage(g_stageCurrentPage - 1);
    }
    function toggleStageView() {
      // Standalone full-screen Stage View is now the persistent root UI
      setStagePage(1);
    }
    function formatTime(s) {
      const m = Math.floor(s / 60);
      const sec = Math.floor(s % 60);
      return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
    }

    // WebSocket Telemetry Connection
    let ws = null;
    function connectWS() {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${proto}//${window.location.host}/ws`);

      ws.onopen = () => {
        document.getElementById("connDot").classList.add("active");
        document.getElementById("connText").innerText = "Connected";
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === "fx_pad_pulse") {
            const padId = msg.pad_id;
            const el = document.getElementById(`rFxPad_${padId}`);
            const p = g_rFxPadsState.pads ? g_rFxPadsState.pads[padId] : null;
            if (el && p && msg.action === "press") {
              const padColor = FX_PAD_PALETTE[p.pad_index % FX_PAD_PALETTE.length];
              el.style.background = padColor.border;
              el.style.boxShadow = `0 0 20px ${padColor.glow}`;
              setTimeout(() => {
                if (el) {
                  el.style.background = padColor.bg;
                  el.style.boxShadow = "none";
                }
              }, 140);
            }
            return;
          }
          if (msg.type === "midi_event" && msg.data) {
            const data = msg.data;
            if (data.active_notes) {
              const chordName = detectAdvancedChord(data.active_notes);
              const nashObj = getChordWithNashville(chordName, remoteNashvilleKey);
              const sLive = document.getElementById("stageLiveChord");
              const sNash = document.getElementById("stageLiveNash");
              if (sLive && sLive.innerText !== chordName) sLive.innerText = chordName;
              if (sNash && sNash.innerText !== nashObj.nashville) sNash.innerText = nashObj.nashville;
              const noteDisplay = (data.active_note_names && data.active_note_names.length > 0) ? data.active_note_names.join(" ") : "READY";
              const noteEl = document.getElementById("remoteLastNote");
              if (noteEl && noteEl.innerText !== noteDisplay) noteEl.innerText = noteDisplay;
            }
            return;
          }
          if (msg.type !== "telemetry") return;

          const song = msg.song;
          const midi = msg.midi;

          // 1. Playback & Track Info
          if (song) {
            isPlaying = Boolean(song.is_playing);
            songDuration = song.duration_seconds || 0;
            currentPosition = song.current_time_seconds || 0;

            const slot = document.getElementById("remotePlayIconSlot");
            const txt = document.getElementById("remotePlayText");
            if (slot && txt) {
              if (isPlaying) {
                slot.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
                txt.innerText = "Pause";
              } else {
                slot.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
                txt.innerText = "Play";
              }
            }
            document.getElementById("remoteTimeText").innerText = `${formatTime(currentPosition)} / ${formatTime(songDuration)}`;

            // Update mobile chord tracker using real interval ends and silent gaps.
            const chart = song.chord_chart || [];
            const curChord = ChordTimeline.playableChord(ChordTimeline.chordAtTime(chart, currentPosition));
            const nextChord = ChordTimeline.nextPlayableChord(chart, currentPosition);
            const nextEl = document.getElementById("stageNextChord");
            const nextCd = document.getElementById("stageNextCountdown");
            if (nextChord) {
              const diff = (nextChord.time - currentPosition).toFixed(1);
              if (nextEl) nextEl.innerText = nextChord.chord;
              if (nextCd) nextCd.innerText = `in ${diff}s`;
            } else {
              if (nextEl) nextEl.innerText = "--";
              if (nextCd) nextCd.innerText = "";
            }

            // Update mobile Static Lyrics Container
            if (song.lyrics_sheet && song.lyrics_sheet.length > 0) {
              const staticL = document.getElementById("remoteStaticLyricsContainer");
              if (staticL && staticL.children.length !== song.lyrics_sheet.length) {
                staticL.innerHTML = song.lyrics_sheet.map(l => `<div>${l.text}</div>`).join("");
              }
            }

            // Track Loop State (Stable, flicker-free)
            const loopActive = Boolean(song.loop_enabled && song.loop_a !== null && song.loop_b !== null);
            if (loopActive !== isLooping) {
              isLooping = loopActive;
              const loopBtn = document.getElementById("remoteLoopBtn");
              if (loopBtn) {
                loopBtn.querySelector("#loopText").innerText = isLooping ? "Loop [On]" : "Loop [Off]";
                if (isLooping) {
                  loopBtn.classList.add("is-active-loop");
                } else {
                  loopBtn.classList.remove("is-active-loop");
                }
              }
            }

            if (song.has_track && song.filename) {
              document.getElementById("remoteSongTitle").innerText = song.filename;
            } else if (!song.has_track) {
              document.getElementById("remoteSongTitle").innerText = "No Track Loaded";
            }

            if (songDuration > 0) {
              const pct = Math.min(100, (currentPosition / songDuration) * 100);
              document.getElementById("seekFill").style.width = pct + "%";
            }

            if (song.pitch_shift !== undefined && song.pitch_shift !== currentPitch) {
              currentPitch = song.pitch_shift;
              const sign = currentPitch > 0 ? "+" : "";
              document.getElementById("remotePitchVal").innerText = `${sign}${currentPitch} st`;
            }

            if (isPlaying && song.markers) {
              checkRemoteMarkerAutoSceneTrigger(currentPosition, song.markers);
            }

            // 2. Section Markers (Pills)
            const markersSec = document.getElementById("markersSection");
            const container = document.getElementById("markersContainer");
            if (song.markers && song.markers.length > 0) {
              markersSec.style.display = "flex";
              container.innerHTML = song.markers.map(m => {
                const scNum = m.scene ? parseInt(m.scene, 10) : null;
                const sName = scNum ? (remoteSceneNames[scNum] || `Scene ${scNum}`) : '';
                const badge = scNum ? `<span style="background: rgba(56,189,248,0.2); color: #38bdf8; padding: 1px 4px; border-radius: 3px; font-size: 8px; font-weight: 700; margin-left: 4px;">S${scNum}${sName && sName !== `Scene ${scNum}` ? `: ${sName}` : ''}</span>` : '';
                return `
                  <div class="marker-pill" onclick="jumpToRemoteMarker(${m.time}, ${scNum})">
                    <span>${m.name}${badge}</span>
                    <span style="color: var(--text-faint); font-family: var(--font-mono);">${formatTime(m.time)}</span>
                  </div>
                `;
              }).join("");
            } else {
              markersSec.style.display = "none";
            }
          }

          // 3. Live MIDI Chord Recognition & Notes Display
          if (midi) {
            const activeNotes = midi.active_notes || [];
            if (song.analysis && (song.analysis.key_root || song.analysis.key)) {
              const detectedRoot = (song.analysis.key_root || song.analysis.key).replace("m", "");
              if (detectedRoot && remoteNashvilleKey !== detectedRoot) {
                remoteNashvilleKey = detectedRoot;
                const rSel = document.getElementById("remoteNashvilleKeySelect");
                if (rSel) rSel.value = detectedRoot;
              }
            }
            if (activeNotes.length > 0) {
              const chordName = detectAdvancedChord(activeNotes);
              const nashObj = getChordWithNashville(chordName, remoteNashvilleKey);
              const sLive = document.getElementById("stageLiveChord");
              const sNash = document.getElementById("stageLiveNash");
              if (sLive && sLive.innerText !== chordName) sLive.innerText = chordName;
              if (sNash && sNash.innerText !== nashObj.nashville) sNash.innerText = nashObj.nashville;
              if (midi.active_note_names && midi.active_note_names.length > 0) {
                const noteDisplay = midi.active_note_names.join(" ");
                const noteEl = document.getElementById("remoteLastNote");
                if (noteEl && noteEl.innerText !== noteDisplay) noteEl.innerText = noteDisplay;
              }
            } else {
              const sLive = document.getElementById("stageLiveChord");
              const sNash = document.getElementById("stageLiveNash");
              if (sLive && sLive.innerText !== "--") sLive.innerText = "--";
              if (sNash && sNash.innerText !== "") sNash.innerText = "";
              const noteEl = document.getElementById("remoteLastNote");
              if (noteEl && noteEl.innerText !== "READY") noteEl.innerText = "READY";
            }
          }

          // 4. Bidirectional Mixer Volume Telemetry (From Desktop / Engine to Remote)
          const audio = msg.audio;
          const montage = msg.montage;
          const engine = msg.engine;
          if (msg.fx_pads) {
            let padsLoaded = false;
            if (msg.fx_pads.pads && Object.keys(msg.fx_pads.pads).length > 0) {
              const hadNoPads = !g_rFxPadsState.pads || Object.keys(g_rFxPadsState.pads).length === 0;
              g_rFxPadsState.pads = msg.fx_pads.pads;
              if (hadNoPads) padsLoaded = true;
            }
            if (msg.fx_pads.sound_catalog) g_rFxPadsState.sound_catalog = msg.fx_pads.sound_catalog;
            if (msg.fx_pads.bus_volume !== undefined) g_rFxPadsState.bus_volume = msg.fx_pads.bus_volume;
            if (msg.fx_pads.bus_muted !== undefined) g_rFxPadsState.bus_muted = msg.fx_pads.bus_muted;
            if (msg.fx_pads.active_bank !== undefined) g_rFxPadsState.active_bank = msg.fx_pads.active_bank;
            if (msg.fx_pads.active_voices !== undefined) g_rFxPadsState.active_voices = msg.fx_pads.active_voices;
            if (msg.fx_pads.pad_indicators) g_rFxPadsState.pad_indicators = msg.fx_pads.pad_indicators;

            if (padsLoaded) {
              renderRemoteFxPads();
            }

            if (g_rFxPadsState.pad_indicators) {
              for (const pid in g_rFxPadsState.pad_indicators) {
                const el = document.getElementById(`rFxPad_${pid}`);
                const p = g_rFxPadsState.pads ? g_rFxPadsState.pads[pid] : null;
                if (el && p) {
                  const active = Boolean(g_rFxPadsState.pad_indicators[pid]);
                  const padColor = FX_PAD_PALETTE[p.pad_index % FX_PAD_PALETTE.length];
                  el.classList.toggle("r-fx-pad-triggered", active);
                  el.style.background = active ? padColor.border : padColor.bg;
                  el.style.borderColor = padColor.border;
                  el.style.boxShadow = active ? `0 0 16px ${padColor.glow}` : "none";
                }
              }
            }
          }
          if (msg.drone_pad) {
            if (performance.now() - g_lastRemoteDroneInteraction > 600) {
              const prevR = g_rDroneState.root;
              const prevA = g_rDroneState.active;
              g_rDroneState = msg.drone_pad;
              if (prevR !== g_rDroneState.root || prevA !== g_rDroneState.active) {
                syncRemoteDroneUI();
              }
            }
          }
          if (audio) {
            if (activeMixerDrag !== 'track' && audio.track_volume !== undefined) {
              const pct = (audio.track_volume / 1.0) * 100;
              const db = audio.track_volume > 0 ? (20 * Math.log10(audio.track_volume)).toFixed(1) : "-inf";
              document.getElementById("remoteTrackVolText").innerText = `${db} dB`;
              document.getElementById("sliderFill_track").style.width = pct + "%";
              document.getElementById("sliderThumb_track").style.left = pct + "%";
            }
            if (activeMixerDrag !== 'master' && audio.master_volume !== undefined) {
              const pct = (audio.master_volume / 1.2) * 100;
              const db = audio.master_volume > 0 ? (20 * Math.log10(audio.master_volume)).toFixed(1) : "-inf";
              document.getElementById("remoteMasterVolText").innerText = `${db} dB`;
              document.getElementById("sliderFill_master").style.width = pct + "%";
              document.getElementById("sliderThumb_master").style.left = pct + "%";
            }
            if (activeMixerDrag !== 'metro' && audio.metronome_volume !== undefined) {
              const mVol = audio.metronome_volume;
              const pct = (mVol / 2.0) * 100;
              const pctVal = Math.round(mVol * 100);
              document.getElementById("remoteMetroVolText").innerText = mVol > 1.0 ? `Boost ${pctVal}%` : `${pctVal}%`;
              document.getElementById("sliderFill_metro").style.width = pct + "%";
              document.getElementById("sliderThumb_metro").style.left = pct + "%";
            }
            if (activeMixerDrag !== 'fx' && activeMixerDrag !== 'top_fx' && audio.fx_pad_volume !== undefined) {
              const fxVol = audio.fx_pad_volume;
              const pct = (fxVol / 1.5) * 100;
              const db = fxVol > 0 ? (20 * Math.log10(fxVol)).toFixed(1) : "-inf";
              const textEl = document.getElementById("remoteFxVolText");
              if (textEl) textEl.innerText = `${db} dB`;
              const topTextEl = document.getElementById("remoteFxTopVolText");
              if (topTextEl) topTextEl.innerText = `${db} dB`;
              ['fx', 'top_fx'].forEach(st => {
                const fEl = document.getElementById(`sliderFill_${st}`);
                if (fEl) fEl.style.width = pct + "%";
                const thEl = document.getElementById(`sliderThumb_${st}`);
                if (thEl) thEl.style.left = pct + "%";
              });
            }
            if (audio.metronome_enabled !== undefined) {
              metroEnabled = Boolean(audio.metronome_enabled);
              const btn = document.getElementById("remoteMetroToggleBtn");
              const txt = document.getElementById("remoteMetroStatusText");
              if (btn && txt) {
                btn.classList.toggle("btn-active", metroEnabled);
                txt.innerText = metroEnabled ? "Click [On]" : "Click [Off]";
              }
            }
            if (audio.metronome_bpm !== undefined && audio.metronome_bpm !== currentBpm) {
              currentBpm = audio.metronome_bpm;
              document.getElementById("remoteBpmText").innerText = `${Math.round(currentBpm)} BPM`;
            }
            if (audio.metronome_profile !== undefined) {
              const pSel = document.getElementById("remoteMetroSoundSelect");
              if (pSel && pSel.value !== audio.metronome_profile) {
                pSel.value = audio.metronome_profile;
              }
            }
          }
          if (montage) {
            if (montage.engine_type && montage.engine_type !== remoteActiveEngine) {
              remoteActiveEngine = montage.engine_type;
              renderParts();
            }
            const isEngRunning = Boolean(montage.is_running || (engine && engine.reachable));
            window.g_remoteEngineRunning = isEngRunning;
            updateRemoteEngineModalUI();
            const vstBadge = document.getElementById("remoteVstCycleText");
            if (vstBadge) {
              vstBadge.innerHTML = isEngRunning ? `<span style="color: var(--success, #4ade80);">● ${remoteActiveEngine === 'yamaha' ? 'MONTAGE' : 'Community'}</span>` : `VST`;
            }
            if (montage.part_names) {
              for (let p = 1; p <= 8; p++) {
                if (montage.part_names[p]) partsState[p - 1].name = montage.part_names[p];
              }
            }
            let remoteNamesChanged = false;
            if (montage.scene_names) {
              const oldNamesStr = JSON.stringify(remoteSceneNames);
              remoteSceneNames = { ...remoteSceneNames, ...montage.scene_names };
              if (oldNamesStr !== JSON.stringify(remoteSceneNames)) {
                remoteNamesChanged = true;
              }
            }
            if (montage.current_scene !== undefined && (montage.current_scene !== remoteActiveScene || remoteNamesChanged)) {
              remoteActiveScene = montage.current_scene;
              const sName = remoteSceneNames[remoteActiveScene] || `Scene ${remoteActiveScene}`;
              const sText = document.getElementById("stageActiveSceneText");
              if (sText) sText.innerText = sName;
              for (let s = 1; s <= 8; s++) {
                const sb = document.getElementById(`stageSceneBtn_${s}`);
                if (sb) sb.classList.toggle("is-active-loop", s === remoteActiveScene);
              }
              renderRemoteScenes();
            }
            if (remoteNamesChanged) {
              renderRemoteScenes();
            }
            if (montage.master_volume !== undefined) {
              if (activeMixerDrag !== 'synth') {
                const norm = montage.master_volume / 127.0;
                const pct = norm * 100;
                const db = norm > 0 ? (20 * Math.log10(norm)).toFixed(1) : "-inf";
                document.getElementById("remoteSynthVolText").innerText = `${db} dB`;
                document.getElementById("sliderFill_synth").style.width = pct + "%";
                document.getElementById("sliderThumb_synth").style.left = pct + "%";
              }
            }
            if (montage.part_volumes) {
              for (let p = 1; p <= 8; p++) {
                if (montage.part_volumes[p] !== undefined && g_activePartFaderDrag !== p) {
                  const val = montage.part_volumes[p];
                  partsState[p - 1].val = val;
                  const pct = ((val / 127) * 100).toFixed(1);
                  const fill = document.getElementById(`sliderFill_${p}`);
                  const thumb = document.getElementById(`sliderThumb_${p}`);
                  const text = document.getElementById(`partValText_${p}`);
                  if (fill) fill.style.width = pct + "%";
                  if (thumb) thumb.style.left = pct + "%";
                  if (text) text.innerText = `Vol: ${val}`;
                }
              }
            }
            if (montage.part_reverbs) {
              for (let p = 1; p <= 8; p++) {
                if (montage.part_reverbs[p] !== undefined) {
                  const rVal = montage.part_reverbs[p];
                  partsState[p - 1].rev = rVal;
                  const pct = ((rVal / 127) * 100).toFixed(1);
                  const fill = document.getElementById(`reverbFill_${p}`);
                  const thumb = document.getElementById(`reverbThumb_${p}`);
                  const text = document.getElementById(`partRevText_${p}`);
                  if (fill) fill.style.width = pct + "%";
                  if (thumb) thumb.style.left = pct + "%";
                  if (text) text.innerText = `Rev: ${rVal}`;
                }
              }
            }
            if (montage.part_mutes) {
              for (let p = 1; p <= 8; p++) {
                if (montage.part_mutes[p] !== undefined) {
                  partsState[p - 1].mute = Boolean(montage.part_mutes[p]);
                }
              }
            }
            if (montage.part_solos) {
              for (let p = 1; p <= 8; p++) {
                if (montage.part_solos[p] !== undefined) {
                  partsState[p - 1].solo = Boolean(montage.part_solos[p]);
                }
              }
            }
          }
        } catch (e) {
          console.error("Telemetry error:", e);
        }
      };

      ws.onclose = () => {
        document.getElementById("connDot").classList.remove("active");
        document.getElementById("connText").innerText = "Disconnected";
        setTimeout(connectWS, 2000);
      };
    }
