// Litwave desktop/transport — extracted verbatim from index.html (see README section 2). Plain classic script, global scope, no modules.
    // Draggable Marker State
    let draggingMarkerId = null;

    function startMarkerDrag(id, e) {
      draggingMarkerId = id;
      e.stopPropagation();
      e.preventDefault();
    }
    function openMarkerModal() {
      if (!hasLoadedTrack) return;
      document.getElementById("customMarkerNameInput").value = `Section ${cachedMarkers.length + 1}`;
      const sel = document.getElementById("customMarkerSceneSelect");
      if (sel) {
        sel.innerHTML = '<option value="">None (Keep current scene)</option>';
        for (let s = 1; s <= 8; s++) {
          const sName = desktopSceneNames[s] || `Scene ${s}`;
          sel.innerHTML += `<option value="${s}">${sName !== `Scene ${s}` ? `Scene ${s} (${sName})` : sName}</option>`;
        }
      }
      document.getElementById("bookmarkModal").style.display = "flex";
      setTimeout(() => document.getElementById("customMarkerNameInput").focus(), 50);
    }
    function closeMarkerModal() {
      document.getElementById("bookmarkModal").style.display = "none";
    }
    async function confirmAddMarker() {
      const name = document.getElementById("customMarkerNameInput").value.trim() || `Section ${cachedMarkers.length + 1}`;
      const sceneVal = document.getElementById("customMarkerSceneSelect").value;
      const scene = sceneVal ? parseInt(sceneVal) : null;
      closeMarkerModal();
      await transportAction("add_marker", { name, scene });
    }
    async function seekToSongTime(sec) {
      await transportAction("seek", { position: sec });
    }

    let lastTriggeredMarkerId = null;
    let lastMarkerCheckTime = -1;

    function checkMarkerAutoSceneTrigger(curSec, markers) {
      if (!markers || markers.length === 0) return;

      // If user rewound, seeked backwards, or looped, reset last triggered state
      if (curSec < lastMarkerCheckTime - 0.5) {
        lastTriggeredMarkerId = null;
      }
      lastMarkerCheckTime = curSec;

      const sorted = [...markers].sort((a, b) => a.time - b.time);
      let activeM = null;
      for (let i = 0; i < sorted.length; i++) {
        if (curSec >= sorted[i].time - 0.05) {
          activeM = sorted[i];
        } else {
          break;
        }
      }

      if (activeM && activeM.scene) {
        const scNum = parseInt(activeM.scene, 10);
        if (scNum >= 1 && scNum <= 8 && activeM.id !== lastTriggeredMarkerId) {
          lastTriggeredMarkerId = activeM.id;
          selectScene(scNum);
        }
      }
    }
    function renderMarkersUI(markers, duration) {
      const ribbon = document.getElementById("markersRibbon");
      const overlay = document.getElementById("markerFlagsOverlay");
      ribbon.innerHTML = '<span style="font-size: 9px; font-weight: 600; text-transform: uppercase; color: var(--text-faint);">Sections:</span>';
      overlay.innerHTML = "";

      if (!markers || markers.length === 0) {
        ribbon.innerHTML += '<span id="noMarkersText" style="font-size: 10px; color: var(--text-faint);">Click "+ Bookmark" to mark sections</span>';
        return;
      }

      markers.forEach((m, idx) => {
        const pill = document.createElement("div");
        pill.className = "marker-pill";
        const scNum = m.scene ? parseInt(m.scene, 10) : null;
        const sName = scNum ? (desktopSceneNames[scNum] || `Scene ${scNum}`) : '';
        const sceneBadge = scNum ? `<span style="background: rgba(56,189,248,0.2); color: #38bdf8; padding: 1px 4px; border-radius: 3px; font-size: 8px; font-weight: 700; margin-left: 4px;">S${scNum}${sName && sName !== `Scene ${scNum}` ? `: ${sName}` : ''}</span>` : '';
        pill.innerHTML = `<span>${m.name}${sceneBadge} (${formatTime(m.time)})</span><span class="del-btn" style="display: inline-flex; align-items: center;" onclick="event.stopPropagation(); deleteMarker(${m.id})"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></span>`;
        pill.onclick = () => jumpToMarker(m.time, idx < markers.length - 1 ? markers[idx + 1].time : null, scNum);
        ribbon.appendChild(pill);

        if (duration > 0) {
          const pct = (m.time / duration) * 100;
          const flag = document.createElement("div");
          flag.className = "section-marker-group";
          flag.id = `flag-${m.id}`;
          flag.style.left = `${pct}%`;

          const tag = document.createElement("div");
          tag.className = "section-marker-label";
          tag.id = `tag-${m.id}`;
          tag.style.left = `${pct}%`;
          tag.innerText = scNum ? `${m.name} [S${scNum}${sName && sName !== `Scene ${scNum}` ? `: ${sName}` : ''}]` : m.name;
          tag.onmousedown = (e) => startMarkerDrag(m.id, e);
          tag.onclick = (e) => { e.stopPropagation(); jumpToMarker(m.time, idx < markers.length - 1 ? markers[idx + 1].time : null, scNum); };

          overlay.appendChild(flag);
          overlay.appendChild(tag);
        }
      });
    }
    async function deleteMarker(id) { await transportAction("remove_marker", { id }); }
    async function jumpToMarker(startSec, nextSec, sceneNum) {
      if (sceneNum) {
        selectScene(sceneNum);
      }
      await transportAction("seek", { seconds: startSec });
      if (nextSec && nextSec > startSec) {
        await transportAction("loop_a", { seconds: startSec });
        await transportAction("loop_b", { seconds: nextSec });
        await transportAction("toggle_loop");
      }
    }
    function drawWaveform() {
      const canvas = document.getElementById("waveformCanvas");
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      const ctx = canvas.getContext("2d");
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

      const w = rect.width;
      const h = rect.height;
      const mid = h / 2;

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#38bdf8";

      const barWidth = Math.max(1, w / waveformPeaks.length);
      for (let i = 0; i < waveformPeaks.length; i++) {
        const peak = waveformPeaks[i];
        const barHeight = Math.max(2, peak * (h * 0.85));
        const x = i * barWidth;
        const y = mid - barHeight / 2;
        ctx.fillRect(x, y, barWidth - 0.5, barHeight);
      }
    }
    function handleWaveformClick(e) {
      if (draggingMarkerId !== null) return;
      const container = document.getElementById("waveformContainer");
      const rect = container.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const ratio = Math.max(0, Math.min(1, clickX / rect.width));
      
      fetch("/api/status")
        .then(r => r.json())
        .then(d => {
          if (d.song && d.song.duration_seconds > 0) {
            const targetSec = ratio * d.song.duration_seconds;
            transportAction("seek", { seconds: targetSec });
          }
        });
    }
    async function transportAction(action, extra = {}) {
      await fetch("/api/transport", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra })
      });
    }
    async function clearSongTrack() { 
      await transportAction("clear_track");
      document.getElementById("songIntelBadge").style.display = "none";
      document.getElementById("analyzeTrackBtn").style.display = "none";
    }
    async function triggerTrackAnalysis() {
      const btn = document.getElementById("analyzeTrackBtn");
      const origText = btn.innerHTML;
      btn.innerHTML = `<span style="color: var(--accent);">Analyzing...</span>`;
      btn.disabled = true;

      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({})
        });
        const data = await res.json();
        if (data.success) {
          if (data.result) displayTrackIntelligence(data.result);
          if (data.song) {
            if (data.song.lyrics_sheet && data.song.lyrics_sheet.length > 0) {
              renderLyricsSheet(data.song.lyrics_sheet);
            }
            if (data.song.chord_chart && data.song.chord_chart.length > 0) {
              activeChordChart = data.song.chord_chart;
              updateNextChordHUD(data.song.current_time_seconds || 0);
              updateSongChordTracker(data.song.current_time_seconds || 0);
            }
          }
          btn.innerHTML = `<span style="color: var(--success); display: inline-flex; align-items: center; gap: 4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Done</span>`;
          setTimeout(() => { btn.innerHTML = origText; btn.disabled = false; }, 2000);
        } else {
          const errMsg = data.error || "Analysis failed";
          alert(errMsg);
          btn.innerHTML = `<span style="color: var(--danger);">Error</span>`;
          setTimeout(() => { btn.innerHTML = origText; btn.disabled = false; }, 2000);
        }
      } catch (e) {
        alert("Analysis request failed: " + e.message);
        btn.innerHTML = `<span style="color: var(--danger);">Failed</span>`;
        setTimeout(() => { btn.innerHTML = origText; btn.disabled = false; }, 2000);
      }
    }
    function displayTrackIntelligence(intel) {
      if (!intel) return;
      const badge = document.getElementById("songIntelBadge");
      const keyText = document.getElementById("intelKeyText");
      const bpmText = document.getElementById("intelBpmText");
      const meterText = document.getElementById("intelMeterText");

      if (badge && keyText && bpmText && meterText) {
        badge.style.display = "inline-flex";
        const kDisplay = intel.key || intel.key_full || '--';
        keyText.innerText = `Key: ${kDisplay}`;
        bpmText.innerText = `${intel.bpm || '--'} BPM`;
        meterText.innerText = `${intel.time_sig || intel.time_signature || '--'}`;

        const detectedKey = intel.key || intel.key_root;
        if (detectedKey) {
          const rootKey = detectedKey.replace("m", "");
          userNashvilleKey = rootKey;
          const kSel = document.getElementById("nashvilleKeySelect");
          if (kSel) kSel.value = rootKey;
        }
      }
    }
    function syncMetronomeToTrack() {
      const bpmEl = document.getElementById("intelBpmText");
      if (bpmEl && bpmEl.innerText !== "-- BPM") {
        const bpmVal = parseFloat(bpmEl.innerText);
        if (bpmVal > 30) {
          document.getElementById("bpmInput").value = Math.round(bpmVal);
          updateMixer("metronome_bpm", bpmVal);
        }
      }
    }
    function updatePitchUI() {
      const sign = currentTrackPitch > 0 ? "+" : "";
      document.getElementById("trackPitchReadout").innerText = `${sign}${currentTrackPitch} st`;
    }
    async function stepTrackPitch(delta) {
      const target = Math.max(-12, Math.min(12, currentTrackPitch + delta));
      await setTrackPitch(target);
    }
    async function setTrackPitch(val) {
      currentTrackPitch = val;
      updatePitchUI();
      await transportAction("pitch_shift", { semitones: val });
    }
    async function uploadSong(input) {
      if (!input.files || input.files.length === 0) return;
      const formData = new FormData();
      formData.append("file", input.files[0]);

      document.getElementById("songFilename").innerText = "Decoding track...";
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (data.success) {
        if (data.song && data.song.waveform_peaks) {
          waveformPeaks = data.song.waveform_peaks;
          drawWaveform();
        }
        showAppToast(`Loaded & saved "${data.filename}" to playlist library`);
        refreshPlaylistUI();
      }
    }
