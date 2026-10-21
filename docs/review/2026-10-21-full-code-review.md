# Litwave — Full Code Review Report

- **Date:** 2026-10-21
- **Commit reviewed:** `97cb717` (branch `ccr-baf772ac-qfiljy`)
- **Scope:** the whole repository: Python backend (`src/*.py`), native C++ hosts (`cpp_host/`), the new frontend (`src/static/js`, `css`, `sw.js`, HTML), the classic UI and dead legacy assets, tests, packaging and docs. Vendored `miniaudio.h`, `tsf.h` and `vendor/qrcode.js` were not reviewed except where our code calls them.
- **Nature of this document:** a list of *defects only*. On purpose, it contains **no fixes and no hints toward a solution**. Each entry says where the problem is, what is wrong, and a concrete way it fails. Agents picking these up should check each one against the current code before working on it, since line numbers drift.

## How to read this report

- **IDs:** `PY-*` Python backend · `CPP-*` C++ hosts and UDP protocol · `FE-*` new frontend · `LEG-*` classic UI and dead files · `TST-*` tests · `HYG-*` repo hygiene, packaging, docs.
- **Severity:**
  - **Critical:** exploitable or data-destroying in normal use.
  - **High:** breaks a core feature, corrupts data, or causes audible failure on stage.
  - **Medium:** wrong behaviour in realistic conditions.
  - **Low:** quality, consistency, edge cases.
- **Category words used in titles:** *bug* (wrong behaviour), *mistake* (wrong design or contract), *better approach* (works, but in a way that is fragile or expensive), *improvement* (missing quality).
- **Reproduced** means the scenario was run in a scratch script or the test suite during this review. Everything else was confirmed by reading the code paths end to end.
- **Overlaps:** some items describe one defect from two sides (for example the custom FX sample upload is PY-38 and is mentioned under the frontend). Each is listed once in full and cross-referenced elsewhere.

## Summary

| Area | Critical | High | Medium | Low |
|---|---:|---:|---:|---:|
| Python backend (PY) | 1 | 11 | 28 | 8 |
| C++ hosts and UDP contract (CPP) | 0 | 12 | 22 | 14 |
| New frontend (FE) | 0 | 6 | 13 | 19 |
| Classic UI and legacy files (LEG) | 0 | 1 | 3 | 1 |
| Tests (TST) | 0 | 2 | 5 | 1 |
| Hygiene, packaging, docs (HYG) | 0 | 1 | 4 | 3 |

**Test run during review** (clean container, Python 3.13, Node 22, optional dependencies installed):
- **Passed:** all Node checks, the e2e suite (30/30), and 15 Python checks.
- **Failed:** `check_scene_bookmark_sync`, `check_adversarial_safety`.
- **Could not run** (librosa/PortAudio missing): `check_analyzer`, `check_device_hotplug`.
- **Without the optional packages:** 16 of 17 Python checks fail on import.

### Themes behind most of the defects

1. **Trust boundary:** the whole control surface is unauthenticated, bound to all interfaces, and can be exposed through a public tunnel. Browser cross-origin requests are not blocked (PY-01, PY-02, LEG-01).
2. **Real-time safety:** locks, file I/O, allocation, socket calls and long DSP jobs sit on or block the audio callbacks, in both Python and C++ (PY-10, PY-13, CPP-07, CPP-08, CPP-09).
3. **One audio path versus two:** Python and the native host both render and output the backing mix, at different sample rates, through an unbounded and undersized PCM link (CPP-03 to CPP-06, PY-11).
4. **Unstable identifiers and non-atomic persistence:** IDs come from list length, files are rewritten in place, and failed loads silently reset to defaults (PY-30, PY-34, PY-35).
5. **Developer-machine coupling:** absolute `C:\Users\Jeremy Rukmana\…` paths, personal seed data, and samples and binaries that are not in git (PY-31, PY-32, PY-60, HYG-01, HYG-04).
6. **Event-loop blocking and oversized telemetry:** synchronous network, disk and subprocess work inside async handlers, plus about 40 KB frames per client at 25 fps (PY-40, PY-41, FE-06).
7. **Client/server contract drift:** wrong action semantics, range mismatches, stale-state merging, and duplicated sources of truth (FE-01 to FE-03, PY-37, PY-43, PY-53).

### Highest-impact items (read these first)

| # | ID | One-line description |
|---|---|---|
| 1 | PY-01 | No auth/CSRF/Origin checks; LAN-wide and optionally internet-wide control of the rig |
| 2 | PY-02 / LEG-01 | Arbitrary file upload into the served static folder; stored XSS in the classic setlist |
| 3 | CPP-03 | Backing track, metronome and pads played twice (Python output + native host) |
| 4 | CPP-04 / CPP-06 | 44.1 vs 48 kHz mismatch on the PCM link; 512-frame packets exceed the receive buffer |
| 5 | PY-10 | Song load / pitch shift / chart save holds the lock the audio callback needs: multi-second dropouts |
| 6 | PY-12 | Metronome sync puts the click at the mirrored phase with the accent one beat off (reproduced) |
| 7 | PY-11 | Click tempo, FX pad pitch and EQ frequencies wrong on any non-48 kHz device |
| 8 | CPP-01 / CPP-02 | Dangling SysEx pointer; two-producer MIDI ring corrupts or drops notes (stuck notes) |
| 9 | CPP-07 / CPP-08 / CPP-09 | Disk loads and unsynchronised synth access on the native audio path |
| 10 | PY-30 | Setlist/song/marker ID collisions delete or alter the wrong items (reproduced) |
| 11 | PY-31 / PY-32 / PY-60 | On a fresh clone: all FX pads silent and no synth engine ever starts |
| 12 | PY-40 / PY-41 | Lyrics fetch and other blocking work freeze every client; huge per-client telemetry frames |
| 13 | FE-01 / FE-03 / FE-05 | Stale analysis carried across songs; section click disables the loop; duplicate WebSocket connections |
| 14 | PY-38 | Replacing an FX pad sample replaces the backing track and leaves the pad silent |

---

## 2. Python backend (`src/*.py`)

### 2.1 Security and exposure

#### PY-01 — Critical — No authentication, CSRF or Origin checks on the whole control API, served on all interfaces and optionally through a public tunnel
- **Where:** `src/main.py:51`, `src/main.py:62` (`host="0.0.0.0"`); `src/server.py:411-443` (every route); `src/server.py:278-281` (`/ws`); `src/server.py:342-362` (tunnel URL discovery); `src/api_validation.py:66-74`.
- **Defect:** Every endpoint is unauthenticated. That covers transport, uploads, engine kill/launch (`/api/montage/editor`), launching the Steinberg activation manager (`/api/montage/license`), setlist deletion, writing names and settings, and picking the audio device. The server listens on every interface. `api_remote_info` also looks up a public tunnel URL (Litwave's own, or the third-party "9router" tunnel's `state.json`) and advertises it as the preferred phone URL. That puts the whole API on the internet with no credentials. Nothing checks `Origin` or `Content-Type`: `validated()` and the handlers parse any body with `json.loads` whatever its content type, and the WebSocket accepts every handshake.
- **Failure scenario:** (a) Anyone on the same venue or church Wi-Fi can stop playback mid-service, kill the synth engine, or delete setlists. (b) A web page open in the user's normal browser sends `fetch("http://127.0.0.1:8080/api/montage/editor", {method:"POST", mode:"no-cors", body:'{"action":"kill"}'})`. That is a "simple" request with `text/plain`, so no CORS preflight happens; the server parses the body as JSON and kills the engine. (c) A malicious page opens `new WebSocket("ws://127.0.0.1:8080/ws")` and reads live telemetry. (d) If the tunnel is active, anyone on the internet who learns the URL gets the same control.

#### PY-02 — High — Song upload accepts any file type and size and stores it under the public static mount
- **Where:** `src/api_playlist.py:47-69`; `src/server.py:241-244`, `src/server.py:442`.
- **Defect:** `handle_upload_song` writes whatever it receives to `src/static/uploads/<basename>`, and that folder is served by `StaticFiles` at `/static/uploads/…`. Nothing checks the extension, the content or the size. The whole upload is read into memory with `await file.read()` and written with blocking I/O on the event loop. An existing file with the same name is silently overwritten, even the song that is playing. A form field named `file` that is a plain string (not a file) raises `AttributeError` on `.filename`, which gives a 500. An empty filename makes `dest_path` the directory itself (`IsADirectoryError`, 500).
- **Failure scenario:** Uploading `x.html` that contains script and then opening `/static/uploads/x.html` runs that script on the app's origin, which can drive every API (stored XSS). Uploading a multi-GB file exhausts memory and blocks the loop. Uploading a new "Song.mp3" replaces the stored file and its `.chords.json` sidecar now describes a different recording.

#### PY-03 — Medium — The FX pad `sample_path` is a client-controlled absolute filesystem path
- **Where:** `src/api_fx_pads.py:85-95`; `src/fx_sampler.py:220-244`, `src/fx_sampler.py:288-295`.
- **Defect:** `update_pad` stores any `sample_path` string and decodes that path from disk. Nothing limits it to the asset folder and there is no size cap. `get_status()` returns every pad's absolute path to every client over HTTP and in each WebSocket frame.
- **Failure scenario:** A LAN client points a pad at a large file anywhere on disk, and decoding it eats memory and CPU. Clients learn the Windows user name and folder layout from the absolute paths in telemetry.

#### PY-04 — Medium — Third-party remote code runs at analysis time
- **Where:** `src/analyzer.py:114-131`.
- **Defect:** The first analysis downloads the Hugging Face repository `puar-playground/btc-chord` and loads it with `trust_remote_code=True`, which executes Python from that repo with the user's privileges. The revision is pinned (good), but the trust decision is implicit, the download needs internet the first time, and a failure only shows up as a generic 500.
- **Failure scenario:** At an offline venue the first "Analyze" always fails. If the pinned revision were ever changed to a moving reference, arbitrary code would run.

#### PY-05 — Low — Song file names go to a third-party service without the user knowing
- **Where:** `src/lyrics.py:128-171`, `src/api_analysis.py:75-82`.
- **Defect:** Every analysis automatically sends search terms built from the local file name to `lrclib.net`. The UI and README don't disclose this.

### 2.2 Real-time audio path (`audio_engine.py`, `song_player.py`, `metronome.py`, `fx_sampler.py`, `equalizer.py`)

#### PY-10 — High — Long operations hold the lock that the audio callback needs, so the whole output drops out
- **Where:** `src/song_player.py:60-111` (`load_file` decodes and resamples with soxr while holding `self.lock`); `src/song_player.py:421-436` (`set_pitch_shift` runs `librosa.effects.pitch_shift` on the full song under the lock); `src/song_player.py:395-419` (`resample_to_current_rate`); `src/song_player.py:237-257` (`_persist_chart`, with `fsync`, called under the lock from `record_chord`, `add_marker`, `update_marker`, `remove_marker`, `clear_*`); `src/song_player.py:438-447` (the callback takes the same lock).
- **Defect:** `SongPlayer.get_audio_block` runs on the PortAudio callback thread and blocks on `self.lock`. Decoding, resampling and full-song pitch shifting take seconds and hold that lock the whole time. Disk `fsync` holds it for milliseconds to hundreds of milliseconds. All of them run on the asyncio thread, so every HTTP request and WebSocket stream freezes too.
- **Failure scenario:** While the metronome or FX pads are playing, the user loads a new song or moves the pitch control by one semitone. The callback misses its deadline for several seconds, so the metronome, pads and every other source go silent or glitch, and the UI stops updating. Recording a chord or adding a marker during playback can cause an audible dropout on a slow disk.

#### PY-11 — High — Changing the output sample rate leaves the metronome, FX sampler and EQ at the old rate
- **Where:** `src/audio_engine.py:105-121`; `src/metronome.py:445`, `src/metronome.py:461-464`; `src/fx_sampler.py:220-231`; `src/equalizer.py:325-329` (`set_samplerate` is never called).
- **Defect:** `start_stream` adopts the device's default rate (often 44100 Hz) and only updates `song_player.target_samplerate` and `metronome.samplerate`. The metronome's `sample_interval` and its pre-rendered click buffers stay at the construction rate. FX samples stay decoded at 48 kHz and the voices don't compensate for the rate. The EQ's biquad coefficients stay computed for 48 kHz. The first `start_stream` at boot hits this whenever the default device isn't 48 kHz.
- **Failure scenario:** On a 44.1 kHz interface the click runs at 120 × 44100/48000 ≈ 110 BPM while the UI shows 120 and the song plays correctly, so the click drifts against the track. Every FX pad plays about 1.5 semitones flat and slower. EQ bands sit about 8% lower than their labels say.

