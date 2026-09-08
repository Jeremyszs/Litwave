# Litwave

Desktop practice environment and mobile companion for keyboardists, integrating the Yamaha MONTAGE M (and Community SoundFont VST fallback), deep MIR chord/key analysis, ambient worship drone pad, MPC-style 48-pad performance sampler, and live stage telemetry.

---

## 1. Architecture & Data-Flow Overview

The application couples an asynchronous Python backend (Starlette / asyncio) with an in-browser Web Audio / HTML5 interface and a mobile PWA remote.

```
                    +-----------------------------+
                    |  Browser Client / PWA Remote |
                    +--------------+--------------+
                                   |
                     HTTP REST /   |   WebSocket (/ws)
                  JSON Endpoints   |   Telemetry (25 fps)
                                   v
                    +-----------------------------+
                    |   Starlette ASGI Server     |
                    |      (src/server.py)        |
                    +--------------+--------------+
                                   |
         +-------------------------+-------------------------+
         |                         |                         |
         v                         v                         v
+------------------+     +------------------+     +--------------------+
|   AppState       |     |  Domain Handlers |     |  Hardware Engines  |
| (src/runtime.py) |     |  (Modular APIs)  |     |   (Deferred Boot)  |
+------------------+     +------------------+     +--------------------+
         |                         |                         |
         |-- SetlistManager        |-- api_fx_pads           |-- AudioEngine
         |-- PlaylistManager       |-- api_playlist          |   (miniaudio,
         |-- WS Clients            |-- api_montage           |    sounddevice)
         |-- Lifespan Mgr          |-- api_practice          |-- MidiManager (mido)
                                   |-- api_setlist           |-- MontageHost (UDP)
                                   |-- api_analysis          |-- DronePadManager
                                                             |-- EarTrainingMgr
```

### Key Architectural Boundaries

- **`src/runtime.py`**: Owns `AppState` and Starlette lifespan context (`create_lifespan`). Modules can import `src.runtime` and `src.server` safely with zero side-effects—hardware initialization (audio stream, MIDI worker thread, VST UDP communication, background monitor loop) is strictly deferred to `AppState.boot()` during Starlette startup.
- **`src/server.py`**: Exposes the Starlette HTTP routes, static mounts, and WebSocket endpoint. Injects `AppState` into modular route factory handlers.
- **`src/api_*.py`**: Dedicated API handler modules:
  - `src/api_fx_pads.py`: Bank selection (A-F), pad trigger, bus mute/volume, pad customization.
  - `src/api_playlist.py`: Playlist retrieval, active song loading, file upload.
  - `src/api_montage.py`: VST editor controls, voice catalog, part/master volume, scene snapshots, custom labeling, voicing audition, master DSP (warmth/analyzer).
  - `src/api_practice.py`: Ear training exercises, ambient drone pad state & controls.
  - `src/api_setlist.py`: Setlist CRUD, reordering, patch snapshots, patch application.
  - `src/api_analysis.py`: MIR song analysis runner with executor isolation and synced lyrics fetching.
- **`src/static/`**: Clean browser client assets (desktop studio `index.html`, phone stage remote `remote.html`, service worker `sw.js`).

---

## 2. Frontend Static-Module Loading Order

Both desktop (`src/static/index.html`) and remote (`src/static/remote.html`) interfaces load client scripts in this strict order:

1. **`/static/chord_timeline.js`**
   - Core music theory utilities, `CHORD_LIBRARY`, Nashville number calculation (`getChordWithNashville`), advanced chord detection (`detectAdvancedChord`), and timeline interval search (`chordAtTime`, `nextPlayableChord`).
   - UMD bundle: exposes `ChordTimeline` namespace and backwards-compatible globals.
2. **`/static/browser_api.js`**
   - Shared HTTP request abstractions (`requestJson`, `getJson`, `postJson`), formatting helpers (`formatTime`, `formatTimeWithMs`), CSS custom property resolution (`resolveCssToken`), FX pad color definitions (`FX_PAD_PALETTE`), pad animations (`animateFxPadPulse`), and toast messaging.
   - UMD bundle: exposes `BrowserApi` namespace and backwards-compatible globals.
