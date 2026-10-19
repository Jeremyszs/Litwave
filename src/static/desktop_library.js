// Litwave desktop/library — extracted verbatim from index.html (see README section 2). Plain classic script, global scope, no modules.
    // ==========================================
    // Setlist & Library Manager Handlers
    // ==========================================
    let g_allSetlists = [];
    let g_activeSetlistId = "sunday_morning";
    let g_pendingConfirmCallback = null;

    async function openSetlistModal(initialTab = "setlist") {
      document.getElementById("setlistModal").style.display = "flex";
      switchSetlistTab(initialTab);
      await refreshSetlistsUI();
      await refreshPlaylistUI();
    }
    function closeSetlistModal() {
      document.getElementById("setlistModal").style.display = "none";
    }

    // Direct alias for playlist button so both work seamlessly
    async function openPlaylistModal() {
      openSetlistModal("library");
    }
    function closePlaylistModal() {
      closeSetlistModal();
    }
    function switchSetlistTab(tab) {
      const tabSongs = document.getElementById("setlistTab_songs");
      const tabLib = document.getElementById("setlistTab_library");
      const paneSongs = document.getElementById("setlistTabPane_setlist");
      const paneLib = document.getElementById("setlistTabPane_library");
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
      }
    }
    async function refreshSetlistsUI() {
      try {
        const res = await fetch("/api/setlist");
        const data = await res.json();
        if (data.setlists) {
          g_allSetlists = data.setlists;
          if (!g_allSetlists.some(s => s.id === g_activeSetlistId) && g_allSetlists.length > 0) {
            g_activeSetlistId = g_allSetlists[0].id;
          }
          renderSetlistDropdown();
          renderActiveSetlistSongs();
        }
      } catch (e) {
        console.error("Failed to load setlists:", e);
      }
    }
    function renderSetlistDropdown() {
      const dd = document.getElementById("setlistSelectDropdown");
      if (!dd) return;
      dd.innerHTML = g_allSetlists.map(s => `
        <option value="${s.id}" ${s.id === g_activeSetlistId ? 'selected' : ''}>${s.name} (${(s.songs || []).length} songs)</option>
      `).join("");
    }
    function onSelectSetlist(id) {
      g_activeSetlistId = id;
      renderActiveSetlistSongs();
    }
    function renderActiveSetlistSongs() {
      const container = document.getElementById("setlistSongsList");
      if (!container) return;
      const cur = g_allSetlists.find(s => s.id === g_activeSetlistId);
      if (!cur || !cur.songs || cur.songs.length === 0) {
        container.innerHTML = '<div style="font-size: 11px; color: var(--text-faint); padding: 12px; text-align: center; border: 1px dashed var(--border-dim); border-radius: 6px;">No songs in this setlist yet.<br><span style="color: var(--text-dim); font-size: 10px;">Click "+ Add Song" or switch to "Song Library / Playlist" tab to add tracks.</span></div>';
        return;
      }
      container.innerHTML = cur.songs.map((song, idx) => `
        <div style="background: var(--bg-panel); border: 1px solid var(--border-dim); border-radius: 6px; padding: 8px 10px; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
          <div style="display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; cursor: pointer;" onclick="loadAndApplySetlistSong('${cur.id}', '${song.id}')">
            <span style="font-size: 12px; font-weight: 700; color: var(--accent); width: 20px; text-align: center;">${idx + 1}</span>
            <div style="display: flex; flex-direction: column; min-width: 0;">
              <span style="font-size: 11px; font-weight: 600; color: var(--text-main); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${song.title || song.filename}</span>
              <span style="font-size: 10px; color: var(--text-dim);">
                Key: <b style="color: var(--accent);">${song.key || '--'}</b> · Pad: <b style="color: var(--text-main);">${song.patch_snapshot?.drone_root || '--'}</b> · Engine: ${song.patch_snapshot?.engine_type || 'yamaha'}
              </span>
            </div>
          </div>
          <div style="display: flex; gap: 3px; align-items: center; flex-shrink: 0;">
            <button class="btn" style="padding: 2px 5px; font-size: 9px;" onclick="moveSongInSetlist('${cur.id}', '${song.id}', 'up')" title="Move Up" ${idx === 0 ? 'disabled' : ''}>▲</button>
            <button class="btn" style="padding: 2px 5px; font-size: 9px;" onclick="moveSongInSetlist('${cur.id}', '${song.id}', 'down')" title="Move Down" ${idx === cur.songs.length - 1 ? 'disabled' : ''}>▼</button>
            <button class="btn btn-primary" style="padding: 3px 8px; font-size: 10px; font-weight: 600;" onclick="loadAndApplySetlistSong('${cur.id}', '${song.id}')">Load</button>
            <button class="btn" style="padding: 3px 6px; color: var(--danger); font-size: 10px;" onclick="confirmRemoveSong('${cur.id}', '${song.id}', '${(song.title || song.filename).replace(/'/g, "\\'")}')" title="Remove">✕</button>
          </div>
        </div>
      `).join("");
    }
    async function moveSongInSetlist(setlistId, songId, direction) {
      try {
        const res = await fetch("/api/setlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "move_song", setlist_id: setlistId, song_id: songId, direction: direction })
        });
        const data = await res.json();
        if (data.setlists) {
          g_allSetlists = data.setlists;
          renderActiveSetlistSongs();
        }
      } catch (e) {
        showAppToast("Failed to reorder song: " + e);
      }
    }

    // Modal Confirmation Dialog Helpers (replaces alert & confirm)
    function openSetlistConfirmModal(title, message, confirmBtnLabel, onConfirm) {
      document.getElementById("setlistConfirmTitle").innerText = title;
      document.getElementById("setlistConfirmMessage").innerText = message;
      const btn = document.getElementById("setlistConfirmActionBtn");
      btn.innerText = confirmBtnLabel || "Confirm";
      g_pendingConfirmCallback = onConfirm;
      document.getElementById("setlistConfirmModal").style.display = "flex";
    }
    function closeSetlistConfirmModal() {
      document.getElementById("setlistConfirmModal").style.display = "none";
      g_pendingConfirmCallback = null;
    }
    async function executeSetlistConfirmAction() {
      const cb = g_pendingConfirmCallback;
      closeSetlistConfirmModal();
      if (typeof cb === "function") {
        await cb();
      }
    }

    // Create New Setlist
    function openNewSetlistModal() {
      const inp = document.getElementById("newSetlistNameInput");
      inp.value = `Setlist ${g_allSetlists.length + 1}`;
      document.getElementById("newSetlistModal").style.display = "flex";
      setTimeout(() => { inp.focus(); inp.select(); }, 50);
    }
    function closeNewSetlistModal() {
      document.getElementById("newSetlistModal").style.display = "none";
    }
    async function confirmNewSetlist() {
      const inp = document.getElementById("newSetlistNameInput");
      const name = inp.value.trim() || `Setlist ${g_allSetlists.length + 1}`;
      closeNewSetlistModal();
      try {
        const res = await fetch("/api/setlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "create_setlist", name: name })
        });
        const data = await res.json();
        if (data.setlist) {
          g_activeSetlistId = data.setlist.id;
          await refreshSetlistsUI();
          showAppToast(`Created setlist "${name}"`);
        }
      } catch (e) {
        showAppToast("Failed to create setlist: " + e);
      }
    }

    // Delete Current Setlist
    function promptDeleteCurrentSetlist() {
      const cur = g_allSetlists.find(s => s.id === g_activeSetlistId);
      if (!cur) return;
      openSetlistConfirmModal(
        "Delete Setlist",
        `Are you sure you want to delete "${cur.name}"? This action cannot be undone.`,
        "Delete Setlist",
        async () => {
          try {
            const res = await fetch("/api/setlist", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "delete_setlist", setlist_id: cur.id })
            });
            const data = await res.json();
            if (data.setlists) {
              g_allSetlists = data.setlists;
              g_activeSetlistId = g_allSetlists[0]?.id || "sunday_morning";
              await refreshSetlistsUI();
              showAppToast(`Deleted setlist "${cur.name}"`);
            }
          } catch (e) {
            showAppToast("Failed to delete setlist: " + e);
          }
        }
      );
    }

    // Add Songs from Playlist to Setlist
    async function openAddSongModal() {
      const container = document.getElementById("addFromPlaylistItemsList");
      if (!container) return;
      container.innerHTML = '<div style="font-size: 11px; color: var(--text-faint); padding: 8px;">Loading library...</div>';
      document.getElementById("addFromPlaylistModal").style.display = "flex";

      try {
        const res = await fetch("/api/playlist");
        const data = await res.json();
        const tracks = data.tracks || [];
        if (tracks.length === 0) {
          container.innerHTML = '<div style="font-size: 11px; color: var(--text-faint); padding: 8px;">No audio tracks found. Click "+ Upload New" to add audio files.</div>';
          return;
        }
        container.innerHTML = tracks.map(t => {
          const cleanName = t.filename.replace(/'/g, "\\'");
          const title = (t.title || t.filename).replace(/'/g, "\\'");
          const key = t.key || "C";
          return `
            <div style="background: var(--bg-panel); border: 1px solid var(--border-dim); border-radius: 4px; padding: 6px 10px; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
              <div style="display: flex; flex-direction: column; min-width: 0; flex: 1;">
                <span style="font-size: 11px; font-weight: 600; color: var(--text-main); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${t.title || t.filename}</span>
                <span style="font-size: 10px; color: var(--text-dim);">Key: ${t.key || '--'} · ${t.size_mb || 0} MB</span>
              </div>
              <button class="btn btn-primary" style="padding: 3px 8px; font-size: 10px; font-weight: 600;" onclick="confirmAddTrackFromPlaylist('${cleanName}', '${title}', '${key}')">+ Add</button>
            </div>
          `;
        }).join("");
      } catch (e) {
        container.innerHTML = `<div style="color: var(--danger); font-size: 11px;">Error loading tracks: ${e}</div>`;
      }
    }
    function closeAddFromPlaylistModal() {
      document.getElementById("addFromPlaylistModal").style.display = "none";
    }
    async function confirmAddTrackFromPlaylist(filename, title, key) {
      closeAddFromPlaylistModal();
      const songData = {
        title: title || filename,
        filename: filename,
        key: key || "C"
      };
      try {
        const res = await fetch("/api/setlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "add_song",
            setlist_id: g_activeSetlistId,
            song_data: songData
          })
        });
        const data = await res.json();
        if (data.setlists) {
          g_allSetlists = data.setlists;
          renderActiveSetlistSongs();
          renderSetlistDropdown();
          showAppToast(`Added "${songData.title}" to setlist with VST snapshot`);
        }
      } catch (e) {
        showAppToast("Failed to add song: " + e);
      }
    }

    // Remove Song from Setlist with custom confirmation
    function confirmRemoveSong(setlistId, songId, songTitle) {
      openSetlistConfirmModal(
        "Remove Song",
        `Remove "${songTitle}" from this setlist?`,
        "Remove",
        async () => {
          try {
            const res = await fetch("/api/setlist", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "remove_song",
                setlist_id: setlistId,
                song_id: songId
              })
            });
            const data = await res.json();
            if (data.setlists) {
              g_allSetlists = data.setlists;
              renderActiveSetlistSongs();
              renderSetlistDropdown();
              showAppToast(`Removed song from setlist`);
            }
          } catch (e) {
            showAppToast("Failed to remove song: " + e);
          }
        }
      );
    }
    async function loadAndApplySetlistSong(setlistId, songId) {
      const cur = g_allSetlists.find(s => s.id === setlistId);
      if (!cur) return;
      const song = (cur.songs || []).find(s => s.id === songId);
      if (!song) return;

      // 1. Load backing track if filename matches
      if (song.filename) {
        await loadPlaylistTrack(song.filename, false);
      }

      // 2. Apply VST patch snapshot & ambient pad root
      if (song.patch_snapshot) {
        try {
          await fetch("/api/setlist", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "apply_song_patch",
              patch_snapshot: song.patch_snapshot
            })
          });
          showAppToast(`Loaded "${song.title || song.filename}" (Key: ${song.key || 'C'})`);
        } catch (e) {
          console.error("Failed to apply patch:", e);
        }
      }
      closeSetlistModal();
    }
    async function refreshPlaylistUI() {
      const listEl = document.getElementById("playlistTracksList");
      if (!listEl) return;
      listEl.innerHTML = '<div style="font-size: 11px; color: var(--text-faint); padding: 8px;">Loading library...</div>';
      try {
        const res = await fetch("/api/playlist");
        const data = await res.json();
        if (!data.tracks || data.tracks.length === 0) {
          listEl.innerHTML = '<div style="font-size: 11px; color: var(--text-faint); padding: 8px;">No audio files found in uploads. Click "+ Upload New" to add tracks.</div>';
          return;
        }
        listEl.innerHTML = data.tracks.map(t => {
          const cleanName = t.filename.replace(/'/g, "\\'");
          return `
          <div style="background: var(--bg-panel); border: 1px solid ${t.is_current ? 'var(--accent)' : 'var(--border-dim)'}; border-radius: 4px; padding: 6px 10px; display: flex; align-items: center; justify-content: space-between; gap: 8px; transition: all 0.1s ease;">
            <div style="display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1; cursor: pointer;" onclick="loadPlaylistTrack('${cleanName}')">
              <span style="color: ${t.is_current ? 'var(--accent)' : 'var(--text-faint)'}; display: inline-flex; align-items: center;">
                ${t.is_current 
                  ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>'
                  : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>'
                }
              </span>
              <span style="font-size: 11px; font-weight: ${t.is_current ? '600' : '500'}; color: ${t.is_current ? 'var(--accent)' : 'var(--text-main)'}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${t.filename}</span>
              <span style="font-size: 10px; font-family: var(--font-mono); color: var(--text-dim); margin-left: 6px;">${t.size_mb} MB</span>
            </div>
            <div style="display: flex; align-items: center; gap: 4px; flex-shrink: 0;">
              <button class="btn btn-primary" style="padding: 2px 7px; font-size: 10px;" onclick="loadPlaylistTrack('${cleanName}')">Load</button>
              <button class="btn" style="padding: 2px 7px; font-size: 10px;" onclick="quickAddPlaylistTrackToSetlist('${cleanName}')" title="Add to current setlist with VST snapshot">+ Setlist</button>
            </div>
          </div>
        `}).join("");
      } catch (e) {
        listEl.innerHTML = `<div style="color: var(--danger); font-size: 11px;">Error loading tracks: ${e}</div>`;
      }
    }
    async function quickAddPlaylistTrackToSetlist(filename) {
      const songData = {
        title: filename,
        filename: filename,
        key: "C"
      };
      try {
        const res = await fetch("/api/setlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "add_song",
            setlist_id: g_activeSetlistId,
            song_data: songData
          })
        });
        const data = await res.json();
        if (data.setlists) {
          g_allSetlists = data.setlists;
          renderActiveSetlistSongs();
          renderSetlistDropdown();
          showAppToast(`Added "${filename}" to active setlist!`);
        }
      } catch (e) {
        showAppToast("Failed to add track to setlist: " + e);
      }
    }
    async function loadPlaylistTrack(filename, closeModal = true) {
      try {
        const res = await fetch("/api/playlist/select", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename })
        });
        const data = await res.json();
        if (data.success) {
          waveformPeaks = [];
          if (data.song && data.song.waveform_peaks) {
            waveformPeaks = data.song.waveform_peaks;
            drawWaveform();
          }
          showAppToast(`Loaded backing track "${filename}"`);
        }
        if (closeModal) {
          closeSetlistModal();
        }
      } catch (e) {
        console.error("Failed to load song:", e);
      }
    }

    // Phone Remote Modal & QR Code
    let remoteTargetUrl = "";
    async function openRemoteModal() {
      const modal = document.getElementById("remoteModal");
      modal.style.display = "flex";

      try {
        const res = await fetch("/api/remote-info");
        const data = await res.json();
        remoteTargetUrl = data.local_url;
        document.getElementById("remoteUrlInput").value = remoteTargetUrl;

        // Use reliable inline QR code service
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(remoteTargetUrl)}`;
        document.getElementById("qrImg").src = qrUrl;
      } catch (e) {
        console.error("Failed to load remote info:", e);
        remoteTargetUrl = `${window.location.origin}/remote`;
        document.getElementById("remoteUrlInput").value = remoteTargetUrl;
        document.getElementById("qrImg").src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(remoteTargetUrl)}`;
      }
    }
    function closeRemoteModal() {
      document.getElementById("remoteModal").style.display = "none";
    }
    function copyRemoteUrl() {
      const input = document.getElementById("remoteUrlInput");
      input.select();
      navigator.clipboard.writeText(input.value).then(() => {
        const notice = document.getElementById("copyNotice");
        notice.style.opacity = "1";
        setTimeout(() => { notice.style.opacity = "0"; }, 2000);
      });
    }

    // Universal Floating Window Engine (For both Song Window and MIDI Window)
    let activeFloatingWindow = null;
    let dragStartX = 0;
    let dragStartY = 0;
    let initialWinX = 0;
    let initialWinY = 0;

    const songWindow = document.getElementById("songWindow");
    const midiWindow = document.getElementById("midiWindow");
    const leftColumn = document.getElementById("leftColumn");

    function toggleWindowFloat(win, dockBtn, defaultTop, defaultLeft, defaultWidth, defaultHeight) {
      const isFloating = win.classList.contains("is-floating");
      if (!isFloating) {
        const rect = win.getBoundingClientRect();
        win.classList.add("is-floating");
        win.style.left = `${rect.left || defaultLeft}px`;
        win.style.top = `${rect.top || defaultTop}px`;
        win.style.width = `${Math.max(380, rect.width || defaultWidth)}px`;
        win.style.height = `${Math.max(160, rect.height || defaultHeight)}px`;
        dockBtn.innerText = "Dock";
        document.body.appendChild(win); // Escape flex container
      } else {
        win.classList.remove("is-floating");
        win.style.left = "";
        win.style.top = "";
        win.style.width = "";
        win.style.height = "";
        dockBtn.innerText = "Float";
        if (win.id === "songWindow") {
          leftColumn.insertBefore(win, leftColumn.firstChild);
        } else {
          leftColumn.appendChild(win);
        }
      }
      setTimeout(drawWaveform, 50);
    }
    function toggleSongFloat() {
      toggleWindowFloat(songWindow, document.getElementById("dockSongBtn"), 60, 20, 680, 190);
    }
    function toggleMidiFloat() {
      toggleWindowFloat(midiWindow, document.getElementById("dockMidiBtn"), 260, 20, 680, 190);
    }
    function bindTitlebarDrag(titlebar, win) {
      titlebar.addEventListener("mousedown", (e) => {
        if (e.target.tagName === "BUTTON" || e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
        if (!win.classList.contains("is-floating")) {
          if (win.id === "songWindow") toggleSongFloat();
          else toggleMidiFloat();
        }
        activeFloatingWindow = win;
        const rect = win.getBoundingClientRect();
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        initialWinX = rect.left;
        initialWinY = rect.top;
        e.preventDefault();
      });
    }
