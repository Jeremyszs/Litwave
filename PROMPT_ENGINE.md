You are the Lead Audio Engine & VST3 Architect.
Task: Build a high-performance, studio-grade Lite DAW practice backend in Python/C++ for Yamaha MONTAGE M VST3 plugin, MIDI keyboards, pedals, and MP3 backing track playback.

Key requirements:
1. Audio Engine (`src/audio_engine.py`):
   - Real-time low latency ASIO driver support via sounddevice (set `os.environ["SD_ENABLE_ASIO"] = "1"`). Fallback gracefully to WASAPI / DirectSound / MME if ASIO device is offline.
   - Dual-track mixing: Backing Track stream + Instrument/Plugin stream + Metronome click generator with independent volume faders, mute/solo, and soft master limiter.
   - Low-latency circular buffer mixing with precise timecode tracking.

2. MIDI & Pedal Input Manager (`src/midi_manager.py`):
   - Supports MIDI Keyboard input (Note On, Note Off, Pitch Bend, Modulation CC1).
   - Dedicated Support for Pedalboard / Pedals:
     * Sustain / Damper pedal (CC64 - toggle or continuous 0-127)
     * Expression pedal (CC11 - 0-127 dynamic curve)
     * Soft pedal (CC67)
     * Volume pedal (CC7)
   - Auto-reconnect and device hotplug detection with rtmidi/mido.
   - Broadcast live MIDI events via WebSocket/callback for UI telemetry (key presses, pedal state, chord display).

3. Backing Track & Song Player (`src/song_player.py`):
   - MP3 / WAV / FLAC / AAC audio loader and stream player (using soundfile / miniaudio).
   - A-B Looper: precise sample-accurate loop start & end points for targeted practice.
   - Speed / Tempo scaling: 0.5x to 1.5x speed control.
   - High-density audio waveform extraction for visualization in the UI.

4. Yamaha MONTAGE M Host (`src/montage_host.py`):
   - Points to `C:\Program Files\Common Files\VST3\Yamaha\Expanded Softsynth Plugin for MONTAGE M.vst3\Contents\x86_64-win\Expanded Softsynth Plugin for MONTAGE M.vst3`.
   - Manages plugin lifecycle, preset banks, and launch/dock wrapper for Yamaha editor GUI.

5. REST API & WebSocket Telemetry Server (`src/server.py`):
   - Lightweight FastAPI/Starlette server.
   - WebSocket streaming for VU meters (Track L/R, Synth L/R, Master L/R), active MIDI keys, pedal values (CC64, CC11, CC67), song playhead position, loop state.
   - HTTP endpoints for Play/Pause, Seek, Volume, Loop A/B, Device select (ASIO / WASAPI, MIDI In).
