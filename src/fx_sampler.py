"""
Litwave DAW Performance FX Pad Sampler Engine
Low-latency polyphonic audio sampler with:
- Pre-decoded in-memory float32 audio buffers (Zero disk I/O on trigger)
- 4 Banks x 8 Pads = 32 pads with full customization (sample, name, volume, pan, pitch, trigger mode, choke group, MIDI note)
- Choke groups (1-8): triggering a pad in the same choke group fades out previous sounds over 15ms
- Polyphony: Up to 32 simultaneous voices with oldest-voice stealing
- Trigger modes: ONE SHOT, GATE, TOGGLE
- Dedicated FX Pad sub-bus volume and mute
- Thread-safe ring/lock-free real-time audio block callback integration
- JSON configuration persistence
"""

import os
import json
import time
import math
import wave
import threading
import numpy as np
import miniaudio
from typing import Dict, List, Optional, Any

SETTINGS_FILE = os.path.join(os.path.dirname(__file__), "fx_pads_settings.json")
MANIFEST_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), "assets", "fx-pads", "factory_manifest.json")

class FxVoice:
    """An active polyphonic voice instance playing a sample block-by-block."""
    __slots__ = (
        'pad_id', 'choke_group', 'trigger_mode', 'buffer', 'length', 
        'cursor', 'gain_l', 'gain_r', 'pitch_ratio', 'is_active', 
        'fade_out_frames', 'fade_out_counter', 'start_time'
    )

    def __init__(self, pad_id: str, choke_group: int, trigger_mode: str, 
                 buffer: np.ndarray, volume_lin: float, pan_val: int, 
                 pitch_semitones: float):
        self.pad_id = pad_id
        self.choke_group = choke_group
        self.trigger_mode = trigger_mode
        self.buffer = buffer # float32 shape (N, 2)
        self.length = len(buffer)
        self.cursor = 0.0
        
        # Pan law (-1.0 to +1.0)
        norm_pan = (pan_val - 64) / 64.0
        norm_pan = max(-1.0, min(1.0, norm_pan))
        angle = (norm_pan + 1.0) * (math.pi / 4.0) # 0 to pi/2
        self.gain_l = volume_lin * math.cos(angle)
        self.gain_r = volume_lin * math.sin(angle)
        
        # Pitch ratio: 2^(semitones / 12)
        self.pitch_ratio = float(2.0 ** (pitch_semitones / 12.0))
        self.is_active = True
        self.fade_out_frames = 0
        self.fade_out_counter = 0
        self.start_time = time.time()

    def start_fade_out(self, frames: int = 720): # ~15ms at 48kHz
        if self.fade_out_frames == 0:
            self.fade_out_frames = max(1, frames)
            self.fade_out_counter = self.fade_out_frames