3. **`/static/ws_telemetry.js`**
   - Resilient WebSocket connection manager (`createWsClient`), exponential backoff with jitter (`calculateBackoff`), automatic reconnect lifecycle, and message dispatcher.
   - UMD bundle: exposes `WsTelemetry` namespace and backwards-compatible globals.
4. **Inline Application Scripts (`<script> ... </script>`)**
   - UI binding, event listeners, canvas rendering, and DOM manipulation.

---

## 3. Setup & Dependencies

### Python Environment
- Python 3.11+
- Key dependencies: `starlette`, `uvicorn`, `sounddevice`, `miniaudio`, `mido`, `librosa`, `numpy`, `scipy`.
- Installed in the project virtual environment (`.venv`).

### Node.js
- Node.js 18+ (tested on Node v22)
- Used for static script syntax checking and frontend unit verification (pure stdlib, no npm build step needed).

---

## 4. Verification & Testing

Pytest is not installed in the target environment. All test suites use standalone assertion scripts and exit with code `0` on success.

### Safe No-Hardware Verification (Automated CI / Dev Check)

These commands run purely in memory or with mock states, creating no audio streams, MIDI ports, or VST host processes:

```bash
# Frontend extraction & contract checks (Node.js vm & CommonJS)
node tests/check_frontend_extraction.js
node tests/check_chord_timeline.js

# Architecture, imports, and lifespan safety (Python stdlib AST)
python tests/check_architecture_slice1.py
python tests/check_runtime_extraction.py

# Modular API contracts & dummy-state handlers
python tests/check_fx_pads_api.py
python tests/check_playlist_api.py
python tests/check_montage_api.py
python tests/check_practice_api.py
python tests/check_setlist_api.py
python tests/check_analysis_api.py

# Overall documentation and contract regression
python tests/check_doc_and_quality.py
```

### Syntax and Diff Checks

```bash
# Python bytecode compilation across source and tests
python -m py_compile src/*.py tests/*.py

# Git whitespace and change verification
git diff --check
```

---

## 5. Running the Application (Normal / Live Studio)

To launch the full live studio with hardware bindings:

```bash
# Using project python
python src/main.py
```

This will:
1. Boot `AppState` and bind audio/MIDI engines.
2. Bind Starlette on `http://0.0.0.0:8080`.
3. Auto-open default browser to `http://127.0.0.1:8080`.
4. Provide mobile companion at `http://<LAN_IP>:8080/remote`.

---

## 6. Hardware & Native-Host Cautions

- **Never import hardware drivers at module level**: All imports that interact with external hardware (`sounddevice`, `mido`, `miniaudio`, or native socket callers) must remain inside `AppState.boot()` or isolated functions. Importing `src.server` or `src.runtime` must always be safe and side-effect free.
- **Native Host Ports**:
  - UDP 9000: Default command communication with the Montage / VST host engine.
  - UDP 9001: Telemetry and spectrum bin returns.
  - Do not run duplicate instances of the DAW simultaneously to avoid UDP socket collision.
- **ASIO / Audio Drivers**:
  - Do not call `audio.start_stream()` during test scripts or offline batch analyses. Device enumeration without proper cleanup can crash ASIO drivers on Windows.
- **Service Worker (`sw.js`)**:
  - `sw.js` caches static assets for offline remote use. It is explicitly configured to bypass caching for `/api/*`, `/ws`, `/static/uploads/*`, and root desktop navigation (`/`). Do not remove these bypass guards.

---

## 7. Branch & Change Conventions

- **Branch naming**: `refactor/<topic>`, `feat/<feature>`, `fix/<issue>`.
- **Minimal Diffs**: Keep changes focused; avoid cosmetic refactors of working audio algorithms or HTML templates.
- **Pre-existing tracked & untracked files**: Always preserve local configuration files (`master_dsp_settings.json.tmp`, `saved_playlist.json`, `saved_setlists.json`, `dump_params.cpp`) byte-for-byte.
