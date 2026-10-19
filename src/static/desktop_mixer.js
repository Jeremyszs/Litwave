// Litwave desktop/mixer — extracted verbatim from index.html (see README section 2). Plain classic script, global scope, no modules.
    function renderCustomFaders() {
      const pctTrack = Math.max(0, Math.min(100, (valTrack / 1.0) * 100));
      document.getElementById("faderFillTrack").style.height = `${pctTrack}%`;
      document.getElementById("faderThumbTrack").style.bottom = `${Math.max(0, Math.min(58, (pctTrack / 100) * 58))}px`;

      const pctSynth = Math.max(0, Math.min(100, (valSynth / 1.0) * 100));
      document.getElementById("faderFillSynth").style.height = `${pctSynth}%`;
      document.getElementById("faderThumbSynth").style.bottom = `${Math.max(0, Math.min(58, (pctSynth / 100) * 58))}px`;

      const pctFx = Math.max(0, Math.min(100, (valFx / 1.5) * 100));
      const fillFx = document.getElementById("faderFillFx");
      const thumbFx = document.getElementById("faderThumbFx");
      if (fillFx) fillFx.style.height = `${pctFx}%`;
      if (thumbFx) thumbFx.style.bottom = `${Math.max(0, Math.min(58, (pctFx / 100) * 58))}px`;

      const pctMaster = Math.max(0, Math.min(100, (valMaster / 1.2) * 100));
      document.getElementById("faderFillMaster").style.height = `${pctMaster}%`;
      document.getElementById("faderThumbMaster").style.bottom = `${Math.max(0, Math.min(58, (pctMaster / 100) * 58))}px`;
    }
    let draggingFader = null;
    function startFaderDrag(type, e) {
      draggingFader = type;
      updateFaderFromEvent(type, e);
      e.preventDefault();
    }
    function updateFaderFromEvent(type, e) {
      const el = type === 'track' ? document.getElementById("faderTrackTrack") : (type === 'synth' ? document.getElementById("faderTrackSynth") : (type === 'fx' ? document.getElementById("faderTrackFx") : document.getElementById("faderTrackMaster")));
      const rect = el.getBoundingClientRect();
      const clickY = e.clientY - rect.top;
      const ratio = Math.max(0, Math.min(1.0, 1.0 - (clickY / rect.height)));

      if (type === 'track') {
        valTrack = ratio * 1.0;
        const db = valTrack > 0 ? (20 * Math.log10(valTrack)).toFixed(1) : "-inf";
        document.getElementById("trackVolText").innerText = `${db} dB`;
        updateMixer('track_volume', valTrack);
      } else if (type === 'synth') {
        valSynth = ratio * 1.0;
        const db = valSynth > 0 ? (20 * Math.log10(valSynth)).toFixed(1) : "-inf";
        document.getElementById("synthVolText").innerText = `${db} dB`;
        const vst127 = Math.round(valSynth * 127);
        fetch("/api/montage/volume", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ master_volume: vst127 })
        }).catch(console.error);
      } else if (type === 'fx') {
        valFx = ratio * 1.5;
        const db = valFx > 0 ? (20 * Math.log10(valFx)).toFixed(1) : "-inf";
        document.getElementById("fxPadVolText").innerText = `${db} dB`;
        fetch("/api/fx-pads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "bus", volume: valFx })
        }).catch(console.error);
      } else {
        valMaster = ratio * 1.2;
        const db = valMaster > 0 ? (20 * Math.log10(valMaster)).toFixed(1) : "-inf";
        document.getElementById("masterVolText").innerText = `${db} dB`;
        updateMixer('master_volume', valMaster);
      }
      renderCustomFaders();
    }

    let lastWarmthUserInteraction = 0;

    async function toggleStageWarmth() {
      lastWarmthUserInteraction = performance.now();
      stageWarmthSettings.enabled = !stageWarmthSettings.enabled;
      applyWarmthDomState();
      await fetch("/api/master/dsp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ warmth: stageWarmthSettings })
      });
    }
    function onWarmthDriveInput(val) {
      lastWarmthUserInteraction = performance.now();
      stageWarmthSettings.drive = parseFloat(val);
      const drvTxt = document.getElementById("warmthDriveText");
      if (drvTxt) drvTxt.innerText = `${stageWarmthSettings.drive.toFixed(2)}x`;
      debouncePostWarmthSettings();
    }
    async function setWarmthMode(mode) {
      lastWarmthUserInteraction = performance.now();
      stageWarmthSettings.mode = parseInt(mode, 10);
      applyWarmthDomState();
      await fetch("/api/master/dsp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ warmth: stageWarmthSettings })
      });
    }

    let warmthDebounceTimer = null;
    function debouncePostWarmthSettings() {
      clearTimeout(warmthDebounceTimer);
      warmthDebounceTimer = setTimeout(async () => {
        await fetch("/api/master/dsp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ warmth: stageWarmthSettings })
        });
      }, 100);
    }
    function applyWarmthDomState() {
      const btn = document.getElementById("warmthToggleBtn");
      if (btn) {
        btn.innerText = stageWarmthSettings.enabled ? "On" : "Bypass";
        btn.classList.toggle("btn-active", stageWarmthSettings.enabled);
      }
      const drvInp = document.getElementById("warmthDriveRange");
      if (drvInp && document.activeElement !== drvInp) drvInp.value = stageWarmthSettings.drive;
      const drvTxt = document.getElementById("warmthDriveText");
      if (drvTxt && document.activeElement !== drvInp) drvTxt.innerText = `${stageWarmthSettings.drive.toFixed(2)}x`;
      const modeTxt = document.getElementById("warmthModeText");
      if (modeTxt) modeTxt.innerText = stageWarmthSettings.mode === 1 ? "Crisp" : "Tape";
      const btnTape = document.getElementById("warmthModeTape");
      if (btnTape) btnTape.classList.toggle("btn-active", stageWarmthSettings.mode === 0);
      const btnCrisp = document.getElementById("warmthModeCrisp");
      if (btnCrisp) btnCrisp.classList.toggle("btn-active", stageWarmthSettings.mode === 1);
    }
    async function toggleSpectrumAnalyzer() {
      analyzerEnabled = !analyzerEnabled;
      const btn = document.getElementById("analyzerToggleBtn");
      if (btn) btn.classList.toggle("btn-active", analyzerEnabled);
      drawEqSpline();
      await fetch("/api/master/dsp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ analyzer_enabled: analyzerEnabled, analyzer_visible: analyzerEnabled })
      });
    }
    function updateEngineStatusUi(force = false) {
      const now = performance.now();
      if (!force && now - lastStatusUiUpdate < 180) return;
      lastStatusUiUpdate = now;

      const engine = nativeEngineData || {};
      const audio = lastKnownAudioTelemetry || {};
      const reachable = Boolean(engine.reachable);
      window.g_nativeEngineRunning = reachable;
      const sr = reachable ? (engine.sample_rate || 44100) : (audio.samplerate || 48000);
      const srText = `${Math.round(sr / 1000)}k`;
      const buf = reachable ? (engine.buffer_frames || 256) : (audio.blocksize || 256);
      const latency = reachable ? engine.total_latency_ms : (audio.latency_ms || 6.8);
      const dsp = reachable ? Math.max(0.0, engine.dsp_load_percent || 0.0) : 0.0;
      const xruns = reachable ? (engine.xruns || 0) : 0;

      let stateClass = "stable";
      let stateLabel = "Stable";
      if (dsp >= 90.0) {
        stateClass = "overloaded";
        stateLabel = "Overloaded";
      } else if (dsp >= 70.0 || (reachable && engine.peak_dsp_load_percent >= 98.0)) {
        stateClass = "warning";
        stateLabel = "Warning";
      }

      const dot = document.getElementById("engineStatusDot");
      if (dot) dot.className = `engine-dot ${stateClass === "stable" ? "" : stateClass}`;
      const summary = document.getElementById("engineStatusSummary");
      if (summary) {
        if (!reachable && !audio.samplerate) {
          summary.innerText = "Audio Status";
        } else {
          summary.innerText = `${srText} · ${buf} spl · ${latency.toFixed(1)}ms · DSP ${Math.round(dsp)}% · XRUN ${xruns}`;
        }
      }

      const popStatus = document.getElementById("enginePopoverStatusText");
      if (popStatus) {
        popStatus.innerText = stateLabel;
        popStatus.style.color = stateClass === "overloaded" ? "#ef4444" : (stateClass === "warning" ? "#f59e0b" : "var(--accent)");
      }
      const popDriver = document.getElementById("enginePopDriver");
      if (popDriver) popDriver.innerText = reachable ? `${engine.backend || "native"} (${audio.hostapi || "ASIO"})` : (audio.hostapi || "ASIO");
      const popDevice = document.getElementById("enginePopDevice");
      if (popDevice) popDevice.innerText = reachable ? (engine.device || audio.device_name || "Default") : (audio.device_name || "Default");
      const popSr = document.getElementById("enginePopSr");
      if (popSr) popSr.innerText = `${sr} Hz`;
      const popBuf = document.getElementById("enginePopBuffer");
      if (popBuf) popBuf.innerText = `${buf} frames`;
      const popLat = document.getElementById("enginePopLatency");
      if (popLat) popLat.innerText = `${reachable ? engine.buffer_latency_ms : (latency/2).toFixed(1)}ms / ${latency.toFixed(1)}ms`;
      const popDsp = document.getElementById("enginePopDsp");
      if (popDsp) popDsp.innerText = `${dsp.toFixed(1)}% (Peak: ${(reachable ? engine.peak_dsp_load_percent || 0.0 : 0.0).toFixed(1)}%)`;
      const popXruns = document.getElementById("enginePopXruns");
      if (popXruns) popXruns.innerText = `${xruns}`;

      if (reachable && engine.warmth) {
        const sat = Math.max(0.0, engine.warmth.meter || 0.0);
        const satBar = document.getElementById("warmthSatBar");
        if (satBar) {
          const pct = Math.min(100, Math.round(sat * 300));
          satBar.style.width = `${pct}%`;
        }
      }
    }

    // Master 4-Band Spline Equalizer Interactive Logic
    let eqBands = [
      { id: 1, type: "lowshelf", freq: 100.0, gain: 0.0, q: 0.707 },
      { id: 2, type: "peaking", freq: 500.0, gain: 0.0, q: 1.0 },
      { id: 3, type: "peaking", freq: 2500.0, gain: 0.0, q: 1.0 },
      { id: 4, type: "highshelf", freq: 8000.0, gain: 0.0, q: 0.707 },
    ];
    let draggedEqBandIdx = null;

    function openEqModal() {
      // In embedded desktop design, EQ is seamlessly integrated in the Master Deck
      const canvas = document.getElementById("eqCanvas");
      if (canvas) canvas.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    function closeEqModal() {
      // No-op for embedded desktop layout
    }
    async function resetEqFlat() {
      eqBands.forEach(b => b.gain = 0.0);
      drawEqSpline();
      renderEqInspectors();
      await fetch("/api/mixer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ equalizer_reset: true })
      });
    }
    function freqToX(freq, w) {
      const minLog = Math.log10(20.0);
      const maxLog = Math.log10(20000.0);
      const fLog = Math.log10(Math.max(20.0, Math.min(20000.0, freq)));
      return ((fLog - minLog) / (maxLog - minLog)) * w;
    }
    function xToFreq(x, w) {
      const minLog = Math.log10(20.0);
      const maxLog = Math.log10(20000.0);
      const ratio = Math.max(0, Math.min(1, x / w));
      return Math.pow(10, minLog + ratio * (maxLog - minLog));
    }
    function gainToY(gain, h) {
      const maxDb = 18.0;
      const norm = gain / maxDb; // -1 to +1
      return (h / 2) - (norm * (h / 2) * 0.85);
    }
    function yToGain(y, h) {
      const maxDb = 18.0;
      const norm = ((h / 2) - y) / ((h / 2) * 0.85);
      return Math.max(-18.0, Math.min(18.0, norm * maxDb));
    }
    function computeEqResponseAtFreq(f) {
      let totalGainDb = 0.0;
      for (const b of eqBands) {
        if (Math.abs(b.gain) < 0.05) continue;
        const ratio = f / b.freq;
        const logRatio = Math.abs(Math.log2(ratio));
        // Approximate bell/shelf transfer curve
        const bandwidth = 1.0 / b.q;
        if (b.type === "peaking") {
          const bell = Math.exp(-Math.pow(logRatio / (bandwidth * 0.7), 2));
          totalGainDb += b.gain * bell;
        } else if (b.type === "lowshelf") {
          if (f <= b.freq) totalGainDb += b.gain;
          else {
            const decay = Math.exp(-Math.pow(logRatio / 0.5, 2));
            totalGainDb += b.gain * decay;
          }
        } else if (b.type === "highshelf") {
          if (f >= b.freq) totalGainDb += b.gain;
          else {
            const decay = Math.exp(-Math.pow(logRatio / 0.5, 2));
            totalGainDb += b.gain * decay;
          }
        }
      }
      return totalGainDb;
    }
    function drawEqSpline() {
      const canvas = document.getElementById("eqCanvas");
      if (!canvas) return;

      // Ensure internal pixel buffer strictly matches client display size (fixes stretching/blur)
      const rect = canvas.getBoundingClientRect();
      if (canvas.width !== Math.round(rect.width) || canvas.height !== Math.round(rect.height)) {
        canvas.width = Math.max(100, Math.round(rect.width));
        canvas.height = Math.max(50, Math.round(rect.height));
      }

      const ctx = canvas.getContext("2d");
      const w = canvas.width;
      const h = canvas.height;

      // Clear & Background Grid
      ctx.fillStyle = "#090a0c";
      ctx.fillRect(0, 0, w, h);

      // Render FFT spectrum directly behind EQ curve with subtle low-contrast studio fill
      if (analyzerEnabled && masterSpectrumBins && masterSpectrumBins.length > 0) {
        ctx.beginPath();
        for (let i = 0; i < masterSpectrumBins.length; ++i) {
          const t = i / (masterSpectrumBins.length - 1);
          const px = t * w;
          const db = masterSpectrumBins[i];
          const clampedDb = Math.max(-90, Math.min(0, db));
          const py = h - ((clampedDb + 90) / 90) * (h - 6);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.lineTo(w, h);
        ctx.lineTo(0, h);
        ctx.closePath();
        const specGrad = ctx.createLinearGradient(0, 0, 0, h);
        specGrad.addColorStop(0, "rgba(56, 189, 248, 0.20)");
        specGrad.addColorStop(1, "rgba(30, 64, 175, 0.03)");
        ctx.fillStyle = specGrad;
        ctx.fill();

        ctx.beginPath();
        for (let i = 0; i < masterSpectrumBins.length; ++i) {
          const t = i / (masterSpectrumBins.length - 1);
          const px = t * w;
          const clampedDb = Math.max(-90, Math.min(0, masterSpectrumBins[i]));
          const py = h - ((clampedDb + 90) / 90) * (h - 6);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = "rgba(56, 189, 248, 0.35)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Grid frequency lines (100Hz, 1kHz, 10kHz)
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
      [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].forEach(f => {
        const gx = freqToX(f, w);
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, h);
        ctx.stroke();
        if ([100, 1000, 10000].includes(f)) {
          ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
          ctx.font = "9px 'Geist Mono', monospace";
          ctx.fillText(f >= 1000 ? `${f/1000}k` : `${f}`, gx + 4, 12);
        }
      });

      // Horizontal 0 dB line & +/-12dB
      const y0 = gainToY(0, h);
      ctx.strokeStyle = "rgba(56, 189, 248, 0.2)";
      ctx.beginPath();
      ctx.moveTo(0, y0);
      ctx.lineTo(w, y0);
      ctx.stroke();

      // Plot Combined Transfer Curve
      ctx.beginPath();
      for (let px = 0; px <= w; px += 2) {
        const freq = xToFreq(px, w);
        const gainDb = computeEqResponseAtFreq(freq);
        const py = gainToY(gainDb, h);
        if (px === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = "#e2e8f0";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Shaded area under curve
      ctx.lineTo(w, y0);
      ctx.lineTo(0, y0);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, "rgba(56, 189, 248, 0.25)");
      grad.addColorStop(1, "rgba(56, 189, 248, 0.02)");
      ctx.fillStyle = grad;
      ctx.fill();

      // Render Draggable Control Nodes
      eqBands.forEach((b, i) => {
        const bx = freqToX(b.freq, w);
        const by = gainToY(b.gain, h);

        ctx.beginPath();
        ctx.arc(bx, by, 6, 0, 2 * Math.PI);
        ctx.fillStyle = draggedEqBandIdx === i ? "#ffffff" : "#e2e8f0";
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#090a0c";
        ctx.stroke();

        // Node Label
        ctx.fillStyle = "#f3f4f6";
        ctx.font = "bold 9px 'Geist Mono', monospace";
        ctx.fillText(`B${b.id}`, bx - 5, by - 9);
      });
    }
    function renderEqInspectors() {
      const container = document.getElementById("eqBandInspectors");
      if (!container) return; // Embedded canvas layout uses direct legend & tooltips
      container.innerHTML = eqBands.map((b, i) => `
        <div style="background: var(--bg-panel); border: 1px solid var(--border-dim); padding: 6px; border-radius: 4px; text-align: center;">
          <div style="font-size: 9px; font-weight: 700; color: var(--accent); font-family: var(--font-mono);">BAND ${b.id} (${b.type.toUpperCase().slice(0, 4)})</div>
          <div style="font-size: 11px; font-weight: 700; color: #ffffff; font-family: var(--font-mono); margin: 2px 0;">${b.gain >= 0 ? '+' : ''}${b.gain.toFixed(1)} dB</div>
          <div style="font-size: 9px; color: var(--text-faint); font-family: var(--font-mono);">${Math.round(b.freq)} Hz · Q ${b.q.toFixed(2)}</div>
        </div>
      `).join("");
    }
    function initEqCanvas() {
      const canvas = document.getElementById("eqCanvas");
      if (!canvas) return;
      
      const onDown = (e) => {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const w = canvas.width;
        const h = canvas.height;

        // Find closest band node within 25px
        let closestIdx = null;
        let minD = 25;
        eqBands.forEach((b, i) => {
          const bx = freqToX(b.freq, w);
          const by = gainToY(b.gain, h);
          const d = Math.hypot(bx - mx, by - my);
          if (d < minD) {
            minD = d;
            closestIdx = i;
          }
        });

        if (closestIdx !== null) {
          draggedEqBandIdx = closestIdx;
          drawEqSpline();
        }
      };

      const onMove = (e) => {
        if (draggedEqBandIdx === null) return;
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const w = canvas.width;
        const h = canvas.height;

        const newFreq = Math.round(xToFreq(mx, w));
        const newGain = parseFloat(yToGain(my, h).toFixed(1));

        eqBands[draggedEqBandIdx].freq = newFreq;
        eqBands[draggedEqBandIdx].gain = newGain;

        drawEqSpline();
        renderEqInspectors();
      };

      const onUp = async () => {
        if (draggedEqBandIdx !== null) {
          const b = eqBands[draggedEqBandIdx];
          draggedEqBandIdx = null;
          drawEqSpline();
          await fetch("/api/mixer", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ equalizer_band: { index: b.id - 1, freq: b.freq, gain: b.gain, q: b.q } })
          });
        }
      };

      const onWheel = async (e) => {
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const w = canvas.width;
        const h = canvas.height;

        // Find target band under cursor
        let targetIdx = null;
        eqBands.forEach((b, i) => {
          const bx = freqToX(b.freq, w);
          const by = gainToY(b.gain, h);
          if (Math.hypot(bx - mx, by - my) < 30) targetIdx = i;
        });

        if (targetIdx !== null) {
          e.preventDefault();
          const delta = e.deltaY < 0 ? 0.15 : -0.15;
          const b = eqBands[targetIdx];
          b.q = Math.max(0.2, Math.min(8.0, b.q + delta));
          drawEqSpline();
          renderEqInspectors();
          await fetch("/api/mixer", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ equalizer_band: { index: b.id - 1, q: b.q } })
          });
        }
      };

      canvas.onmousedown = onDown;
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      canvas.onwheel = onWheel;

      drawEqSpline();
      renderEqInspectors();
    }
    function handleMetroVolChange(val) {
      const num = Math.max(0, Math.min(2.0, parseFloat(val)));
      const pct = Math.round(num * 100);
      document.getElementById("metroVolText").innerText = num > 1.0 ? `Boost ${pct}%` : `${pct}%`;
      const fillPct = (num / 2.0) * 100;
      const fill = document.getElementById("metroVolFill");
      const thumb = document.getElementById("metroVolThumb");
      if (fill) fill.style.width = `${fillPct}%`;
      if (thumb) thumb.style.left = `${fillPct}%`;
      updateMixer('metronome_volume', num);
    }
    function startMetroFaderDrag(e) {
      const wrap = document.getElementById("metroVolWrap");
      if (!wrap) return;
      const onMove = (ev) => {
        const rect = wrap.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
        const val = ratio * 2.0;
        handleMetroVolChange(val);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      onMove(e);
      e.preventDefault();
    }
    function startDesktopFxTopFaderDrag(e) {
      const wrap = document.getElementById("dtFxTopVolWrap");
      if (!wrap) return;
      const onMove = (ev) => {
        const rect = wrap.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
        valFx = ratio * 1.5;
        const db = valFx > 0 ? (20 * Math.log10(valFx)).toFixed(1) : "-inf";
        const el1 = document.getElementById("fxPadVolText");
        if (el1) el1.innerText = `${db} dB`;
        const el2 = document.getElementById("desktopFxBusVolText");
        if (el2) el2.innerText = `${db} dB`;
        
        const pct = (valFx / 1.5) * 100;
        const fTop = document.getElementById("dtFxTopVolFill");
        const thTop = document.getElementById("dtFxTopVolThumb");
        if (fTop) fTop.style.width = `${pct}%`;
        if (thTop) thTop.style.left = `${pct}%`;

        renderCustomFaders();

        fetch("/api/fx-pads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "bus", volume: valFx })
        }).catch(console.error);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      onMove(e);
      e.preventDefault();
    }
    async function updateMixer(key, val) {
      const payload = {};
      payload[key] = val;
      await fetch("/api/mixer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    }
    async function toggleMetronome() {
      await fetch("/api/mixer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toggle_metronome: true })
      });
      const btn = document.getElementById("metroBtn");
      btn.innerText = btn.innerText.includes("Off") ? "Click [On]" : "Click [Off]";
    }
