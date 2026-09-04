# Implementation Plan: Unified Audio Submix for OBS Application Audio Capture

**Goal:** Route mixed Backing Track and Yamaha MONTAGE M VST audio into `montage_live_engine.exe` so OBS Studio can record Litwave as a dedicated, isolated application source via Windows Application Audio Capture (BETA) without capturing desktop audio.

**Architecture:**
1. Backing track PCM frames decoded in Python (`src/audio_engine.py` / `src/song_player.py`) are streamed over a local low-latency loopback UDP socket to `montage_live_engine.exe`.
2. The C++ native engine maintains a lock-free circular audio ring buffer for incoming backing track samples.
3. In `audio_data_callback`, the miniaudio engine mixes the backing track samples directly with the stereo VST synthesizer output (`g_synth_out_l` / `g_synth_out_r`) into a single stereo output device.
4. OBS Studio captures `[montage_live_engine.exe]` using `Application Audio Capture (BETA)`, providing clean, zero-latency, isolated audio containing both synth and song.

---

### Task 1: Add UDP Audio Streaming in C++ Native Host (`cpp_host/native_complete_host.cpp`)
- Add circular ring buffer for incoming stereo PCM float audio (backing track).
- Update `UdpControlServerThread` to accept audio packet chunks (Command `0x41 'A'`).
- In `audio_data_callback`, mix backing track ring buffer into `pOut` alongside VST audio.
- Recompile `montage_live_engine.exe`.

### Task 2: Update Python Audio Engine (`src/audio_engine.py`)
- Add direct UDP PCM socket streaming to `127.0.0.1:9123` inside `_audio_callback`.
- When routing to the unified C++ engine, stream the mixed backing track + metronome frames directly to the host.
- Keep local speaker playback disabled or mirrorable so you don't hear double audio.

### Task 3: Test & Verify
- Verify PCM streaming from Python to C++ at 44.1kHz stereo.
- Check latency and buffer health.
- Verify OBS Studio detects `montage_live_engine.exe` in `Application Audio Capture (BETA)` and meters both synth and backing track.

### Task 4: Commit & Push to Git
- Commit changes and push to GitHub.