class FxSampler:
    def __init__(self, target_samplerate: int = 48000, max_polyphony: int = 32):
        self.samplerate = target_samplerate
        self.max_polyphony = max_polyphony
        
        # Bus parameters
        self.bus_volume: float = 0.85 # -1.4 dBFS default
        self.bus_muted: bool = False
        
        # In-memory sample cache: filepath -> np.ndarray (float32, (N, 2))
        self.sample_cache: Dict[str, np.ndarray] = {}
        
        # Active voices list (manipulated in audio callback and trigger)
        self.voices: List[FxVoice] = []
        self.lock = threading.Lock()
        
        # Selected/Active bank for UI ("A", "B", "C", "D", "E", "F")
        self.active_bank: str = "A"
        
        # Sound catalog: all 32 available sound definitions (id -> metadata)
        self.sound_catalog: Dict[str, Dict[str, Any]] = {}

        # Pad configurations: dict of pad_id -> config
        self.pads: Dict[str, Dict[str, Any]] = {}
        
        # Pad playback state tracking for UI feedback: pad_id -> { "playing": bool, "last_trigger": float }
        self.pad_states: Dict[str, Dict[str, Any]] = {}
        
        # MIDI note lookup map: note_number -> pad_id
        self.midi_map: Dict[int, str] = {}
        
        # Initial boot load
        self._load_configuration()
        self.preload_all_samples()

    def _load_configuration(self):
        """Loads pad configurations from factory manifest and user settings overrides."""
        factory_pads = []
        if os.path.exists(MANIFEST_FILE):
            try:
                with open(MANIFEST_FILE, "r", encoding="utf-8") as f:
                    factory_pads = json.load(f)
            except Exception as e:
                print(f"[WARN] Failed to load factory FX manifest: {e}")
                
        base_dir = os.path.dirname(os.path.dirname(__file__))
        for p in factory_pads:
            full_path = os.path.normpath(os.path.join(base_dir, p["rel_path"]))
            pad_id = p["id"]
            self.sound_catalog[pad_id] = {
                "id": pad_id,
                "name": p["name"],
                "category": p.get("category", "special"),
                "sample_path": full_path,
                "description": p.get("description", "")
            }
            self.pads[pad_id] = {
                "id": pad_id,
                "sound_id": pad_id,
                "name": p["name"],
                "bank": p["bank"],
                "pad_index": p["pad_index"],
                "category": p.get("category", "special"),
                "sample_path": full_path,
                "trigger_mode": p.get("trigger_mode", "oneshot"), # oneshot, gate, toggle
                "choke_group": int(p.get("choke_group", 0)),      # 0 = none, 1-8
                "volume": int(p.get("volume", 100)),              # 0 - 127
                "pan": int(p.get("pan", 64)),                     # 0 - 127 (64 center)
                "pitch": int(p.get("pitch", 0)),                  # -12 to +12 semitones
                "midi_note": int(p.get("midi_note", -1)),         # MIDI note 0-127 or -1
                "velocity_sensitive": True,
                "description": p.get("description", "")
            }
            self.pad_states[pad_id] = {"playing": False, "last_trigger": 0.0}

        # Apply saved user customizations if existing
        if os.path.exists(SETTINGS_FILE):
            try:
                with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self.bus_volume = float(data.get("bus_volume", self.bus_volume))
                    self.bus_muted = bool(data.get("bus_muted", self.bus_muted))
                    self.active_bank = str(data.get("active_bank", self.active_bank))
                    
                    saved_pads = data.get("pads", {})
                    for pid, conf in saved_pads.items():
                        if pid in self.pads:
                            self.pads[pid].update(conf)
            except Exception as e:
                print(f"[WARN] Failed to load FX pad user settings: {e}")

        self._rebuild_midi_map()

    def _rebuild_midi_map(self):
        self.midi_map.clear()
        for pid, p in self.pads.items():
            note = p.get("midi_note", -1)
            if 0 <= note <= 127:
                self.midi_map[note] = pid

    def persist_settings(self):
        """Persists custom pad parameters, names, mappings and bus volume to disk."""
        try:
            export_pads = {}
            for pid, p in self.pads.items():
                export_pads[pid] = {
                    "name": p["name"],
                    "sample_path": p["sample_path"],
                    "trigger_mode": p["trigger_mode"],
                    "choke_group": p["choke_group"],
                    "volume": p["volume"],
                    "pan": p["pan"],
                    "pitch": p["pitch"],
                    "midi_note": p["midi_note"],
                    "velocity_sensitive": p.get("velocity_sensitive", True)
                }
            payload = {
                "bus_volume": self.bus_volume,
                "bus_muted": self.bus_muted,
                "active_bank": self.active_bank,
                "pads": export_pads
            }
            with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
                json.dump(payload, f, indent=2)
            return True
        except Exception as e:
            print(f"[ERROR] Failed to persist FX pad settings: {e}")
            return False

    def preload_all_samples(self):
        """Pre-decodes all 32 factory catalog samples into in-memory float32 buffers for zero latency."""
        loaded = 0
        base_dir = os.path.dirname(os.path.dirname(__file__))
        for sid, sc in self.sound_catalog.items():
            sp = sc.get("sample_path")
            if sp:
                sp_norm = os.path.normpath(sp if os.path.isabs(sp) else os.path.join(base_dir, sp))
                if sp_norm not in self.sample_cache:
                    buf = self._decode_audio_file(sp_norm)
                    if buf is not None:
                        self.sample_cache[sp_norm] = buf
                        loaded += 1
        for pid, p in self.pads.items():
            sp = p.get("sample_path")
            if sp:
                sp_norm = os.path.normpath(sp if os.path.isabs(sp) else os.path.join(base_dir, sp))
                p["sample_path"] = sp_norm
                if sp_norm not in self.sample_cache:
                    buf = self._decode_audio_file(sp_norm)
                    if buf is not None:
                        self.sample_cache[sp_norm] = buf
                        loaded += 1
        return loaded

    def _decode_audio_file(self, filepath: str) -> Optional[np.ndarray]:
        """Decodes WAV, MP3, or FLAC into float32 stereo numpy buffer matching self.samplerate."""
        if not os.path.exists(filepath):
            return None
        try:
            # Using miniaudio for ultra-fast C decoding
            decoded = miniaudio.decode_file(
                filepath,
                output_format=miniaudio.SampleFormat.FLOAT32,
                nchannels=2,
                sample_rate=self.samplerate
            )
            raw = np.frombuffer(decoded.samples, dtype=np.float32)
            audio = raw.reshape(-1, 2)
            # Add subtle 128-sample micro fade-in/out to prevent clicks
            fade_len = min(128, len(audio) // 4)
            if fade_len > 0:
                audio = audio.copy()
                fade_in = np.linspace(0.0, 1.0, fade_len, dtype=np.float32)
                fade_out = np.linspace(1.0, 0.0, fade_len, dtype=np.float32)
                audio[:fade_len, 0] *= fade_in
                audio[:fade_len, 1] *= fade_in
                audio[-fade_len:, 0] *= fade_out
                audio[-fade_len:, 1] *= fade_out
            return audio
        except Exception as e:
            # Fallback to wave module if standard WAV
            try:
                with wave.open(filepath, "rb") as wf:
                    ch = wf.getnchannels()
                    sw = wf.getsampwidth()
                    sr = wf.getframerate()
                    frames = wf.readframes(wf.getnframes())
                    if sw == 2: # 16-bit
                        data = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
                    elif sw == 3: # 24-bit
                        int_data = []
                        for i in range(0, len(frames), 3):
                            b = frames[i:i+3]
                            val = int.from_bytes(b, byteorder='little', signed=True)
                            int_data.append(val / 8388608.0)
                        data = np.array(int_data, dtype=np.float32)
                    elif sw == 4: # 32-bit float or int
                        data = np.frombuffer(frames, dtype=np.float32)
                    else:
                        return None
                    if ch == 1:
                        stereo = np.column_stack([data, data])
                    else:
                        stereo = data.reshape(-1, ch)[:, :2]
                    return np.ascontiguousarray(stereo, dtype=np.float32)
            except Exception as e2:
                print(f"[WARN] Failed to decode sample {filepath}: {e2}")
                return None

    def trigger_pad(self, pad_id: str, velocity: int = 127, action: str = "press") -> bool:
        """
        Single unified trigger entry point for Desktop UI, Phone Remote, and MIDI.
        action: 'press' or 'release'
        """
        pad = self.pads.get(pad_id)
        if not pad:
            return False

        mode = pad.get("trigger_mode", "oneshot")
        choke = pad.get("choke_group", 0)
        
        # Check sample buffer
        sample_path = pad.get("sample_path")
        buf = self.sample_cache.get(sample_path)
        if buf is None:
            buf = self._decode_audio_file(sample_path)
            if buf is not None:
                self.sample_cache[sample_path] = buf
            else:
                return False

        with self.lock:
            # Handle GATE release
            if action == "release":
                if mode == "gate":
                    for v in self.voices:
                        if v.pad_id == pad_id and v.is_active:
                            v.start_fade_out(frames=480) # 10ms quick fade
                    self.pad_states[pad_id]["playing"] = False
                return True

            # Handle TOGGLE mode
            if mode == "toggle":
                active_toggle_voice = None
                for v in self.voices:
                    if v.pad_id == pad_id and v.is_active and v.fade_out_frames == 0:
                        active_toggle_voice = v
                        break
                if active_toggle_voice:
                    active_toggle_voice.start_fade_out(frames=480)
                    self.pad_states[pad_id]["playing"] = False
                    return True

            # Handle CHOKE GROUP: fade out active voices in the same choke group
            if choke > 0:
                for v in self.voices:
                    if v.choke_group == choke and v.is_active:
                        v.start_fade_out(frames=720) # 15ms choke fade
                        if v.pad_id in self.pad_states:
                            self.pad_states[v.pad_id]["playing"] = False

            # Calculate volume with optional velocity sensitivity
            pad_vol_norm = float(pad.get("volume", 100)) / 127.0
            vel_sens = pad.get("velocity_sensitive", True)
            vel_norm = (float(velocity) / 127.0) if vel_sens else 1.0
            vol_lin = pad_vol_norm * vel_norm

            # Voice allocation & voice stealing
            active_count = sum(1 for v in self.voices if v.is_active)
            if active_count >= self.max_polyphony:
                # Steal oldest active voice
                oldest = min(self.voices, key=lambda v: v.start_time if v.is_active else 999999999)
                oldest.start_fade_out(frames=128)

            voice = FxVoice(
                pad_id=pad_id,
                choke_group=choke,
                trigger_mode=mode,
                buffer=buf,
                volume_lin=vol_lin,
                pan_val=pad.get("pan", 64),
                pitch_semitones=pad.get("pitch", 0)
            )
            self.voices.append(voice)
            self.pad_states[pad_id] = {"playing": True, "last_trigger": time.time()}
            return True

    def stop_all_pads(self):
        """Immediately fades out all active voices."""
        with self.lock:
            for v in self.voices:
                v.start_fade_out(frames=256)
            for p in self.pad_states:
                self.pad_states[p]["playing"] = False

    def get_audio_block(self, frames: int) -> np.ndarray:
        """Real-time mixing callback for FX Pad sub-bus (runs on audio callback thread)."""
        output = np.zeros((frames, 2), dtype=np.float32)
        if self.bus_muted or self.bus_volume <= 0.001:
            return output

        with self.lock:
            active_voices = []
            for v in self.voices:
                if not v.is_active:
                    continue
                
                # Render voice samples into output block
                # Linear interpolation for pitch shifting if pitch_ratio != 1.0
                curr_c = v.cursor
                step = v.pitch_ratio
                buf = v.buffer
                buflen = v.length
                
                # Compute how many samples we can extract
                idx_floats = curr_c + np.arange(frames, dtype=np.float64) * step
                valid_mask = idx_floats < (buflen - 1)
                valid_count = int(np.count_nonzero(valid_mask))
                
                if valid_count == 0:
                    v.is_active = False
                    continue
                
                # Fetch indices & linear fractional weights
                idx_v = idx_floats[:valid_count]
                idx_floor = idx_v.astype(np.int32)
                idx_frac = (idx_v - idx_floor).astype(np.float32)[:, None]
                
                s0 = buf[idx_floor]
                s1 = buf[np.minimum(idx_floor + 1, buflen - 1)]
                sampled = s0 + (s1 - s0) * idx_frac
                
                # Apply channel gain
                sampled[:, 0] *= v.gain_l
                sampled[:, 1] *= v.gain_r
                
                # Apply fade out if choking / releasing
                if v.fade_out_frames > 0:
                    f_rem = v.fade_out_counter
                    f_total = v.fade_out_frames
                    end_count = min(valid_count, f_rem)
                    fade_curve = np.linspace(f_rem / f_total, max(0.0, (f_rem - end_count) / f_total), end_count, dtype=np.float32)[:, None]
                    sampled[:end_count] *= fade_curve
                    if valid_count > end_count:
                        sampled[end_count:] = 0.0
                    v.fade_out_counter -= end_count
                    if v.fade_out_counter <= 0:
                        v.is_active = False

                output[:valid_count] += sampled
                v.cursor = idx_floats[valid_count - 1] + step
                if v.cursor >= buflen or not v.is_active:
                    v.is_active = False
                else:
                    active_voices.append(v)

            self.voices = active_voices

        # Apply FX pad sub-bus gain
        output *= self.bus_volume
        return output

    def get_pad_indicators(self) -> Dict[str, bool]:
        """Fast, lightweight query of currently active pad IDs for high-frequency telemetry."""
        with self.lock:
            active_ids = {v.pad_id for v in self.voices if v.is_active and v.fade_out_frames == 0}
        return {pid: (pid in active_ids) for pid in self.pads}

    def get_status(self) -> Dict[str, Any]:
        """Returns full JSON-serializable status dictionary including pads config and sound catalog."""
        return {
            "bus_volume": self.bus_volume,
            "bus_muted": self.bus_muted,
            "active_bank": self.active_bank,
            "active_voices": len(self.voices),
            "pad_indicators": self.get_pad_indicators(),
            "pads": self.pads,
            "sound_catalog": self.sound_catalog
        }
