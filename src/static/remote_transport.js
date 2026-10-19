// Litwave remote/transport — extracted verbatim from remote.html (see README section 2). Plain classic script, global scope, no modules.
    // Mobile Section Bookmark Handlers
    function openRemoteMarkerModal() {
      if (!songDuration || songDuration <= 0) {
        showRemoteToast("Load a song first to add bookmarks");
        return;
      }
      document.getElementById("remoteMarkerNameInput").value = `Section ${(cachedRemoteMarkers ? cachedRemoteMarkers.length : 0) + 1}`;
      const sel = document.getElementById("remoteMarkerSceneSelect");
      if (sel) {
        sel.innerHTML = '<option value="">None (Keep current scene)</option>';
        for (let s = 1; s <= 8; s++) {
          const sName = remoteSceneNames[s] || `Scene ${s}`;
          sel.innerHTML += `<option value="${s}">${sName !== `Scene ${s}` ? `Scene ${s} (${sName})` : sName}</option>`;
        }
        sel.value = "";
      }
      document.getElementById("remoteBookmarkModal").style.display = "flex";
      setTimeout(() => document.getElementById("remoteMarkerNameInput").focus(), 50);
    }
    function closeRemoteMarkerModal() {
      document.getElementById("remoteBookmarkModal").style.display = "none";
    }
    async function confirmRemoteAddMarker() {
      const name = document.getElementById("remoteMarkerNameInput").value.trim() || "Section";
      const scVal = document.getElementById("remoteMarkerSceneSelect").value;
      const scene = scVal ? parseInt(scVal) : null;
      closeRemoteMarkerModal();
      showRemoteToast(`Added section ${name}`);
      await sendTransport("add_marker", { name, scene, time: currentPosition });
    }
    async function jumpToRemoteMarker(time, scene) {
      if (scene) {
        const scNum = parseInt(scene, 10);
        if (scNum >= 1 && scNum <= 8) selectRemoteScene(scNum);
      }
      await sendTransport("seek", { seconds: time });
    }

    let lastTriggeredRemoteMarkerId = null;
    let lastRemoteMarkerCheckTime = -1;

    function checkRemoteMarkerAutoSceneTrigger(curSec, markers) {
      if (!markers || markers.length === 0) return;
      if (curSec < lastRemoteMarkerCheckTime - 0.5) {
        lastTriggeredRemoteMarkerId = null;
      }
      lastRemoteMarkerCheckTime = curSec;

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
        if (scNum >= 1 && scNum <= 8 && activeM.id !== lastTriggeredRemoteMarkerId) {
          lastTriggeredRemoteMarkerId = activeM.id;
          selectRemoteScene(scNum);
        }
      }
    }

    // Mobile AI Song Intelligence Analysis Handler
    async function triggerRemoteAnalyze() {
      const btn = document.getElementById("remoteAnalyzeBtn");
      const txt = document.getElementById("remoteAnalyzeText");
      if (btn.disabled) return;
      btn.disabled = true;
      txt.innerText = "Analyzing...";
      showRemoteToast("Starting AI song intelligence analysis...");
      try {
        const res = await fetch("/api/analyze", { method: "POST" });
        const data = await res.json();
        if (data.success && data.result) {
          showRemoteToast(`Analysis complete: ${data.result.key || "Unknown key"} (${data.result.bpm || "Unknown"} BPM)`);
          txt.innerText = "Analyzed";
        } else {
          showRemoteToast(data.error || "Analysis failed; existing chart preserved");
          txt.innerText = "Analyze";
        }
      } catch (e) {
        showRemoteToast("Analysis failed; existing chart preserved");
        txt.innerText = "Analyze";
      } finally {
        setTimeout(() => { btn.disabled = false; }, 3000);
      }
    }

    // Transport Actions
    function togglePlay() {
      const action = isPlaying ? "pause" : "play";
      sendTransport(action);
    }
    function sendTransport(action, extra = {}) {
      // Optimistic local state update so loop / play reflects instantly
      if (action === "toggle_loop") {
        isLooping = !isLooping;
        const loopBtn = document.getElementById("remoteLoopBtn");
        if (loopBtn) {
          loopBtn.querySelector("#loopText").innerText = isLooping ? "Loop [On]" : "Loop [Off]";
          if (isLooping) loopBtn.classList.add("is-active-loop");
          else loopBtn.classList.remove("is-active-loop");
        }
      }
      fetch("/api/transport", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: action, ...extra })
      }).catch(console.error);
    }
    function handleSeekTap(e) {
      if (songDuration <= 0) return;
      const rect = document.getElementById("seekWrap").getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const targetSec = ratio * songDuration;
      sendTransport("seek", { seconds: targetSec });
    }

    // Pitch Stepper
    function stepPitch(delta) {
      const target = Math.max(-12, Math.min(12, currentPitch + delta));
      setPitch(target);
    }
    function setPitch(val) {
      currentPitch = val;
      const sign = currentPitch > 0 ? "+" : "";
      document.getElementById("remotePitchVal").innerText = `${sign}${currentPitch} st`;
      sendTransport("pitch_shift", { semitones: val });
    }

    // Remote Lyrics Font Size Stepper
    let rLyricsFontSize = 13;
    function changeRemoteLyricsFontSize(delta) {
      rLyricsFontSize = Math.max(10, Math.min(22, rLyricsFontSize + delta));
      const txt = document.getElementById("remoteLyricsFontText");
      if (txt) txt.innerText = `${rLyricsFontSize}px`;
      const container = document.getElementById("remoteStaticLyricsContainer");
      if (container) container.style.fontSize = `${rLyricsFontSize}px`;
    }

    // Mobile Ear Training Handlers
    let rEarModule = "chord_quality";
    let rEarLocked = false;

    function openRemoteEarModal() {
      document.getElementById("remoteEarModal").style.display = "flex";
      loadRemoteEarExercise();
    }
    function closeRemoteEarModal() {
      document.getElementById("remoteEarModal").style.display = "none";
    }
    function setRemoteEarMod(mod) {
      rEarModule = mod;
      ['chord', 'prog', 'rel'].forEach(k => {
        const b = document.getElementById(`rEarTab_${k}`);
        if (b) b.classList.remove("btn-active");
      });
      if (mod === "chord_quality") document.getElementById("rEarTab_chord").classList.add("btn-active");
      else if (mod === "progression") document.getElementById("rEarTab_prog").classList.add("btn-active");
      else if (mod === "relative_interval") document.getElementById("rEarTab_rel").classList.add("btn-active");
      loadRemoteEarExercise();
    }
    async function loadRemoteEarExercise() {
      rEarLocked = false;
      document.getElementById("rEarFbText").innerText = "";
      document.getElementById("rEarQText").innerText = "Generating in MONTAGE M...";
      const grid = document.getElementById("rEarChoicesGrid");
      grid.innerHTML = "";

      try {
        const res = await fetch("/api/ear-training", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "generate", module: rEarModule })
        });
        const data = await res.json();
        if (data.exercise) {
          document.getElementById("rEarQText").innerText = data.exercise.question;
          if (data.score) {
            document.getElementById("remoteEarScore").innerText = `${data.score.correct}/${data.score.total}`;
          }
          if (data.exercise.choices) {
            grid.innerHTML = data.exercise.choices.map(c => `
              <button class="btn" style="padding: 8px 6px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;" onclick="submitRemoteEarAnswer('${c.id}')">
                <span style="font-weight: 600; font-size: 11px;">${c.label || c.nashville || c.id}</span>
                <span style="font-size: 9px; color: var(--text-dim); font-family: var(--font-mono);">${c.abbr || c.roman || c.deg || ''}</span>
              </button>
            `).join("");
          }
        }
      } catch (e) {
        document.getElementById("rEarQText").innerText = `Error: ${e}`;
      }
    }
    async function submitRemoteEarAnswer(ansId) {
      if (rEarLocked) return;
      rEarLocked = true;
      try {
        const res = await fetch("/api/ear-training", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "check", answer: ansId })
        });
        const data = await res.json();
        const fb = document.getElementById("rEarFbText");
        if (data.is_correct) {
          fb.innerHTML = `<span style="color: var(--success); display: inline-flex; align-items: center; gap: 4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Correct!</span>`;
        } else {
          fb.innerHTML = `<span style="color: var(--danger); display: inline-flex; align-items: center; gap: 4px;"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Correct: ${data.correct_answer}</span>`;
        }
        if (data.score) {
          document.getElementById("remoteEarScore").innerText = `${data.score.correct}/${data.score.total}`;
        }
      } catch (e) {
        console.error(e);
      }
    }

    // Remote Song Library Modal Handlers (aliased to Setlist Library tab)
    function openRemotePlaylistModal() {
      openRemoteSetlistModal("library");
    }
    function closeRemotePlaylistModal() {
      closeRemoteSetlistModal();
    }

    // Remote Setlist Handlers
    let rAllSetlists = [];
    let rActiveSetlistId = "sunday_morning";

    function switchRemoteSetlistTab(tab) {
      const tabSongs = document.getElementById("rSetlistTab_songs");
      const tabLib = document.getElementById("rSetlistTab_library");
      const paneSongs = document.getElementById("rSetlistPane_songs");
      const paneLib = document.getElementById("rSetlistPane_library");
      if (tab === "setlist") {
        tabSongs.classList.add("btn-active");
        tabLib.classList.remove("btn-active");
        paneSongs.style.display = "flex";
        paneLib.style.display = "none";
      } else {
        tabLib.classList.add("btn-active");
        tabSongs.classList.remove("btn-active");
        paneSongs.style.display = "none";
        paneLib.style.display = "flex";
        loadRemoteSetlistLibrary();
      }
    }
    async function openRemoteSetlistModal(tab = "setlist") {
      document.getElementById("remoteSetlistModal").style.display = "flex";
      switchRemoteSetlistTab(tab);
      await loadRemoteSetlist();
    }
    function closeRemoteSetlistModal() {
      document.getElementById("remoteSetlistModal").style.display = "none";
    }
    function onSelectRemoteSetlist(id) {
      rActiveSetlistId = id;
      renderRemoteSetlistSongs();
    }
    async function loadRemoteSetlist() {
      const container = document.getElementById("remoteSetlistItemsList");
      container.innerHTML = '<div style="font-size: 11px; color: var(--text-dim); padding: 8px;">Loading setlist...</div>';
      try {
        const res = await fetch("/api/setlist");
        const data = await res.json();
        rAllSetlists = data.setlists || [];
        if (rAllSetlists.length === 0) {
          container.innerHTML = '<div style="font-size: 11px; color: var(--text-dim); padding: 8px;">No setlists found.</div>';
          return;
        }
        if (!rAllSetlists.some(s => s.id === rActiveSetlistId)) {
          rActiveSetlistId = rAllSetlists[0].id;
        }
        const dd = document.getElementById("remoteSetlistDropdown");
        if (dd) {
          dd.innerHTML = rAllSetlists.map(s => `
            <option value="${s.id}" ${s.id === rActiveSetlistId ? 'selected' : ''}>${s.name} (${(s.songs || []).length} songs)</option>
          `).join("");
        }
        renderRemoteSetlistSongs();
      } catch (e) {
        container.innerHTML = `<div style="color: var(--danger); font-size: 11px;">Error: ${e}</div>`;
      }
    }
    function renderRemoteSetlistSongs() {
      const container = document.getElementById("remoteSetlistItemsList");
      const active = rAllSetlists.find(s => s.id === rActiveSetlistId);
      if (!active || !active.songs || active.songs.length === 0) {
        container.innerHTML = '<div style="font-size: 11px; color: var(--text-dim); padding: 10px; text-align: center;">No songs in this setlist.<br><span style="font-size: 10px; color: var(--text-faint);">Switch to Library tab to add tracks.</span></div>';
        return;
      }
      container.innerHTML = active.songs.map((s, idx) => `
        <div style="background: var(--bg-panel); border: 1px solid var(--border-dim); border-radius: 6px; padding: 8px 10px; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
          <div style="display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; cursor: pointer;" onclick="loadAndApplyRemoteSong('${active.id}', '${s.id}')">
            <span style="font-size: 12px; font-weight: 800; color: var(--accent); width: 18px; text-align: center;">${idx + 1}</span>
            <div style="display: flex; flex-direction: column; min-width: 0;">
              <span style="font-size: 11px; font-weight: 700; color: var(--text-main); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${s.title || s.filename}</span>
              <span style="font-size: 10px; color: var(--text-dim);">Key: <b style="color: var(--accent);">${s.key || '--'}</b> · Pad: ${s.patch_snapshot?.drone_root || '--'}</span>
            </div>
          </div>
          <button class="btn btn-primary" style="padding: 3px 8px; font-size: 10px; flex-shrink: 0;" onclick="loadAndApplyRemoteSong('${active.id}', '${s.id}')">Load</button>
        </div>
      `).join("");
    }
    async function loadRemoteSetlistLibrary() {
      const container = document.getElementById("remoteSetlistLibList");
      container.innerHTML = '<div style="font-size: 11px; color: var(--text-dim); padding: 8px;">Loading tracks...</div>';
      try {
        const res = await fetch("/api/playlist");
        const data = await res.json();
        const tracks = data.tracks || [];
        if (tracks.length === 0) {
          container.innerHTML = '<div style="font-size: 11px; color: var(--text-dim); padding: 8px;">No audio tracks found in uploads.</div>';
          return;
        }
        container.innerHTML = tracks.map(t => {
          const cleanName = t.filename.replace(/'/g, "\\'");
          return `
          <div style="background: var(--bg-panel); border: 1px solid ${t.is_current ? 'var(--accent)' : 'var(--border-dim)'}; border-radius: 6px; padding: 8px 10px; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
            <div style="display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; cursor: pointer;" onclick="selectRemoteTrack('${cleanName}')">
              <span style="font-size: 11px; font-weight: ${t.is_current ? '700' : '500'}; color: ${t.is_current ? 'var(--accent)' : 'var(--text-main)'}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${t.filename}</span>
              <span style="font-size: 10px; font-family: var(--font-mono); color: var(--text-dim);">${t.size_mb} MB</span>
            </div>
            <div style="display: flex; gap: 4px; align-items: center; flex-shrink: 0;">
              <button class="btn btn-primary" style="padding: 2px 6px; font-size: 10px;" onclick="selectRemoteTrack('${cleanName}')">Play</button>
              <button class="btn" style="padding: 2px 6px; font-size: 10px;" onclick="addTrackToRemoteActiveSetlist('${cleanName}')" title="Add to setlist">+ Setlist</button>
            </div>
          </div>
        `}).join("");
      } catch (e) {
        container.innerHTML = `<div style="color: var(--danger); font-size: 11px;">Error: ${e}</div>`;
      }
    }
    async function addTrackToRemoteActiveSetlist(filename) {
      try {
        const res = await fetch("/api/setlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "add_song",
            setlist_id: rActiveSetlistId,
            song_data: { title: filename, filename: filename, key: "C" }
          })
        });
        const data = await res.json();
        if (data.setlists) {
          rAllSetlists = data.setlists;
          showRemoteToast(`Added "${filename}" to setlist`);
          switchRemoteSetlistTab('setlist');
        }
      } catch (e) {
        showRemoteToast("Failed to add: " + e);
      }
    }
    async function loadAndApplyRemoteSong(setlistId, songId) {
      try {
        const res = await fetch("/api/setlist");
        const data = await res.json();
        const sList = (data.setlists || []).find(s => s.id === setlistId);
        if (!sList) return;
        const song = (sList.songs || []).find(s => s.id === songId);
        if (!song) return;

        if (song.filename) {
          await selectRemoteTrack(song.filename);
        }
        if (song.patch_snapshot) {
          await fetch("/api/setlist", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "apply_song_patch", patch_snapshot: song.patch_snapshot })
          });
        }
        closeRemoteSetlistModal();
      } catch (e) {
        console.error("Remote song apply error:", e);
      }
    }
    async function selectRemoteTrack(filename) {
      try {
        await fetch("/api/playlist/select", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename })
        });
        showRemoteToast(`Playing: ${filename}`);
        closeRemoteSetlistModal();
      } catch (e) {
        console.error("Failed to select track:", e);
      }
    }