#### PY-12 — High — `Metronome.sync_to_playhead` gets both the phase and the accent wrong
- **Where:** `src/metronome.py:466-487` against `src/metronome.py:525-535`.
- **Defect:** `get_audio_block` treats `frame_counter` as *frames elapsed since the last click*: it clicks at 0 and counts upward. `sync_to_playhead` instead stores *time to the next beat* in it, which mirrors the phase. It also sets `current_beat` to the index of the beat that is already under way. The callback then clicks that index before advancing it, so the next click carries the previous beat's accent. The pre-downbeat branch has the same inversion.
- **Failure scenario (reproduced):** 60 BPM, `sync_to_playhead(0.1, 0.0)`. The next click should come at +0.9 s as beat 2 (unaccented). It actually sounds at +0.1 s, accented. Every play, seek and metronome toggle during playback therefore puts the click off the song's beat grid by `2 × phase`, with the downbeat accent shifted one beat.

#### PY-13 — High — The audio callback makes socket syscalls, allocates and runs Python per sample
- **Where:** `src/audio_engine.py:150-235`; `src/metronome.py:525-545`; `src/fx_sampler.py:361-426`; `src/equalizer.py:405-414`.
- **Defect:** Each callback does the following:
  - `sendto` of up to 4 KB to the native host, then `setblocking(False)` and `recvfrom`;
  - an `import struct` inside the callback;
  - about a dozen temporary NumPy arrays (`zeros`, products, `concatenate`, `interp`, `linspace`, `astype` in the EQ);
  - one temporary array per active FX voice;
  - a pure-Python loop over every frame in `Metronome.get_audio_block`, which runs even when the metronome is off.

  All of this needs the GIL, which it shares with the asyncio server, the MIDI thread, the monitor thread and the librosa/torch analysis thread.
- **Failure scenario:** At small block sizes (64–128 frames, which ASIO users pick), a GC pause, JSON serialisation of a large telemetry frame, or the analysis thread holding the GIL makes the callback miss its deadline and produce xruns. The metronome loop alone costs a measurable share of the period at 64 frames.

#### PY-14 — Medium — Two threads read the same UDP socket, so meter replies go to the wrong reader
- **Where:** `src/audio_engine.py:175-206` (callback thread) and `src/audio_engine.py:237-262` (`query_vst_meters`, called from `get_telemetry` on the asyncio thread once per WebSocket client per 40 ms tick and from `/api/status`).
- **Defect:** Both paths share `self.udp_sock`. Each sends a request and does a non-blocking `recvfrom`, so either one can consume the reply the other asked for. `get_telemetry` also overwrites `peak_left_db`/`peak_right_db` with a synth-only value whenever the song isn't playing, while the callback writes a different formula into the same fields. The master-L/R values decoded from the native packet (`ml_peak`, `mr_peak`) are overwritten a few lines later and never used.
- **Failure scenario:** The meters flicker between two different computations, and the "master" meter doesn't reflect the native host's real master output. With N clients connected, the server sends 25 × N meter queries per second.

#### PY-15 — Medium — Metering and clip detection are computed incorrectly
- **Where:** `src/audio_engine.py:211-235`.
- **Defect:** `peak_l` and `peak_r` are measured *after* master gain and the tanh limiter, then multiplied by `master_volume` again. Because tanh keeps the output below 1.0, `is_clipping` reflects `master_volume × post-limiter peak` rather than any real overload. The FX meter is taken before master gain.
- **Failure scenario:** At `master_volume = 1.2` the clip light turns on for a mix that never exceeds 0.85. At `master_volume = 0.5` a mix being driven hard into tanh never shows a clip.

#### PY-16 — Medium — The "soft limiter" is a full-range tanh on the master bus
- **Where:** `src/audio_engine.py:171-172`.
- **Defect:** `np.tanh` is applied to the whole mix all the time. It has no threshold or knee, so it compresses and colours normal-level material too: tanh(0.8) ≈ 0.66, about 1.6 dB of gain reduction and odd harmonics at a typical level. Track gain goes up to 1.5 and master gain up to 2, which makes heavy saturation reachable from the default faders.
- **Failure scenario:** The backing track sounds quieter and more distorted than the source even when nothing would clip, and A/B comparisons against the original recording are misleading.

#### PY-17 — Medium — Speed control is varispeed with block-edge artefacts
- **Where:** `src/song_player.py:453-495`.
- **Defect:** The speed range 0.5–1.5 is implemented by reading `round(n × speed)` source frames and linearly resampling them to `n` output frames, independently for each block. Pitch changes along with tempo, which practice users won't expect: the docs call it "Speed / Tempo scaling", and pitch shifting is a separate control. The fractional read position isn't carried between blocks, so the interpolation grid restarts at every block edge (each block maps `[0, k-1]` onto `[0, n-1]`) and adds a periodic discontinuity at the block rate. Speeds above 1 have no anti-aliasing filter.
- **Failure scenario:** At 0.8× the song plays about 3.9 semitones flat. The keyboardist practising along is now in the wrong key, and a faint buzz at about 187 Hz (48000/256) appears on sustained material.

#### PY-18 — Medium — Short, final and loop-wrap chunks get stretched to fill the block
- **Where:** `src/song_player.py:459-492`.
- **Defect:** The end-of-song chunk and loop-wrap chunks can be shorter than `frames_to_read`, for example when a loop is shorter than one block or `loop_b` lies past the end of the file. They go through the same `np.interp` stretch to `num_frames`, which time-stretches the audio inside that block instead of zero-padding it.
- **Failure scenario:** The last block of every song, and every wrap of a very short A–B loop, plays a pitch-warped fragment.

#### PY-19 — Medium — FX bus mute freezes voices instead of stopping them, and voices pile up
- **Where:** `src/fx_sampler.py:364-365`, `src/fx_sampler.py:333-338`.
- **Defect:** When `bus_muted` is set (or the volume is near zero), `get_audio_block` returns before advancing or pruning voices. Triggers while muted still append voices, and nothing removes them. Voice stealing counts voices that are already fading as active and keeps picking the same oldest voice (`start_fade_out` doesn't act on a voice that is already fading), so polyphony isn't actually capped.
- **Failure scenario:** The user mutes the FX bus, keeps tapping pads, then unmutes: every pad tapped while muted starts at once from where it was frozen, as a loud burst.

#### PY-20 — Medium — The WAV fallback decoder is wrong for several formats
- **Where:** `src/fx_sampler.py:245-273`.
- **Defect:** The file's sample rate `sr` is read but never used, so there is no resampling. 32-bit PCM is reinterpreted as `float32`; the `wave` module only opens integer PCM, so this branch always produces garbage. 24-bit decoding uses a pure-Python loop over every sample.
- **Failure scenario:** A custom 32-bit integer WAV that miniaudio can't decode plays as full-scale noise.

#### PY-21 — Low — EQ coefficients are updated non-atomically while the callback filters
- **Where:** `src/equalizer.py:355-403`, `src/server.py:169-189`.
- **Defect:** `_recompute_coefficients` writes `self.sos` row by row from the asyncio thread while `sosfilt` reads it on the audio thread. The coefficients are float32, which loses precision for low-frequency shelves. The API accepts a gain of ±36 and a Q of 0.05–50, while the EQ silently clips to ±18 and 0.1–12, so the response echoes a value that was never applied.
- **Failure scenario:** Dragging an EQ handle during playback can occasionally filter one block with a mixed old/new section, which clicks.

### 2.3 Data integrity and persistence

#### PY-30 — High — Setlist, song and marker IDs come from list length and collide after a deletion
- **Where:** `src/setlist_manager.py:55` (`setlist_{len+1}`), `src/setlist_manager.py:97` (`song_{len+1}`), `src/song_player.py:346` (marker `id = len+1`).
- **Defect:** IDs are reused after any removal.
- **Failure scenario (reproduced):** Create A and B, delete A, create C, and the setlists are `['sunday_morning', 'setlist_3', 'setlist_3']`. Selecting C opens B (first match). Deleting either one deletes both. Markers behave the same way: add a, add b, remove a, add c gives ids `[2, 2]`, and "Delete section" on one then removes both, while "rename" changes only the first.

#### PY-31 — High — The committed seed `fx_pads_settings.json` contains the developer's absolute Windows paths
- **Where:** `src/fx_pads_settings.json` (48 entries such as `C:\Users\Jeremy Rukmana\projects\montage-practice-daw\assets\…`); `src/user_data.py:288-298`; `src/fx_sampler.py:141-155`.
- **Defect:** On first run the seed is copied into `data/`. Its absolute `sample_path` values override the manifest's relative paths, and `persist_settings` keeps writing absolute paths back.
- **Failure scenario:** On any other machine or folder (including the same machine after the repo moved from `montage-practice-daw` to `Litwave`), every pad points to a file that doesn't exist and `trigger_pad` returns `False`, so all 48 pads are silent. Moving the project later breaks pads the same way.

#### PY-32 — High — The factory pad samples aren't in the repo and nothing generates them
- **Where:** `.gitignore` (`*.wav`); `assets/fx-pads/` holds only JSON; `src/generate_factory_fx.py`.
- **Defect:** The 48 WAVs are produced by `generate_factory_fx.py`, but README, setup and boot never run it or mention it. `preload_all_samples` skips missing files without saying so.
- **Failure scenario:** On a fresh clone, every FX pad is silent and nothing explains why.

#### PY-33 — Medium — The monitor thread rewrites the DSP settings file every 2 seconds and can die
- **Where:** `src/runtime.py:230-239`; `src/montage_host.py:198-200`, `src/montage_host.py:91-100`, `src/montage_host.py:102-120`.
- **Defect:** While the native engine is unreachable (not installed, not started, or crashed), the monitor calls `sync_master_dsp_settings()` every 2 seconds. That calls `set_analyzer_enabled` and `configure_warmth`, and each of those calls `_persist_dsp_settings()`: two file writes and two renames every 2 seconds, indefinitely. `_persist_dsp_settings` doesn't catch `OSError`, and the thread has no exception handling.
- **Failure scenario:** On a machine without the native host, the SSD gets about 86k pointless writes a day. If `data/` is read-only or the file is locked (antivirus, cloud-sync client), the exception kills the monitor thread. Native status and spectrum polling then stop for the rest of the session with no log line.

#### PY-34 — Medium — Most JSON stores write in place and wipe themselves on a read error
- **Where:** `src/setlist_manager.py:38-43`, `src/playlist_manager.py:66-73`, `src/montage_host.py:229-238` (names), `src/montage_host.py:288-293` (scenes), `src/fx_sampler.py:188-189`; loaders at `src/setlist_manager.py:22-36`, `src/playlist_manager.py:24-31`.
- **Defect:** These writers truncate the target and write it directly (only DSP settings, MIDI settings and chord charts use a temp file plus rename). The loaders fall back to defaults on any exception, and the next save overwrites the file with those defaults.
- **Failure scenario:** A crash or power cut during a save leaves a truncated `saved_setlists.json`. On the next start it loads as "Sunday Morning Service / empty", and the first edit permanently replaces every setlist the user had.

#### PY-35 — Medium — `PlaylistManager.get_tracks` throws away its own re-scan result
- **Where:** `src/playlist_manager.py:102-109`.
- **Defect:** `get_tracks()` calls `self._load_and_sync()` but doesn't assign the result to `self.tracks`. The re-scan writes newly found files to disk while the in-memory list stays stale. Every `GET /api/playlist` also re-reads the JSON, re-scans the folder and may rewrite the file on the event loop. Files deleted from disk are never pruned.
- **Failure scenario (reproduced):** Copy `new.mp3` into `uploads/` while the app is running. The JSON then holds `new.mp3`, but the list doesn't show it. Load `other.mp3`: `record_song` saves the stale `self.tracks` over the file, and the JSON now holds only `other.mp3`. The discovered entry and its metadata are erased. A deleted song stays listed forever, and selecting it returns 404.

#### PY-36 — Medium — Setlist patch snapshots are incomplete, and FX-bank recall can never fire
- **Where:** `src/api_setlist.py:54-63` against `src/api_setlist.py:70-96`; `src/setlist_manager.py:8-15`.
- **Defect:** `add_song` captures only engine, volumes, reverbs, mutes, names and the drone root. It doesn't capture voices, solos, pan, cutoff, resonance, attack, release, chorus, current scene or FX bank. The class docstring promises voices. `apply_song_patch` reads `patch["fx_bank"]`, but no code path ever writes it. When the engine type changes, the engine is killed and relaunched and the part values go out immediately over UDP, before the new process is listening.
- **Failure scenario:** Recalling a setlist song that was saved on the Community engine while the Yamaha engine is running relaunches the engine and silently loses every part volume, reverb and mute in the patch. Voices and FX bank never change between songs.

#### PY-37 — Medium — FX `update_pad` validates against the wrong ranges and stores raw, unconverted values
- **Where:** `src/api_fx_pads.py:73-95`; consumers at `src/fx_sampler.py:48`, `src/fx_sampler.py:159-164`, `src/fx_sampler.py:328`.
- **Defect:**
  - Volume is validated against 0–4 but used as a 0–127 value (`volume/127`).
  - Pan is validated against −1…1 but used as a 0–127 value centred on 64.
  - Pitch is accepted from −48 to 48, though the model documents ±12.
  - The validated numbers are thrown away and the original JSON values are stored, so `"60"` stays a string.
  - `midi_note: null` is stored as-is.
- **Failure scenario:**
  - `{"volume": 100}` gets a 400, and the largest accepted value, 4, plays at 3%.
  - `{"pan": 0}` is accepted and the pad is panned hard left.
  - `{"pan": "64"}` makes every later trigger of that pad raise `TypeError` in `FxVoice` (`str - int`).
  - `{"midi_note": "60"}` or `null` makes `_rebuild_midi_map` raise right after `midi_map.clear()`, so every MIDI-to-pad mapping is lost. The bad value is persisted, so this happens again on every start.

#### PY-38 — Medium — Custom pad sample upload goes to the *song* upload endpoint and points the pad at a path that doesn't exist
- **Where:** `src/static/js/desktop/fxpads.js:159-171`; `src/api_playlist.py:47-69`.
- **Defect:** The pad editor posts the sample to `/api/upload`, which saves it to `src/static/uploads/`, **loads it as the current backing track**, and adds it to the song library. The pad's `sample_path` is then set to `assets/fx-pads/custom/<name>`. That folder is never created or written, and the path is relative to the process's working directory, not the repo.
- **Failure scenario:** During rehearsal the user replaces a pad sample. The backing track stops and is replaced by the one-shot sample, the sample shows up in the song library, and the pad stays silent.

#### PY-39 — Low — Assorted inconsistent stored values
- **Where:**
  - `src/montage_host.py:553-570`: `set_part_volume` has no range check on the part number, unlike its siblings. It masks values with `& 0x7F` (so 200 is sent as 72) but stores the unmasked value.
  - `src/api_montage.py:84-98`: `assign_voice` has no part range check, an untruncated name of any type, and `& 0xFF` wrap on bank and preset.
  - `src/song_player.py:341-352`: the marker name isn't type-checked or truncated on add, though `update_marker` truncates to 32.
  - `src/song_player.py:317-334`: `record_chord` accepts any JSON type as the chord name.
  - `src/setlist_manager.py:54`: the setlist name isn't validated.
- **Failure scenario:** `{"part": 99, "name": {"x":1}}` adds a ninth "part" to `part_names`. That entry is persisted and broadcast to every client, and the UIs render a dict as a part name.

### 2.4 API behaviour and correctness

#### PY-40 — High — Blocking work on the asyncio event loop freezes every client
- **Where:**
  - `src/api_analysis.py:76-82`: the LRCLIB lyrics fetch runs synchronously, up to about 10 candidates × (4 s timeout + 0.6 s + 4 s retry).
  - `src/api_montage.py:44-72`: `time.sleep(0.3)`, PowerShell `Get-Process` launched twice per call through `get_running_engine_type`, and `time.sleep(0.35)` in `open_vst_editor`.
  - `src/server.py:195-205`: audio device reopen plus song resample.
  - `src/server.py:128-130`: full-song pitch shift.
  - `src/api_playlist.py` / `src/song_player.py:55-111`: decoding.
  - `src/api_setlist.py:70-96`: engine kill/launch.
  - Every JSON store write.
- **Defect:** All handlers are `async def` but do synchronous CPU, disk, network and subprocess work. Only the analysis itself goes to the executor.
- **Failure scenario:** On flaky venue Wi-Fi, pressing "Analyze" freezes the desktop and phone UIs (no telemetry, transport buttons dead) for tens of seconds while lyrics candidates time out one by one. Clicking "Show editor" freezes the UI for about a second each time while PowerShell starts.

#### PY-41 — High — The per-client telemetry frame is huge and rebuilt and serialised separately for every client at 25 fps
- **Where:** `src/server.py:278-327`; `src/song_player.py:499-519`; `src/fx_sampler.py:434-444`.
- **Defect:** Every 40 ms, each WebSocket connection builds its own full state and `json.dumps` it. That state includes the complete `chord_chart`, `markers`, `lyrics_sheet`, `analysis`, 800 `waveform_peaks`, every FX pad's configuration with descriptions and absolute paths, the complete `sound_catalog`, and the parts dictionaries. Mostly static data goes out 25 times a second. Building the frame also takes the song lock and the sampler lock, both of which the audio callback contends for, and triggers a UDP meter query.
- **Failure scenario:** With a lyric sheet and a full chord chart loaded, frames can run to tens of kB, about 1 MB/s or more per client. A phone on venue Wi-Fi drains its battery, lags or disconnects, and the server spends noticeable CPU and GIL time on serialisation, which feeds PY-13.

#### PY-42 — Medium — Concurrency bugs in WebSocket broadcast and the MIDI push
- **Where:** `src/runtime.py:212-228`, `src/runtime.py:246-255`; `src/server.py:280-281`, `src/server.py:321-327`; `src/api_montage.py:186`, `src/api_fx_pads.py:493`.
- **Defect:**
  - `broadcast` iterates `self.ws_clients` across `await` points while other coroutines append and remove clients, so clients are skipped.
  - The MIDI thread's `run_coroutine_threadsafe(client.send_text(...))` futures are never awaited or checked. Dead clients are never removed by that path, and those sends run concurrently with the per-client telemetry `send_text` on the same socket.
  - The `asyncio.create_task(...)` results are never kept, so the event loop holds only a weak reference and a task can be garbage-collected before it finishes.
  - `json.dumps` of dicts that other threads are mutating (`part_*`, `pads`) can raise `RuntimeError: dictionary changed size`. The `except RuntimeError` then silently ends that client's telemetry loop and closes the connection.
- **Failure scenario:** Changing pads or names while several clients are connected occasionally drops a client, which reconnects. Scene-sync broadcasts sometimes never reach some clients.

#### PY-43 — Medium — `GET /api/fx-pads` never returns the pad status
- **Where:** `src/api_fx_pads.py:29-51`.
- **Defect:** A GET has no body, so `action` defaults to `"trigger"`. With no `pad_id` the handler returns `{"success": false, "pad_id": null}`, so the `get_status()` return at the end is unreachable for GET.
- **Failure scenario:** `src/static/js/desktop/fxpads.js:176` and `src/static/js/remote/pads.js:77` expect `d.pads` and silently get nothing. The pad grid stays empty until the first telemetry frame happens to fill it.

#### PY-44 — Medium — `/api/montage/editor` swallows every error and then launches the engine
- **Where:** `src/api_montage.py:44-72`.
- **Defect:** The `try/except Exception: pass` falls through to an unconditional `open_vst_editor()`. Unknown or misspelled actions, a missing body, and any exception inside `kill` or `switch` all end by launching the engine. A `"switch"` without `engine` restarts the current engine.
- **Failure scenario:** A request with `{"action":"status"}`, or a failure during `kill`, *starts* the synth host instead of reporting an error.

#### PY-45 — Medium — Solo and mute interact incorrectly
- **Where:** `src/montage_host.py:592-636`; `src/api_montage.py:113-119`.
- **Defect:** Solo sends mute packets but keeps a separate `part_mutes` map. While any part is soloed, `set_part_mute(p, False)` unmutes p on the engine even though solo should keep it silent. Soloing doesn't update `part_mutes`, so the telemetry shows parts as unmuted while they are silent. Setlist recall and scene recall ignore solo state.
- **Failure scenario:** The user solos Part 1, then unmutes Part 3 from the remote. Part 3 becomes audible while the UI still shows Solo on Part 1.

#### PY-46 — Medium — Drone pad: stuck notes, double note-ons, and writes into the user's Part 8
- **Where:** `src/drone_pad.py:117-147` (crossfade thread), `src/drone_pad.py:95-105` (`set_voice`), `src/drone_pad.py:107-115` and `src/drone_pad.py:149-159` (duplicate definitions).
- **Defect:**
  - `set_root` sends the new note-ons and sets `active_pitches` from an unsynchronised background thread. Two quick root changes, or `stop_drone` during the 1.8 s overlap, can release notes another thread still needs, or set `active_pitches` after `stop_drone` cleared it.
  - `set_voice` re-sends note-on for notes that are already sounding, with no note-off first.
  - `set_volume` and `set_cutoff` are each defined twice. The second definitions win, and they also call `host.set_part_volume(8, …)` and `send_part_cc(8, 74, …)`, which changes the *performance's* Part 8 even though the drone has its own synth commands (0x96, 0x97). The drone volume then shows up as Part 8's fader value in telemetry.
  - The "crossfade" is only an overlap: new notes at velocity 80, old notes released after 1.8 s, with no gain ramp.
- **Failure scenario:** Root C → G → C within 1.8 s: the first thread's delayed release cuts the C notes the third change just started, so the drone goes silent while the UI shows it running. Stopping the drone in the middle of a crossfade leaves four notes droning until the next panic. Moving the drone volume slider changes the level of the user's Part 8 pad.

#### PY-47 — Medium — Voicing audition discards the voicing
- **Where:** `src/api_montage.py:206-236`; `src/ear_training.py:215-228`.
- **Defect:** The handler reduces the submitted notes to sorted, de-duplicated pitch classes relative to the root. `play_voicing` then rebuilds a fixed "bass + close position above middle C" shape. Unknown note names (`E#`, `Cb`, double accidentals) silently become C. A string in place of a list is iterated character by character.
- **Failure scenario:** Drop-2, rootless or inverted voicings from the voicing panel all sound like the same root-position close chord, so the audition can't be used to compare voicings.

#### PY-48 — Medium — MIDI port handling
- **Where:** `src/midi_manager.py:142-177`, `src/midi_manager.py:179-195`, `src/midi_manager.py:218-238`; `src/runtime.py:187-190`; `src/server.py:207-212`.
- **Defect:**
  - When the preferred port is missing, `open_port` silently falls back to `ports[0]` **and overwrites `preferred_port_name`**, so the user's keyboard is never re-selected when it comes back.
  - At boot, port 0 is opened regardless of the last-used port, which isn't persisted.
  - `/api/midi/device` passes any JSON value through, and an unknown name silently opens port 0 while reporting `success: true`.
  - Input is polled every 5 ms, which adds up to 5 ms of latency and jitter.
  - `mido.get_input_names()` runs from the worker thread every second and also from request and WebSocket threads, while the rtmidi backend isn't thread-safe.
  - Python opens the keyboard's input port itself. On Windows MME an input can be opened by only one process; check this against how the native host receives MIDI (see the C++ section).
- **Failure scenario:** The USB keyboard is unplugged for a second mid-set. Litwave reconnects to a different input, such as a loopMIDI port or the pedalboard, and stays on it after the keyboard comes back.

#### PY-49 — Medium — Analysis edge cases
- **Where:** `src/api_analysis.py:88-92`; `src/analyzer.py:321-330`, `src/analyzer.py:370-374`.
- **Defect:**
  - The playlist is updated with `raw_name` (the client string) instead of the sanitised `filename`, so a request with `"filename": "../x.mp3"` or with folders creates a separate, duplicate playlist entry holding the key and BPM.
  - `first_beat_seconds` (the first *beat*) is used as the metronome's *downbeat* origin (`get_beat_origin`), so the bar accent falls on whichever beat librosa found first.
  - `time_sig` is always `None`, though the handler docstring and README advertise time-signature detection.
  - The detected BPM silently overwrites a BPM the user set by hand.
  - An empty `tempo_arr` raises `IndexError`.
- **Failure scenario:** On a song with a one-beat pickup, the click accents beat 2 of every bar after analysis.

#### PY-50 — Medium — Lyrics matching has no confidence threshold and caches wrong matches for good
- **Where:** `src/lyrics.py:128-171`, `src/lyrics.py:236-248`, `src/lyrics.py:109-125`.
- **Defect:**
  - Any synced result for any candidate is accepted, including loose 3-word prefixes, and the duration check only *ranks* results. The match is written to `<song>.lyrics.json`, and that sidecar then takes priority over any future search.
  - LRC lines with several timestamps (`[00:12.00][00:45.00]text`) keep only the first timestamp and leave `[00:45.00]` in the text.
  - `[offset:]` tags are ignored.
- **Failure scenario:** A song titled "Kau Baik" gets the lyrics of another song whose title shares those words, and re-analysing never fixes it because the wrong sidecar is now treated as authoritative.

#### PY-51 — Low — Ear training scoring
- **Where:** `src/ear_training.py:442-465`, `src/ear_training.py:343-360`.
- **Defect:**
  - The `melodic_response` module is never marked correct: there is no evaluation of played MIDI, and every check counts as a miss.
  - `check_answer` can be called repeatedly for one exercise, inflating the total.
  - The exercise payload sent to the client contains the answer (`answer_id`, `answer_name`).
  - Overlapping "generate" clicks start overlapping playback threads with no cancellation.

#### PY-52 — Low — `api_remote_info` is wrong without internet and hard-codes the port
- **Where:** `src/server.py:329-363`.
- **Defect:** The LAN IP is found by "connecting" a UDP socket to 8.8.8.8. That fails without a default route, which is common on an offline stage router, and the fallback is `127.0.0.1`, so the QR code points the phone at itself. The port is hard-coded to 8080 instead of using `main.PORT`. On machines with several interfaces (VPN, Hyper-V, Wi-Fi plus Ethernet) the chosen IP may not be on the phone's network. `hostname` is unused, and `socket`/`json` are re-imported locally, shadowing the module-level names.

#### PY-53 — Low — Transport, mixer and volume state is duplicated
- **Where:** `src/server.py:131-134` and `src/server.py:148-151` (`track_volume` stored both in `AudioEngine` and `SongPlayer.volume` and applied *twice*: `get_audio_block` multiplies by `self.volume` and the callback multiplies by `track_volume` again); `src/audio_engine.py:153`.
- **Failure scenario:** A track fader at 0.8 gives 0.64 effective gain. A fader at 1.5 gives 2.25×, straight into the tanh limiter (PY-16).

### 2.5 Lifecycle, structure and portability

#### PY-60 — High — Engine executable paths are hard-coded to the developer's user profile
- **Where:** `src/montage_host.py:27-29`.
- **Defect:** `YAMAHA_ENGINE_EXE` and `COMMUNITY_ENGINE_EXE` are `C:\Users\Jeremy Rukmana\Projects\montage-practice-daw\cpp_host\…`. They aren't derived from the repo location or any setting, and the repo is now called `Litwave`.
- **Failure scenario:** On any other machine, or this one after the rename or move, `open_vst_editor` returns `False`, `check_installation()` reports `host_app_installed: false`, and no synth engine ever starts.

#### PY-61 — Medium — "Import has zero side effects" doesn't hold
- **Where:** `src/server.py:32`, `src/server.py:34`; `src/runtime.py:138-139`; `src/playlist_manager.py:15-26`; `src/fx_sampler.py:26`; `src/audio_engine.py:11`, `src/audio_engine.py:14`; `src/user_data.py:279-298`.
- **Defect:** Importing `src.server` creates `AppState()`, which constructs `SetlistManager` and `PlaylistManager`. That creates `data/`, copies the legacy seed files, creates `static/uploads`, lists it and may write `saved_playlist.json`. Importing `src.fx_sampler` resolves `SETTINGS_FILE` at import time, so `LITWAVE_DATA_DIR` must be set before the import or the real user folder is used. Importing `src.audio_engine` imports `sounddevice`, which loads PortAudio, and sets `SD_ENABLE_ASIO`. README §1 and §6 state the opposite.
- **Failure scenario:** A test or tool that imports `src.server` before setting `LITWAVE_DATA_DIR` reads and writes the user's real `data/` folder.

#### PY-62 — Medium — Shutdown is incomplete
- **Where:** `src/runtime.py:192-210`; `src/main.py:79-81`.
- **Defect:** `shutdown()` doesn't stop the drone (its notes stay on in the native host), doesn't send panic or all-notes-off, doesn't stop or join ear-training and crossfade threads, doesn't close `EarTrainingManager.sock`, and leaves the native engine process running. The window-mode join has a 10 s timeout, after which the daemon thread is abandoned.
- **Failure scenario:** The user closes Litwave while the drone pad or a held chord is sounding. The native engine keeps playing it until it is killed by hand.

#### PY-63 — Medium — The boot path has no fault isolation
- **Where:** `src/runtime.py:148-190`; `src/server.py:42-55`, `src/server.py:278-321`.
- **Defect:** `_booted` is set before construction. Any exception in `AudioEngine()` (PortAudio missing), `FxSampler` or `MidiManager` aborts the lifespan, and the app doesn't start at all, even though only one subsystem failed. If boot partly succeeded, handlers dereference `state.audio`, `state.midi` and `state.montage` without checks, so every request is a 500 and the WebSocket loop dies on its first frame. `create_lifespan` in `runtime.py` is never used, because `server.py` defines its own copy, `_lifespan`.
- **Failure scenario:** A machine where PortAudio can't open any device still can't use the setlist, lyrics or remote features: the app either won't start or answers 500 everywhere.

#### PY-64 — Medium — Device enumeration on hot paths
- **Where:** `src/server.py:51-52` (`/api/status` with `force_refresh=True`, polled by `src/static/js/desktop/prefs.js:38`, `src/static/js/desktop/prefs.js:61`); `src/server.py:316-320` (every 25 ticks *per client*); `src/audio_engine.py:59-66` (`force_refresh` is ignored: it always re-queries).
- **Defect:** README §6 itself warns that device enumeration can crash ASIO drivers. `sd.query_devices()` and `mido.get_input_names()` run once a second for each connected client, and on every status call.
- **Failure scenario:** With desktop and phone both connected, PortAudio and rtmidi enumerate devices several times a second during a performance, which is exactly the driver stress the README warns about.

#### PY-65 — Low — The single analysis worker has no cancellation or de-duplication
- **Where:** `src/async_worker.py:1-9`; `src/api_analysis.py:69-73`.
- **Defect:** Analysis requests are serialised but never cancelled or merged. Repeated clicks queue full BTC runs, each several tens of seconds on CPU. `asyncio.get_event_loop()` is deprecated in this context (inside a coroutine on Python ≥ 3.12).

#### PY-66 — Low — Code quality and leftovers
- `src/song_player.py:17`: `List` is used in annotations but not imported. It's harmless today only because local attribute annotations aren't evaluated.
- `src/server.py:265-276` and `src/api_montage.py:18-33`: two different `CustomJSONEncoder` implementations.
- `src/server.py:37-39`: `_get_analyzer_track` is unused.
- `src/montage_host.py`: about 12 methods each open and close their own socket instead of using `_send_udp`. `import socket` and `import subprocess` are repeated inside functions. `send_midi_cc` is unused.
- `src/song_player.py:368`: `update_marker_time` is unused.
- `src/setlist_manager.py:111`: `update_song_patch` is unreachable from the API. `remove_song_from_setlist` returns `True` even when nothing was removed. `move_song` treats any direction other than `"up"` as down.
- `src/montage_host.py:134-140`: panic sends 16 × N separate datagrams, each with a new socket.
- `print()` is used for errors throughout instead of the `litwave` logger, so under `pythonw` it reaches the log file only through the stdout swap in `main.py`.
- `src/fx_sampler.py:1-12`: the docstring says "4 Banks x 8 Pads = 32" (the code has 6 × 8 = 48) and "lock-free" (it uses a lock). `src/generate_factory_fx.py:1-45` also says 32.
- `src/main.py:25-27`: the "already running" check probes only 127.0.0.1 and races with the bind. In `--browser` mode the browser opens before the server listens and can show "connection refused".
- `src/user_data.py:276-285`: `REPO_ROOT` is `dirname(src)`. When installed as a wheel (`pyproject.toml` packages `src`), user data would go into `site-packages/data`.
- `src/api_*`: error handling is inconsistent. Some handlers return 400 for every exception (`api_montage`, `api_fx_pads`), some 500 with `str(e)`, and some are wrapped twice (by `validated` and their own `try`).
- `src/midi_manager.py:90-129`: `velocity_min > velocity_max` is accepted and makes every note `velocity_min`. The native velocity sync (`sync_velocity_curve`) doesn't carry min and max, so the UI's velocity and the synth's velocity differ when they are set.
## 3. Native C++ hosts (`cpp_host/`) and the Python↔C++ UDP contract

All Python↔C++ traffic uses one UDP port, `127.0.0.1:9123`. The status packet (188 bytes, `<IffIIIIfffIIfIf32s96s`) and spectrum packet (392 bytes, `<II96f`) match on both sides byte for byte. miniaudio delivers fixed 256-frame callbacks, so the hard-coded 512-frame scratch arrays in the callbacks do **not** overflow today; that one was checked and is not a bug.

### 3.1 Critical / High

#### CPP-01 — High — The SysEx event points at a dead stack copy
- **Where:** `cpp_host/native_complete_host.cpp:556-589`.
- **Defect:** Each queue entry is copied into a loop-local `MidiNoteEvent m`. Then `e.data.bytes = m.sysex_data` stores that local's address in the event, and the event is consumed later by `g_processor->process(data)`, after `m` has gone out of scope.
- **Failure scenario:** A `0xF0` SysEx packet reaches the plugin as garbage. Several SysEx events in one block all alias the same stack slot.

#### CPP-02 — High — The MIDI ring buffer has two producers but is written as single-producer
- **Where:** `cpp_host/native_complete_host.cpp:71-104`, `cpp_host/native_complete_host.cpp:342-351`, plus the UDP handlers at `969`, `1020`, `1053`, `1069`, `1075`, `1078`.
- **Defect:** The winmm `MidiInProc` thread and the UDP worker thread both call `enqueue_midi_note`/`enqueue_sysex`. Both can read the same `g_midi_head`, write the same slot and publish once.
- **Failure scenario:** Playing the keyboard while the UI sends CC, scene or note packets loses events or mixes their fields. A lost note-off is a stuck note on stage.

#### CPP-03 — High — Python plays the backing audio itself *and* streams the same mix to the native host, which plays it again
- **Where:** `src/audio_engine.py:166-211` (local `outdata[:] = mix` plus `sendto` of the same `mix`); `cpp_host/native_complete_host.cpp:642-700` (mixes the ring into its own output); the community `0x41` handler at `cpp_host/litwave_community_host.cpp:558`.
- **Defect:** The full Python mix (backing track + metronome + FX pads, after the Python EQ, master gain and tanh) goes to Python's sounddevice output. It is also sent to the native host, which adds it to the synth output and plays it through miniaudio. On the native path the same audio is therefore EQ'd twice (Python EQ, then the C++ master EQ), gain-scaled twice (`master_volume`, then `g_master_gain`, which `api_mixer` sets to the same value) and saturated twice (tanh, then StageWarmth).
- **Failure scenario:** Whenever a native engine is running, the track, click and pads come out twice: on two unsynchronised devices (audible echo) or on the same device with an offset (comb filtering, about +6 dB).

#### CPP-04 — High — Sample rates disagree across the PCM link
- **Where:** `src/audio_engine.py:104-106` against `cpp_host/native_complete_host.cpp:1243` and `cpp_host/litwave_community_host.cpp:825` (both fixed at 44100 Hz); hard-coded 44.1 kHz in `native_complete_host.cpp:365-366`, `382`, `494`, `951`, `1196`, `1214`, `litwave_community_host.cpp:61-62`, `120`, `fx_chain.h:228`.
- **Defect:** Python runs at the device's default rate (often 48000 Hz) and streams raw PCM with no rate information. The native hosts consume it at 44100 Hz.
- **Failure scenario:** At 48 kHz the backing track on the native path plays about 8.8% slow and about 1.5 semitones flat. The producer outruns the consumer, so the ring overflows (see CPP-05).

#### CPP-05 — High — The PCM ring buffer has no overflow handling or drift compensation
- **Where:** `enqueue_track_audio` in `cpp_host/native_complete_host.cpp:456-464` and `cpp_host/litwave_community_host.cpp:88-96`, plus the ring readers.
- **Defect:** The writer never checks free space. Two independent device clocks feed and drain the ring. Once the write index laps the read index, `available` is computed as small and up to about 3 s of audio (131072 frames; the comment says "~1.5 s") is skipped or overwritten. When the ring runs dry, zeros are inserted mid-block.
- **Failure scenario:** Any clock drift, rate mismatch or scheduling hiccup causes periodic jumps and clicks, or latency between track and synth that grows up to about 3 s.

#### CPP-06 — High — A 512-frame PCM packet doesn't fit the host's receive buffer, and larger blocks are cut off
- **Where:** `src/audio_engine.py:177-180` against `char buf[4096]` in `cpp_host/native_complete_host.cpp:822` and `cpp_host/litwave_community_host.cpp:488`.
- **Defect:** A packet of 512 frames is 4 + 512 × 8 = 4100 bytes, more than the 4096-byte buffer, so Windows `recvfrom` fails with WSAEMSGSIZE. Blocks above 512 frames (the API allows up to 8192) send only their first 512 frames.
- **Failure scenario:** At blocksize 512 no backing audio reaches the native host. At blocksize 1024, half of every block is missing.

#### CPP-07 — High — Drone voice change loads an SF2 from disk while holding a mutex the audio callback needs
- **Where:** `cpp_host/native_complete_host.cpp:936-952` (`tsf_load_filename` under `g_drone_mutex`), callback at `cpp_host/native_complete_host.cpp:624`; triggered from `src/drone_pad.py:73`, `src/drone_pad.py:100`.
- **Defect:** `start_drone()` sends `set_drone_voice` every time it starts. The native host then loads a large SoundFont file while the audio callback is blocked on the same mutex.
- **Failure scenario:** Every drone start stalls the *entire* output (MONTAGE VST and backing track included) for as long as the disk load takes, which can be seconds.

#### CPP-08 — High — The Community host does allocation and file I/O while holding the synth mutex the callback needs
- **Where:** `cpp_host/litwave_community_host.cpp:641-650`, `cpp_host/litwave_community_host.cpp:674-684` (`tsf_close`, `tsf_copy`, `save_current_session_state()` under `g_synth_mutex`); callback at `cpp_host/litwave_community_host.cpp:231`.
- **Failure scenario:** Every voice or drone-preset change risks an audible dropout, which is worse on slow disks or with an antivirus scanning the file.

#### CPP-09 — High — Community CC handling races the audio thread
- **Where:** `cpp_host/litwave_community_host.cpp:600-602`.
- **Defect:** `tsf_channel_midi_control` runs on the UDP thread without `g_synth_mutex`, while the audio thread is inside `tsf_render_float` on the same `tsf`. `tsf_channel_init` can reallocate the channel array.
- **Failure scenario:** Moving the pan, cutoff, resonance, attack, release or chorus sliders during playback is a data race that can cause a use-after-free and crash the engine.

#### CPP-10 — High — The Community host reads the EQ band type codes differently from what Python sends
- **Where:** `cpp_host/litwave_community_host.cpp:117-155` against `src/server.py:180`, `src/server.py:188` (and the Yamaha host, which matches Python, at `cpp_host/native_complete_host.cpp:509`, `517`).
- **Defect:** Python sends 0 = low shelf, 1 = peaking, 2 = high shelf. The Community host reads 0 = peak, 1 = low shelf.
- **Failure scenario:** On the Community engine, the "Low" band acts as a bell at 100 Hz and the low-mid bell acts as a low shelf at 500 Hz.

#### CPP-11 — High — The Community high-shelf `b2` coefficient has the wrong sign
- **Where:** `cpp_host/litwave_community_host.cpp:145` (`A*((A+1) - (A-1)*cs - beta)`). Compare `cpp_host/native_complete_host.cpp:528` and RBJ: `+ (A-1)*cs`.
- **Defect:** It is invisible at 0 dB. For +12 dB at 8 kHz the response is about −3.8 dB at 20 Hz and −3.4 dB at 1 kHz instead of 0 dB, and the top end is wrong too.
- **Failure scenario:** A treble boost on the Community engine also cuts the bass and mids.

#### CPP-12 — High — VST3 controller calls are made from the UDP thread
- **Where:** `cpp_host/native_complete_host.cpp:966`, `977`, `988`, `999`, `1013`, `1017`, `1035`.
- **Defect:** `IEditController::setParamNormalized` is called from the UDP worker thread while the GUI loop on the main thread uses the same controller and editor. The VST3 threading model requires controller calls on the UI thread.
- **Failure scenario:** Moving volume, pan or mute while the MONTAGE editor is open can crash the plugin or corrupt its state.

### 3.2 Medium

#### CPP-20 — Medium — "Kill engine" first sends *Show* and then force-kills, so session state is never saved
- **Where:** `src/montage_host.py:345`, `src/montage_host.py:362-363`; `cpp_host/native_complete_host.cpp:1346-1355`.
- **Defect:** `kill_vst_engine()` calls `toggle_vst_window("kill")`, but `cmd_map` has no `"kill"` key, so it sends action 1 (Show) instead of the host's kill action (3). `Stop-Process -Force` then terminates the process, so `last_session_state.bin` is never written.
- **Failure scenario:** Each engine switch or setlist recall that changes engine flashes the editor window and loses every preset edit made since launch.

#### CPP-21 — Medium — The Community host has no reachable shutdown path
- **Where:** `cpp_host/litwave_community_host.cpp:865-869`.
- **Defect:** Nothing ever sets `g_udp_running` to false: there is no quit command, console handler or window, and Python only ever force-kills the process. The final `save_current_session_state`, device cleanup and MIDI cleanup never run.
- **Failure scenario:** Part volume, pan, reverb, chorus and mute changes, which don't trigger a save on their own, are lost on every restart.

#### CPP-22 — Medium — The startup panic is thrown away
- **Where:** `cpp_host/native_complete_host.cpp:1204` against `cpp_host/native_complete_host.cpp:550`.
- **Defect:** `add_panic_events_to_current_block()` is called before the device starts. The first callback clears `g_eventList` before using it, so the "initial state sync & panic reset" is never delivered.

#### CPP-23 — Medium — Community: muted parts freeze instead of decaying
- **Where:** `cpp_host/litwave_community_host.cpp:217-233`.
- **Defect:** A part that is muted or has volume ≤ 0.0001 skips `tsf_render_float` entirely, so its voices stop advancing.
- **Failure scenario:** Mute a part while its notes are ringing, release the keys, unmute later. The frozen tails and sustained notes resume from where they stopped.

#### CPP-24 — Medium — Community: the sustain cache goes stale
- **Where:** `cpp_host/litwave_community_host.cpp:401-411`, `cpp_host/litwave_community_host.cpp:643-650`, `cpp_host/litwave_community_host.cpp:676-683`, `cpp_host/litwave_community_host.cpp:601`.
- **Defect:** `g_part_sustain_state[p]` isn't reset when a part's synth is replaced by `tsf_copy`, and a CC64 sent as a `C` packet changes tsf's sustain without updating the cache.
- **Failure scenario:** Change voice while the pedal is down, release, press again. The press is dropped as "unchanged", so sustain stops working on that part.

#### CPP-25 — Medium — Community: the chorus send also returns dry signal
- **Where:** `cpp_host/litwave_community_host.cpp:249-254` with `cpp_host/fx_chain.h:255-256`.
- **Defect:** `StereoChorus::process` returns dry + wet but is used as a send/return effect whose output is added on top of the dry sum.
- **Failure scenario:** At chorus send 1.0 the part gets about +4.5 dB louder, so the chorus slider works as a volume control.

#### CPP-26 — Medium — Community: pan is applied twice
- **Where:** `cpp_host/litwave_community_host.cpp:596`, `cpp_host/litwave_community_host.cpp:601`, `cpp_host/tsf.h:1983`.
- **Defect:** CC10 sets the host's equal-power pan and is also forwarded to tsf, which applies its own channel pan.
- **Failure scenario:** A moderate pan setting moves the part much further to the side than intended.

#### CPP-27 — Medium — StageWarmth (on by default) adds gain and can push the output past 0 dBFS
- **Where:** `cpp_host/master_dsp.h:42-59`.
- **Defect:** The `1/tanh(drive)` compensation only normalises full-scale signals. Small-signal gain is `drive/tanh(drive)`: about +3.2 dB at the default 1.2 and about +9.6 dB at 3.0. Peak output reaches `1/tanh(drive)`, which is 1.31 at drive 1.0. Mode 0's `0.08·y²` term adds an uncorrected DC offset. The saturation meter compares against the dry input, so it shows the gain change, not saturation.
- **Failure scenario:** With warmth on, loud passages hard-clip at the DAC, and quiet passages get louder when warmth is switched on.

#### CPP-28 — Medium — No finiteness or range checks on EQ and master-gain floats
- **Where:** both hosts' `0x45`/`0x47` handlers and `update_eq_band`; the API allows frequencies up to 100 kHz (`src/server.py:174`).
- **Defect:** The native host divides by Q without a guard. A frequency at or above Nyquist, `Q = 0`, or a NaN from a malformed packet can make the biquad state NaN for good, and StageWarmth then outputs silence.
- **Failure scenario:** The master stays silent until the host restarts.

#### CPP-29 — Medium — EQ coefficients are updated non-atomically and without smoothing
- **Where:** `cpp_host/litwave_community_host.cpp:150-154`, `cpp_host/native_complete_host.cpp:475-477`.
- **Defect:** The UDP thread writes five coefficients one at a time while the audio thread runs the filter.
- **Failure scenario:** Dragging an EQ handle causes zipper noise and clicks, and possibly brief instability at high gain or Q.

#### CPP-30 — Medium — The spectrum triple-buffer handoff races
- **Where:** `cpp_host/master_dsp.h:95-141`.
- **Defect:** Between the reader loading `publishedBuffer_` and storing `readerBuffer_`, the writer can choose that same buffer as its next write target.
- **Failure scenario:** The analyzer occasionally shows a torn frame.

#### CPP-31 — Medium — No denormal protection
- **Where:** `cpp_host/fx_chain.h:264-347`, all biquad structs, both hosts.
- **Defect:** Neither host sets FTZ/DAZ or uses a denormal guard, so Freeverb combs, allpasses and IIR states decay into denormals during silence.
- **Failure scenario:** CPU load jumps right after the music stops, and xruns happen in quiet moments.

#### CPP-32 — Medium — CC input is sent to the plugin with the event type meant for plugin output
- **Where:** `cpp_host/native_complete_host.cpp:419-430`, `441-444`, `577-582`.
- **Defect:** Hardware sustain, CC1, CC7, scene CC92 and panic CCs go to the plugin as `kLegacyMIDICCOutEvent`. That type is defined for plugin-to-host output, not host-to-plugin input.
- **Failure scenario:** A spec-compliant plugin ignores these events, so the sustain pedal, scene select and panic may do nothing.

#### CPP-33 — Medium — Incomplete hardware MIDI handling
- **Where:** `cpp_host/native_complete_host.cpp:337-352`; `cpp_host/litwave_community_host.cpp:417-453`.
- **Defect:** The Yamaha host handles only 0x90, 0x80 and 0xB0, so pitch bend, aftertouch and program change are dropped, although `PROMPT_ENGINE.md` requires pitch bend. The Community host drops every CC except 64, including CC1, CC11 and CC7.
- **Failure scenario:** The pitch wheel and the expression and volume pedals do nothing.

#### CPP-34 — Medium — The two hosts read the note channel byte differently
- **Where:** `cpp_host/native_complete_host.cpp:1064-1075` against `cpp_host/litwave_community_host.cpp:695-707`; `src/montage_host.py:137-138`.
- **Defect:** The native host maps 1..8 to 0..7 and keeps other values unchanged, so 0 and 1 both reach channel 0 and index 8 can never be reached. The Community host treats the byte as 0-based except that 8 maps to 7. Python's `panic()` sends channels 0..15 assuming 0-based.
- **Failure scenario:** The same `[0x90, 1, n, v]` plays Part 1 on Yamaha and Part 2 on Community.

#### CPP-35 — Medium — An unchecked note byte indexes a 128-wide array out of bounds
- **Where:** `cpp_host/native_complete_host.cpp:1068`, `1074`.
- **Defect:** `g_active_plugin_notes[targetCh][d1]` is indexed with the raw UDP byte (0..255) before any range check.
- **Failure scenario:** A note value of 128 or more from a local packet writes into the next channel's row, or past the end of the array.

#### CPP-36 — Medium — Drone isolation is inconsistent between the hosts
- **Where:** `cpp_host/litwave_community_host.cpp:687-694` (UDP CC64 sustains all 8 parts, ignoring `g_drone_isolation`, while the hardware path at 424 and 446-450 honours it); `cpp_host/native_complete_host.cpp:287`, `921-924` (`g_drone_isolation` is stored but never read, so `D` packets do nothing on the Yamaha host).

#### CPP-37 — Medium — The drone bank maps differ between the hosts
- **Where:** `cpp_host/native_complete_host.cpp:937-944` against `cpp_host/litwave_community_host.cpp:630-640`.
- **Defect:** Unknown or unmapped banks fall back to different SoundFonts (Chateau on native, GeneralUser on Community). If loading fails, `g_drone_synth` stays null.
- **Failure scenario:** The same drone voice sounds different, or the drone stays silent, depending on the engine.

#### CPP-38 — Medium — Plugin class lookup is fragile, and its results aren't null-checked
- **Where:** `cpp_host/native_complete_host.cpp:1124-1133`.
- **Defect:** The component and controller are taken as factory classes 0 and 1 by position, not found by category or `getControllerClassId`. `getFactory`, `createInstance` and the resulting interfaces are used without null checks.
- **Failure scenario:** A plugin update that reorders its classes crashes the host at startup.

#### CPP-39 — Medium — State files aren't written atomically, and their size isn't validated
- **Where:** `cpp_host/native_complete_host.cpp:1167-1181`, `cpp_host/native_complete_host.cpp:1346-1355`, `cpp_host/community_state.h:387-392`; restore at `cpp_host/litwave_community_host.cpp:753-766`.
- **Defect:** State files are overwritten in place without checking the write results. The native loader accepts a file of any size. The Community restore applies bank, preset, volume, pan, reverb, chorus and master values with no range or finiteness checks.
- **Failure scenario:** A crash during a save sends garbage to `setState` on the next start. A corrupted Community file restores a NaN master gain, so the output is silent.

#### CPP-40 — Medium — The meter reply protocol depends on timing
- **Where:** `src/audio_engine.py:182-206`, `src/audio_engine.py:237-262`.
- **Defect:** Python sends `A` or `P` and immediately does a non-blocking `recvfrom` on the same socket, so it always reads an older reply. Two threads share that socket without a lock (see PY-14).
- **Failure scenario:** The meters are stale by at least one packet. If replies get out of order, the backlog never drains and the meters lag permanently.

#### CPP-41 — Medium — Python and the native host both open the hardware MIDI input
- **Where:** `MidiInProc`/`midiInOpen` in both hosts; `src/runtime.py:187-190` (`midi.open_port(0)`).
- **Defect:** Classic Windows MIDI drivers allow one client per input port. The native host picks a device whose name contains "CASIO" or "MIDI"; Python opens port 0.
- **Failure scenario:** Whichever opens second fails silently. Either the synth gets no notes, or the Litwave UI (keyboard view, chord detection) shows nothing.

### 3.3 Low

- **CPP-50:** Community status values are made up. Sample rate, buffer size and periods are never read from the device; `peakDspLoad` only ever rises; `g_callback_monitor` is unused; the backend is hard-coded to "wasapi"; and the xrun rule (gap > 2.2× period) reports false xruns (`cpp_host/litwave_community_host.cpp:72-74`, `328-333`, `519-522`, `819`).
- **CPP-51:** `totalLatencyMs = buffer + buffer × periods` counts the buffer twice. The native host also divides device-rate frames by the client rate and ignores the extra 256-frame fixed-callback buffering (native 853-855, community 520-522).
- **CPP-52:** The return values of `ma_context_init`, `ma_context_get_devices` and `ma_device_start` aren't checked, so a failed init leaves uninitialised counts and pointers in use (community 800-804; native 1220-1225, 1265).
- **CPP-53:** Output device selection is hard-coded to names containing "HD USB", "USB Audio" or "NUX". MIDI selection matches "CASIO" or "MIDI", with native taking the last match and Community the first, and falls back to device 0. There is no way to choose, and no hotplug (native 1230-1237, 1272-1278; community 809-816, 844-851).
- **CPP-54:** The build scripts are tied to one machine: `C:\Users\Jeremy Rukmana\Projects\montage-practice-daw` and VS 2022 Community. Neither checks `errorlevel` after `vcvars64` or `cd /d`, and the VST3 SDK they need is an undocumented, git-ignored dependency (`cpp_host/compile_complete.bat:2-3`, `cpp_host/compile_community.bat:2-3`).
- **CPP-55:** `std::vector::push_back` runs on the audio thread. Panic adds up to 2112 events in one block (native 114, 183, 550, 592).
- **CPP-56:** Editor teardown happens in the wrong order: `view->removed()` is called after the parent HWND is destroyed. No `IPlugFrame` is set, so the plugin can't resize itself. Window borders are fixed +16/+39 offsets that ignore DPI. Interfaces, connection points and the module are never released, and `initialize(nullptr)` passes no host application (native 1327-1345).
- **CPP-57:** No `ProcessContext` (tempo, transport, time signature) is passed to the plugin, so MONTAGE arpeggios and the Motion Sequencer can't follow the song or metronome tempo (native 600-606).
- **CPP-58:** Every launch dumps every plugin parameter to `montage_all_params.txt`, which slows startup, and the wide-to-narrow string conversion truncates non-ASCII names (native 1139-1153).
- **CPP-59:** The chorus and the Community EQ hard-code 44100 Hz, and the ring-size comment is wrong (`cpp_host/fx_chain.h:228`, `cpp_host/litwave_community_host.cpp:120`).
- **CPP-60:** Datagrams of 1–3 bytes are ignored without notice. SysEx over 32 bytes is dropped silently. Status and drone commands accept any trailing length (native 92, community 500).
- **CPP-61:** The session `solo` field is always written as 0 and never read. The startup banner lists voices that don't match the real defaults, and the Part 8 comment and its default disagree (`cpp_host/community_state.h:366`, `cpp_host/litwave_community_host.cpp:354`, `788-796`).
- **CPP-62:** Python masks values with `& 0x7F`/`& 0xFF` instead of range-checking them, so velocity 128 is sent as 0 (a note-off) and a part volume of 200 as 72 (`src/montage_host.py:440-552`).
- **CPP-63:** README §6 documents UDP 9000/9001. Every command and reply actually uses 9123.
## 4. New frontend (`src/static/js/**`, shared libs, `sw.js`, CSS, HTML)

Checked and clean: every `$("id")` reference resolves in its HTML with no duplicate IDs, and the new UI has **no XSS**. Server and user strings are written with `textContent`, and `innerHTML` only receives static icon markup.

### 4.1 High

#### FE-01 — High — A new song keeps the previous song's analysis and waveform
- **Where:** `src/static/js/desktop/telemetry.js:45-48`; `src/static/js/remote/state.js:71-76`.
- **Defect:** `S.analysis` is assigned only when `song.analysis` is truthy, and `S.peaks` only when the new array is non-empty. `load_file` resets the analysis to `None` on the server, so the old object survives until no track is loaded at all. The phone never resets `state.key` when the analysis goes away.
- **Failure scenario:** Analyse song A, then load song B, which hasn't been analysed. The header, island, progression, Stage view and Nashville key all show A's key and BPM, and "Sync click" (`song.js:175-181`) sets the metronome to A's tempo.

#### FE-02 — High — Choosing MONTAGE M while the Community engine runs doesn't switch engines, but the UI says it did
- **Where:** `src/static/js/desktop/engine.js:28-36`; `src/static/js/remote/sheets.js:153`; server side `src/api_montage.py:58-64`.
- **Defect:** Yamaha is requested with `action: "show"`. When any engine is already running, the server only toggles the window and ignores `engine`. Both UIs announce "MONTAGE M window opened" without checking `success`, and store the engine as Yamaha (desktop in `localStorage`, phone in `S.engineType`).
- **Failure scenario:** The Community engine keeps playing, while both UIs claim MONTAGE is active and show MONTAGE controls.

#### FE-03 — High — Clicking a section turns the loop off when a loop is already on
- **Where:** `src/static/js/desktop/markers.js:22-30`; `src/song_player.py:184-186`.
- **Defect:** `jump()` sets A and B and then sends `toggle_loop`, which simply flips the state. The call also skips `LW.local.mark("loop")`.
- **Failure scenario:** Click section 1 and the loop turns on. Click section 2 and the loop turns *off*, while the island shows "Looping until …". Every click flips it again, and the desktop shows a false "Remote · Loop on/off" alert for its own action.

#### FE-04 — High — Keyboard activation fires twice, and Enter on nested controls activates the parent as well
- **Where:** `src/static/js/desktop/app.js:44-46` combined with `src/static/js/desktop/markers.js:56-61` and `src/static/js/desktop/fxpads.js:24-26`, `40-41`.
- **Defect:** The global keydown handler calls `target.click()` for any focused `[role=button]`. Elements that also handle keydown themselves therefore run twice, and keydown events from nested buttons bubble up to the parent's handler.
- **Failure scenario:**
  - Enter on a section in the lane runs `jump()` twice: the loop toggles twice and ends up off, and the seek and scene recall are each sent twice.
  - Enter on a section's delete button both jumps and deletes.
  - Enter on a pad's "edit" span triggers the sample *and* opens the editor.

#### FE-05 — High — The WebSocket client can hold several live connections at once
- **Where:** `src/static/ws_telemetry.js:52-66`, `src/static/ws_telemetry.js:111-118`; the phone watchdog and visibility handling at `src/static/js/remote/app.js:116-122`.
- **Defect:** `connect()` replaces `socket` without closing or detaching the previous one, and resets `explicitClose`. The old socket's `onclose` later schedules another reconnect.
- **Failure scenario:**
  1. The watchdog closes socket A.
  2. The page becomes visible again, so `connect()` creates socket B while A is still closing.
  3. A's `onclose` fires and opens socket C.
  4. B is never tracked or closed.

  The phone now parses two 25 fps streams into `R.ingest`, and the server runs a second telemetry loop (with its own UDP meter queries) for it. The same happens when `connect()` is called while a socket is still connecting.

#### FE-06 — High — Full static state is resent in every 40 ms frame and parsed 25 times a second on the phone
- **Where:** `src/server.py:286-321` as consumed by `src/static/js/desktop/telemetry.js`, `src/static/js/desktop/fxpads.js` and `src/static/js/remote/pads.js` (see PY-41).
- **Defect:** The e2e fixture frame is about 40 KB, 32.8 KB of it `fx_pads`. That is roughly 1 MB/s per client. The client replaces `S.peaks`, `st.pads` and `S.chart` with new arrays on every frame, so identity-based caches never hit (FE-10).
- **Failure scenario:** The phone overheats and drains its battery on stage, frames arrive late on congested Wi-Fi, and the UI lags behind the music.

### 4.2 Medium

#### FE-10 — Medium — The waveform canvas is reallocated and repainted every frame
- **Where:** `src/static/js/desktop/waveform.js:15`.
- **Defect:** `peaks === drawnPeaks` is never true, because each frame parses a new array. `drawWaveform` reassigns `canvas.width`, which reallocates the backing store, and repaints all 800 bars 25 times a second, even while paused.

#### FE-11 — Medium — "Learn chords" records passing voicings
- **Where:** `src/static/js/desktop/telemetry.js:53-63`.
- **Defect:** Whatever chord is detected in any single frame is posted as `record_chord`, with no requirement that it stays stable for a while. The server only de-duplicates the *same* name within 0.4 s.
- **Failure scenario:** Rolled chords, adding or lifting one note, and legato overlaps between chords each record a spurious chord, so the timeline fills with junk.

#### FE-12 — Medium — The desktop's own actions show as "Remote · …" alerts
- **Where:** `src/static/js/desktop/telemetry.js:81-89`, `src/static/js/desktop/song.js:107-121`, `src/static/js/desktop/markers.js:27-29`, `src/song_player.py:474-478`.
- **Defect:** `LW.local.mark` isn't called for uploads, for loading a track while playing (the load stops playback), for the end of a song, or for section-click loop toggles. Long uploads and decodes also outlast the 1.8 s window.
- **Failure scenario:** Uploading a track on the desktop shows "Remote · Song loaded", and the end of every song shows "Remote · Pause".

#### FE-13 — Medium — The phone's key selector is overwritten 40 ms after the user changes it
- **Where:** `src/static/js/remote/state.js:71-76`.
- **Defect:** Every telemetry frame whose analysis key differs from the selected key resets the key and emits `r-key`. The desktop only applies the analysis key when it changes, so the two clients behave differently.
- **Failure scenario:** On an analysed song, it's impossible to pick another key for Nashville numbers on the phone.

#### FE-14 — Medium — Phone mixer: one shared throttle slot loses values
- **Where:** `src/static/js/remote/mix.js:12-30`, `src/static/js/remote/mix.js:69`.
- **Defect:** Track, synth, master, click and all four EQ bands share one throttle that holds a single pending argument. Releasing a control doesn't flush it.
- **Failure scenario:** Moving two faders with two fingers, or two controls within 50 ms, drops the first control's final value. The fader then rests on a position the server never received.

#### FE-15 — Medium — Phone tap tempo never resets after a pause
- **Where:** `src/static/js/remote/mix.js:46-57` (desktop: `src/static/js/desktop/metronome.js:40` resets after 2 s).
- **Failure scenario:** Taps at 500, 500 and then 3000 ms intervals average out to 45 BPM, which is sent. The phone also accepts 30–300 BPM, while the desktop accepts 40–280.

#### FE-16 — Medium — Opening or waking any client mid-song re-applies the current section's scene
- **Where:** `src/static/js/desktop/markers.js:94-109`, `src/static/js/remote/song.js:57-68`; `src/montage_host.py:724-739`.
- **Defect:** Each client tracks its own `lastTriggered`, starting at `null`. The first playing frame after a client connects therefore recalls the current bookmark's scene, which re-applies the stored part and master volumes. With two clients open, every bookmark crossing sends two recalls.
- **Failure scenario:** The phone wakes from sleep mid-song and resets every mix change made since that section started.

#### FE-17 — Medium — The service worker, registered with scope `/`, serves stale scripts to both pages after an update
- **Where:** `src/static/sw.js:100-117`; `src/static/js/remote/app.js:125`; `src/static/manifest.json` (`scope: "/"`). See also HYG-05.
- **Defect:** Shared assets (kit JS and CSS, `chord_timeline.js`, `browser_api.js`, `ws_telemetry.js`) are precached and served cache-first. Desktop-only modules are never cached, and `/remote` HTML is network-first. `CACHE_NAME` is a hand-maintained constant.
- **Failure scenario:** After an update, both pages run new HTML and modules on top of the old cached kit until they are reloaded again. The desktop is affected too, once `/remote` has ever been opened in that browser profile.

#### FE-18 — Medium — The desktop takes the engine type from `localStorage`, not from the server
- **Where:** `src/static/js/desktop/parts.js:14`, `src/static/js/desktop/engine.js:6-22`.
- **Defect:** The `montage.engine_type` field in telemetry is never read.
- **Failure scenario:** The engine is changed by the phone, a setlist patch (`apply_song_patch` can switch engines), another browser or a server restart. The desktop then shows the wrong engine and shows or hides the wrong controls (voice selects, for example), and disagrees with the phone, which does use the server value.

#### FE-19 — Medium — Chord priority and Nashville formats are inconsistent
- **Where:** `src/static/js/desktop/song.js`, `src/static/js/remote/state.js:37-49`, `src/analyzer.py:205-208`, `src/static/chord_timeline.js:200`.
- **Defect:** The desktop prefers the chart chord and the phone prefers the live MIDI chord, which contradicts its own comment. The chart mixes two Nashville formats: the analyser's `6m` and learned chords' `[6-]`. The phone adds brackets on top.
- **Failure scenario:** Learned chords show on the phone as `[[6-]]`.

#### FE-20 — Medium — Alerts that arrive during a sticky Undo alert are dropped
- **Where:** `src/static/js/kit/island.js:74-79`, `src/static/js/kit/island.js:93`.
- **Defect:** An Undo alert stays for 8 s. Alerts that arrive meanwhile are queued (at most 3), but `finishAlert` shows only the last one and clears the rest.
- **Failure scenario:** "Connection lost", "Audio engine overloaded" or "MIDI keyboard disconnected" right after a Clear or Delete is lost, or appears up to 8 s late.

#### FE-21 — Medium — The analyzer visibility flag is global and never released
- **Where:** `src/static/js/desktop/eq.js:181-183`; `src/runtime.py:142`, `src/runtime.py:241-244`.
- **Defect:** It is a single 0/1 flag, not a per-client count.
- **Failure scenario:** One client leaving the EQ tab stops the spectrum for every client. A client closing while EQ is visible leaves spectrum bins streaming to everyone indefinitely.

#### FE-22 — Medium — Ear-training answers are checked against a different exercise
- **Where:** `src/static/js/desktop/ear.js:10-45`, `src/static/js/remote/sheets.js:21-47`; `src/ear_training.py:442-444`.
- **Defect:** `load()` responses aren't sequenced, so a late response can overwrite a newer one, and all clients share the server's single current exercise. A `{success:false, message}` reply is shown as "The answer was undefined".
- **Failure scenario:** Rapid "Next" clicks, or the phone generating an exercise, mark correct answers wrong.

### 4.3 Low

- **FE-30:** The "Note X · vel Y" readout from `midi_event` is overwritten within 40 ms by telemetry. That shows the highest held note with no velocity, so velocity is effectively never visible (`src/static/js/desktop/keyboard.js:93-99`).
- **FE-31:** FX pad pointer and key handling (`src/static/js/desktop/fxpads.js:36-41`):
  - no `pointercancel` handler, so a gate pad keeps sounding after a cancelled touch;
  - keydown ignores `e.repeat`, so holding a key retriggers one-shot pads and flips toggle pads repeatedly;
  - a right-click sends a release without a press.
- **FE-32:** The pad "Vol" readout puts "%" after a 0–127 value (`src/static/js/desktop/fxpads.js:23`), so 95 is shown as "95%" though it is about 75%.
- **FE-33:** "Quick add" and the phone's "+ Setlist" always store key "C" and use the filename as the title. The library list isn't refreshed after analysis, so its keys stay stale (`src/static/js/desktop/setlist.js:173`, `src/static/js/remote/sheets.js:100`).
- **FE-34:** The chord-lane and Stage runway caches key only on length, duration and the first and last chord, so edits in the middle of the chart don't redraw. Bookmarks added in Stage mode don't appear on the runway (`src/static/js/desktop/waveform.js:56`, `src/static/js/desktop/stage.js:38`).
- **FE-35:** The lyrics render key ignores `hasTrack`, so the empty-state text never switches. After seeking to before the first line, the old line stays highlighted (`src/static/js/desktop/lyrics.js:20`, `39`).
- **FE-36:** Some controls send one HTTP POST per `pointermove`, and every `/api/mixer` reply also triggers a UDP meter query on the server:
  - click level (`src/static/js/desktop/metronome.js:59`);
  - FX bus (`src/static/js/desktop/fxpads.js:138`);
  - Stage-mode sliders, through `LW.mixer.set`, which sends directly and skips the mixer's throttle (`src/static/js/desktop/stage.js:111`);
  - part sliders (`src/static/js/desktop/parts.js:40`, `src/static/js/remote/parts.js:39`);
  - the EQ wheel (`src/static/js/desktop/eq.js:159`).
- **FE-37:** Desktop EQ band drags are sent only on pointerup, so there is no audible feedback while dragging. The phone EQ sends live (`src/static/js/desktop/eq.js:132-148`).
- **FE-38:** The metronome pulse light runs on a free local timer and drifts away from the audible click. It and the island EQ bars register permanent `onFrame` callbacks, so the page writes styles 60 times a second forever, even when idle (`src/static/js/desktop/metronome.js:68-76`, `src/static/js/kit/island.js:164`).
- **FE-39:** Specific analyzer errors (409, 404, 500) are all replaced by "The analyzer did not respond". After the song changes, the phone button still reads "Analyzed" (`src/static/js/desktop/song.js:167-168`, `src/static/js/remote/song.js:112`).
- **FE-40:** Preferences issues (`src/static/js/desktop/prefs.js`):
  - "Audio output changed" is shown even when `start_stream` returned `success: false` (`:54-58`);
  - the velocity scale and offset sliders cover only 0.5–1.5 and ±30, while the server allows 0.1–4 and ±127, so wider stored values are clamped in the UI and overwritten on the next touch (`:72-73`);
  - `LW.state.lastStatus` is read but never assigned (`:96`);
  - opening Preferences calls `/api/status`, which forces device re-enumeration (PY-64).
- **FE-41:** The phone has no A/B controls, so "Loop" just flips `loop_enabled`. The UI says "Loop on" and the next frame reverts it. With only `loop_b` set, playback loops from 0 (`src/static/js/remote/song.js:126`).
- **FE-42:** `lastMessageAt` isn't reset when a socket opens, so the watchdog can close a freshly opened socket before its first frame arrives (`src/static/js/remote/app.js:116-119`).
- **FE-43:** Service worker issues:
  - the network-first `/remote` response is cached without checking `res.ok`, so a 404 or 500 during server startup becomes the offline page (`src/static/sw.js:84-88`);
  - the Google Fonts branch is dead code now that the font is bundled (`src/static/sw.js:63-76`).
- **FE-44:** Accessibility:
  - the whole island is a polite live region whose time text changes every second, so screen readers announce it constantly (`src/static/js/kit/island.js:17-18`);
  - sheets set `aria-modal="true"` (non-modal Stage sheets included) but neither trap nor return focus (`src/static/js/kit/sheet.js`);
  - menus have no arrow-key navigation (`src/static/js/kit/controls.js:229-262`);
  - sliders lack Home/End/PageUp/PageDown, and vertical faders lack `aria-orientation`;
  - interactive elements are nested inside other interactive elements: `role=button` spans inside buttons, and a button inside a `role=button` div (`sbDrone`);
  - `user-scalable=no` blocks pinch zoom (`src/static/remote.html:5`).
- **FE-45:** The phone's setlist and library "Load" actions report success even when `/api/playlist/select` failed. The phone's active setlist isn't persisted and resets to `sunday_morning` (`src/static/js/remote/sheets.js:82-97`).
- **FE-46:** `src/static/js/desktop/eq.js:53` hard-codes the dark canvas colour `#141416` instead of a theme token, so it's wrong in light theme. `R.mix.eqGain` in `src/static/js/remote/mix.js:41` is unused.
- **FE-47:** The Space, B, P, L, `[` and `]` shortcuts stay active while a modal dialog is open (`src/static/js/desktop/app.js:61-67`), so playback can toggle or another sheet can open behind a confirmation dialog.
- **FE-48 (unconfirmed, needs a device test):** `.pages` in `src/static/css/remote.css:24-28` has no `touch-action`, while the horizontal swipe in `src/static/js/remote/app.js:21-58` relies on continuous `pointermove`. Mobile browsers may claim the gesture for native panning and send `pointercancel`, which would break swiping on iOS Safari and Android Chrome.
## 5. Classic UI and dead legacy files

#### LEG-01 — High — Stored XSS in the classic setlist (song `id` is client-controlled and placed unescaped in inline handlers)
- **Where:** `src/static/classic/index.html:4640`, `4650`, `4651`, `4652`; source of the value: `src/api_setlist.py:47-63` and `src/setlist_manager.py:96-98` (a client-supplied `"id"` in `song_data` is stored as-is).
- **Defect:** Rows are built with `onclick="loadAndApplySetlistSong('${cur.id}', '${song.id}')"`. Titles are escaped, IDs are not, and the server accepts any `id` string inside `song_data`.
- **Failure scenario:** A LAN device posts `{"action":"add_song","setlist_id":"sunday_morning","song_data":{"title":"x","id":"');alert(document.domain);('"}}`. The next time the user clicks that row in the classic UI, the injected code runs with full API access. The payload is saved to disk, so it survives restarts.

#### LEG-02 — Medium — XSS through custom scene names in the classic UIs
- **Where:** `src/static/classic/index.html:5301`, `src/static/classic/remote.html:1667` (`btn.innerHTML = \`… Saved to ${sName}!\``).
- **Defect:** Scene names are written by `/api/montage/names` with no auth (PY-01) and only cut to 24 characters (`src/montage_host.py:228`). That still fits `<img src=x onerror=…>`. Everywhere else, the classic UI escapes them.

#### LEG-03 — Medium — The classic UI's QR code sends the LAN URL to a third-party service
- **Where:** `src/static/classic/index.html:4990`, `4996` (`https://api.qrserver.com/...?data=<LAN URL>`); Google Fonts at `src/static/classic/index.html:7-9` and `src/static/classic/remote.html:14-16`.
- **Defect:** The machine's private IP and port go to an outside host every time the QR code is shown. Offline, there is no QR code, and the "fallback" UI renders in a different font.

#### LEG-04 — Medium — About 7,700 lines of dead legacy assets are still shipped and served
- **Where:** `src/static/desktop_*.js`, `src/static/remote_*.js`, `src/static/desktop.css`, `src/static/remote.css` (the top-level ones, not `css/remote.css`).
- **Defect:** No HTML page, service worker, route or test loads them, but `/static` still serves them publicly. Each one duplicates a feature that now lives in `js/…`, frozen at an older version.
- **Failure scenario:** An agent or developer "fixes" a bug in `desktop_core.js` and nothing changes. A grep for any feature turns up stale twin implementations that mislead.

#### LEG-05 — Low — `src/static/icon.svg` is out of date
- **Where:** referenced only by `src/static/classic/remote.html:13`.
- **Defect:** `tools/make_icon.py` doesn't regenerate it, so it still shows the pre-redesign mark. `src/static/icon-192.png` and `icon-512.png` are byte copies of `assets/icon/…`, and the generator writes only to `assets/icon/`, so the PWA icons drift apart on the next regeneration.

## 6. Tests and verification

**Actual run (Python 3.13, Node 22, in a clean container):**
- Before any optional install, 16 of the 17 Python checks fail on import, because `src.server` pulls in `mido` at import time.
- With the dependencies installed:
  - **Pass:** all 6 Node checks; `check_e2e.mjs` (30/30, with the QR decode sub-check skipped because BarcodeDetector isn't available); and 15 Python checks: `check_architecture_slice1`, `check_runtime_extraction`, `check_user_data`, `check_fx_pads_api`, `check_playlist_api`, `check_montage_api`, `check_practice_api`, `check_setlist_api`, `check_analysis_api`, `check_doc_and_quality`, `check_api_validation`, `check_realtime_safety`, `check_song_player`.
  - **Fail:** `check_adversarial_safety` and `check_scene_bookmark_sync`.
  - **Not runnable here:** `check_analyzer` (librosa) and `check_device_hotplug` (PortAudio and real devices).

#### TST-01 — High — `tests/check_scene_bookmark_sync.py` can never pass, and its value leaked into shipped data
- **Where:** `tests/check_scene_bookmark_sync.py:14-30`; `src/custom_names.json`.
- **Defect:** It uses `TestClient(app)` without `with`, so the lifespan never runs and `state.montage` is `None`, which gives a 400 at line 18. It also loads a copyrighted MP3 from the developer's machine by its hard-coded file name (line 29). The "Lead Synth" scene name it writes went into the tracked `src/custom_names.json` in commit 4a7c3b6, the same commit that added the test. Every fresh install now starts with that test value.

#### TST-02 — High — `tests/check_adversarial_safety.py` boots real hardware, and its import is broken
- **Where:** `tests/check_adversarial_safety.py:9`, `tests/check_adversarial_safety.py:71`.
- **Defect:** It has no `sys.path` setup, so it fails with `No module named 'src'` when run as documented. With the path fixed, `with TestClient(app)` runs `AppState.boot()`: it opens the real audio stream, MIDI port 0, UDP sockets and the monitor thread, which README §6 explicitly forbids in tests. It also enters the lifespan twice. After the first shutdown `_booted` stays `True`, so the second block runs against a stopped stream and a closed socket.

#### TST-03 — Medium — `tests/check_device_hotplug.py` depends on the machine and can't pass as written
- **Where:** `tests/check_device_hotplug.py:99-108`, `tests/check_device_hotplug.py:111-119`.
- **Defect:** The voicing test runs without a lifespan, so `montage` is `None`. The hot-plug test builds a real `AudioEngine` and asserts that at least one output device exists.

#### TST-04 — Medium — README's test list isn't the real suite, and there is no CI
- **Where:** README §4; no `.github/` folder, no runner script.
- **Defect:** README omits 7 scripts: `check_adversarial_safety`, `check_realtime_safety`, `check_scene_bookmark_sync`, `check_song_player`, `check_analyzer`, `check_device_hotplug`, `check_api_validation`. The three broken checks are all among them. README also never says which packages the "no-hardware" Python checks need (mido, miniaudio, soundfile, starlette, httpx, python-multipart), or that one environment setup command exists.

#### TST-05 — Medium — Many checks assert source text instead of behaviour
- **Where:** `tests/check_architecture_slice1.py` (for example `"start_stream" in boot_source`, `'"bank": "E"' in source`, and a comment containing `"E"` in `fx_sampler.py`); `tests/check_doc_and_quality.py` (README heading strings); `tests/check_frontend_extraction.js` (the exact `sw.js` cache-name literal).
- **Defect:** They break on harmless refactors and stay green when the behaviour is broken.

#### TST-06 — Medium — The "safe import" contract test misses the real side effects
- **Where:** `tests/check_doc_and_quality.py` (`test_safe_server_import_contract`).
- **Defect:** It checks only that `state.audio/midi/montage` are `None` and `_booted` is False. Import still loads `mido`, creates `data/` and `src/static/uploads/`, and writes `saved_playlist.json` (PY-61).

#### TST-07 — Medium — No coverage of the riskiest areas
- **Defect:** None of these has any test:
  - the C++ hosts and their UDP protocol;
  - the `/ws` telemetry loop and the size of its frames;
  - upload handling (size, type, name);
  - `update_pad` with an arbitrary `sample_path`;
  - ID integrity for setlists, songs and markers;
  - the metronome phase after `sync_to_playhead` (PY-12);
  - sample-rate changes (PY-11, CPP-04);
  - XSS in either UI.
- The e2e suite runs against a fake server built from `tests/e2e/fixtures/api.json`. Nothing checks those fixtures against the real handlers, so a backend contract change (for example PY-43) goes unnoticed.

#### TST-08 — Low — "In-memory" checks still create real resources
- **Where:** `tests/check_device_hotplug.py`, `tests/check_realtime_safety.py`.
- **Defect:** They construct a real `MidiManager` (a worker thread that scans ports) and an `AudioEngine` (which opens a UDP socket).

## 7. Repository hygiene, packaging and docs

#### HYG-01 — High — The tracked "legacy default" JSON files are the developer's personal data
- **Where:**
  - `src/saved_playlist.json` lists the developer's copyrighted MP3 file names, none of which exist in a clone.
  - `src/custom_names.json` has "Nord Stage 3 Romantic Grand", "Roland Warm Analog Pad" and the test's "Lead Synth".
  - `src/midi_settings.json` has heavy2, scale 0.85 and offset −3.
  - `src/scene_presets.json` and `src/master_dsp_settings.json` hold tuned values.
  - `src/fx_pads_settings.json` has absolute paths (PY-31).
- **Defect:** `user_data.data_path` copies all of these into each new user's `data/` on first run. Missing playlist files are never pruned, so a fresh install lists songs that can't load and starts with someone else's velocity curve.

#### HYG-02 — Medium — `pyproject.toml` dependencies are wrong
- **Where:** `pyproject.toml:9-29`.
- **Defect:**
  - **Declared but never imported:** `pedalboard`, `pefile`, `aiofiles` and `asio`. `asio==1.1` is an unrelated 2015 sdist-only PyPI package, has nothing to do with ASIO audio, and gets built from source on install.
  - **Required but optional:** `torch` (several GB) and `transformers` are hard requirements, though only a lazy, optional path uses them.
  - **Used but undeclared:** `numpy` and `scipy` are imported directly in about 10 modules and only arrive through librosa. `pillow` is needed by `tools/make_icon.py`.
  - **Metadata:** `name = "montage-practice-daw"` and the description is still "Add your description here".

#### HYG-03 — Medium — Packaging layout breaks the installed entry point
- **Where:** `pyproject.toml:31-37`; path logic in `src/main.py:19`, `src/user_data.py:275-285`, `src/fx_sampler.py:27`.
- **Defect:** `packages = ["src"]` installs a top-level package literally called `src`, which can collide with other projects. Once installed:
  - `ICON` resolves to `site-packages/assets/icon/app.ico`, but `assets/` isn't packaged;
  - `data/` is created inside site-packages;
  - uploads go into the installed package;
  - the pad manifests and native binaries are missing.
- **Failure scenario:** After `uv tool install .` or `pip install .`, `litwave` runs with no icon and no pads, and keeps its user data inside the venv.

#### HYG-04 — Medium — Native engine binaries, the VST3 SDK and SoundFonts are undocumented external dependencies
- **Where:** `.gitignore` (`cpp_host/*.exe`, `vst3_sdk/`, `cpp_host/soundfonts/`); `cpp_host/compile_*.bat`; README.
- **Defect:** README has no build steps for either host. It doesn't say where the VST3 SDK or the SoundFonts come from, and doesn't say the Yamaha engine executable is `montage_live_engine.exe` while the source file is `native_complete_host.cpp`. The build scripts point at the developer's profile path (CPP-54, PY-60).

#### HYG-05 — Medium — The service worker serves stale and mismatched asset versions after an update
- **Where:** `src/static/sw.js:2`, `src/static/sw.js:105-117`; registration at `src/static/js/remote/app.js:125` (scope `/`); `tests/check_frontend_extraction.js` pins the cache-name literal.
- **Defect:** The cache name is a fixed constant. `/remote` is fetched network-first, but every JS and CSS file is cache-first with background revalidation.
- **Failure scenario:** After an update, the phone loads the new `remote.html` with the old `js/remote/*.js` and `js/kit/*.js`, so new markup runs against old modules until a second reload. Because the scope is `/` and the pywebview profile persists, the desktop window can likewise get cached shared kit and core scripts next to fresh desktop modules. See also the frontend section.

#### HYG-06 — Low — `src/generate_factory_fx.py` is inaccurate and slow
- **Defect:**
  - The docstring, the generated `LICENSES.md` and the final print all say 32 samples; there are 48.
  - The RNG isn't seeded, so regenerating produces different audio with identical metadata.
  - `write_wav_24bit` mutates its caller's array and packs 24-bit samples one byte at a time in Python.
  - It claims "−3 dBFS true peak" and "zero-crossing micro-fades", but does sample-peak normalisation and a fixed linear fade.
  - It writes two manifests with identical content.

#### HYG-07 — Low — `.gitignore` patterns are too broad
- **Defect:** `make_*.py`, `create_*.py`, `setup_*.py`, `update_*.py`, `test_*.py`, `launch_*.py` and `inspect_*.py` silently hide future real scripts. `tools/make_icon.py` already needed an exception.

#### HYG-08 — Low — The docs don't match the code
- README §6 says UDP 9000/9001; the code uses 9123.
- README §7 tells you to preserve `master_dsp_settings.json.tmp` and `dump_params.cpp`; neither exists.
- README §1 and §6 say importing `src.server` has no side effects (contradicted by PY-61).
- README says `/static/classic/` is "kept unchanged as a fallback", yet it has the XSS issues above and depends on the internet.
- `PROMPT_ENGINE.md` describes requirements the code doesn't meet (FastAPI-or-Starlette, pitch bend, CC1 forwarding, tempo scaling) and reads like a historical prompt rather than a spec. Nothing marks it as non-authoritative.
- Docstrings describe "Impeccable studio frontend" and "4 Banks x 8 Pads".
