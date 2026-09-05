"""
Studio Audio Engine with Steinberg ASIO Driver Support
Provides:
- ASIO & WASAPI Exclusive low-latency playback
- Parallel mixing: Song track + Metronome + Live Synth
- Master volume with soft knee limiter (anti-clipping)
- Real-time stereo peak dB calculation for VU meters
"""

import os
os.environ["SD_ENABLE_ASIO"] = "1"

import socket
import sounddevice as sd
import numpy as np
import threading
from typing import Dict, Any, List, Optional
from src.song_player import SongPlayer
from src.metronome import Metronome
from src.equalizer import ParametricEqualizer

class AudioEngine:
    def __init__(self, samplerate: int = 48000, blocksize: int = 256):
        self.samplerate = samplerate
        self.blocksize = blocksize
        self.stream: Optional[sd.OutputStream] = None
        self.current_device_id: Optional[int] = None
        self.current_device_name: Optional[str] = None
        self.current_hostapi: Optional[str] = None
        self.is_running: bool = False
        
        # Audio sources
        self.song_player = SongPlayer(target_samplerate=samplerate)
        self.metronome = Metronome(samplerate=samplerate)
        self.equalizer = ParametricEqualizer(samplerate=samplerate)
        
        # Mixer parameters
        self.master_volume: float = 1.0
        self.track_volume: float = 0.8
        self.synth_volume: float = 0.8
        self.metronome_volume: float = 0.5
        
        # Live VU Telemetry (dBFS)
        self.peak_left_db: float = -60.0
        self.peak_right_db: float = -60.0
        self.peak_track_db: float = -60.0
        self.peak_synth_db: float = -60.0
        self.is_clipping: bool = False
        
        self.lock = threading.Lock()

        # Dedicated UDP socket for real-time PCM loopback submix to montage_live_engine (Port 9123)
        self.udp_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.udp_target = ("127.0.0.1", 9123)

    def get_output_devices(self) -> List[Dict[str, Any]]:
        """List all available audio output devices with special emphasis on ASIO and dedicated Soundcards"""
        devices = []
        apis = sd.query_hostapis()
        for idx, d in enumerate(sd.query_devices()):
            if d.get("max_output_channels", 0) > 0:
                api_name = apis[d["hostapi"]]["name"] if d["hostapi"] < len(apis) else "Unknown"
                is_asio = "ASIO" in api_name.upper()
                name = d["name"]
                is_soundcard = any(k in name.lower() for k in ["usb", "nux", "scarlett", "audio", "soundcard"])
                devices.append({
                    "id": idx,
                    "name": name,
                    "hostapi": api_name,
                    "is_asio": is_asio,
                    "is_soundcard": is_soundcard,
                    "channels": d["max_output_channels"],
                    "default_sr": int(d["default_samplerate"])
                })
        # Sort priority: ASIO first, then USB soundcards, then name
        devices.sort(key=lambda x: (not x["is_asio"], not x["is_soundcard"], x["name"]))
        return devices

    def start_stream(self, device_id: Optional[int] = None, samplerate: Optional[int] = None, blocksize: Optional[int] = None) -> bool:
        self.stop_stream()
        
        with self.lock:
            try:
                # If no device specified, auto-select the best ASIO device if available
                if device_id is None:
                    devices = self.get_output_devices()
                    asio_devs = [d for d in devices if d["is_asio"]]
                    if asio_devs:
                        device_id = asio_devs[0]["id"]
                    else:
                        device_id = sd.default.device[1]

                dev_info = sd.query_devices(device_id)
                apis = sd.query_hostapis()
                api_name = apis[dev_info["hostapi"]]["name"] if dev_info["hostapi"] < len(apis) else "Standard"

                target_sr = samplerate or int(dev_info.get("default_samplerate", 48000))
                target_bs = blocksize or 256

                self.samplerate = target_sr
                self.blocksize = target_bs
                self.current_device_id = device_id
                self.current_device_name = dev_info["name"]
                self.current_hostapi = api_name

                # Re-sync submodules to exact sample rate
                old_sr = self.song_player.target_samplerate
                self.song_player.target_samplerate = self.samplerate
                self.metronome.samplerate = self.samplerate

                # If a song is already loaded, resample it dynamically to match the new sample rate!
                if self.song_player.filepath and old_sr != self.samplerate:
                    self.song_player.resample_to_current_rate(old_sr, self.samplerate)

                self.stream = sd.OutputStream(
                    device=device_id,
                    samplerate=self.samplerate,
                    blocksize=self.blocksize,
                    channels=2,
                    dtype=np.float32,
                    callback=self._audio_callback
                )
                self.stream.start()
                self.is_running = True
                return True
            except Exception as e:
                print(f"Error starting audio stream: {e}")
                self.is_running = False
                return False

    def stop_stream(self):
        with self.lock:
            if self.stream is not None:
                try:
                    self.stream.stop()
                    self.stream.close()
                except Exception:
                    pass
                self.stream = None
            self.is_running = False

    def _audio_callback(self, outdata: np.ndarray, frames: int, time_info, status):
        """Ultra-low-latency real-time mixing callback"""
        # 1. Backing track
        track_buf = self.song_player.get_audio_block(frames) * self.track_volume
        
        # 2. Metronome (Clean uninterrupted steady clock)
        metro_buf = self.metronome.get_audio_block(frames) * self.metronome_volume

        # Master mix
        mix = (track_buf + metro_buf) * self.master_volume
        
        # 3. Master Parametric Equalizer Filter Cascade
        mix = self.equalizer.process_block(mix)
        
        # Soft limiter / saturator to prevent harsh digital clipping: tanh saturation
        np.tanh(mix, out=mix)
        
        # Stream backing track PCM chunks directly to montage_live_engine C++ host for OBS Studio Submix
        try:
            interleaved = np.ascontiguousarray(mix, dtype=np.float32)
            n_frames = min(frames, 512)
            # Header: [0x41 ('A'), 0, n_frames >> 8, n_frames & 0xFF]
            header = bytes([0x41, 0, (n_frames >> 8) & 0xFF, n_frames & 0xFF])
            payload = header + interleaved[:n_frames].tobytes()
            self.udp_sock.sendto(payload, self.udp_target)
            # Try to read peak meters from C++ host non-blockingly
            self.udp_sock.setblocking(False)
            try:
                resp, _ = self.udp_sock.recvfrom(32)
                if len(resp) >= 16:
                    import struct
                    s_peak, t_peak, ml_peak, mr_peak = struct.unpack("ffff", resp[:16])
                    if s_peak > 0:
                        self.peak_synth_db = 20.0 * np.log10(max(1e-4, s_peak))
                    else:
                        self.peak_synth_db = -60.0
                    
                    if t_peak > 0:
                        self.peak_track_db = 20.0 * np.log10(max(1e-4, t_peak))
                    
                    if ml_peak > 0:
                        self.peak_left_db = 20.0 * np.log10(max(1e-4, ml_peak))
                    if mr_peak > 0:
                        self.peak_right_db = 20.0 * np.log10(max(1e-4, mr_peak))
                elif len(resp) >= 4:
                    import struct
                    s_peak = struct.unpack("f", resp[:4])[0]
                    self.peak_synth_db = 20.0 * np.log10(max(1e-4, s_peak))
            except Exception:
                pass
        except Exception:
            pass

        # Transfer to local output
        outdata[:] = mix
        
        # Compute real-time peak telemetry from local mix (Track + Metronome)
        peak_l = float(np.max(np.abs(outdata[:, 0]))) if frames > 0 else 0.0
        peak_r = float(np.max(np.abs(outdata[:, 1]))) if frames > 0 else 0.0
        track_peak = float(np.max(np.abs(track_buf))) if frames > 0 else 0.0
        
        local_track_db = 20.0 * np.log10(max(1e-4, track_peak))
        local_left_db = 20.0 * np.log10(max(1e-4, peak_l))
        local_right_db = 20.0 * np.log10(max(1e-4, peak_r))

        # Always update track meter if track is producing sound
        if track_peak > 0:
            self.peak_track_db = local_track_db

        # Combine local (track/metronome) and C++ host peaks (synth)
        synth_lin = 10.0 ** (self.peak_synth_db / 20.0) if self.peak_synth_db > -55.0 else 0.0
        # If no synth sound is active, master meter reflects only backing track
        # If synth is active, master meter reflects the sum
        mix_lin_l = (peak_l + synth_lin) * self.master_volume
        mix_lin_r = (peak_r + synth_lin) * self.master_volume

        self.peak_left_db = 20.0 * np.log10(max(1e-4, mix_lin_l))
        self.peak_right_db = 20.0 * np.log10(max(1e-4, mix_lin_r))
        self.is_clipping = (mix_lin_l >= 0.99 or mix_lin_r >= 0.99)

    def query_vst_meters(self):
        """Polls peak levels from C++ host independently of playback"""
        try:
            self.udp_sock.sendto(bytes([0x50, 0, 0, 0]), self.udp_target)
            self.udp_sock.setblocking(False)
            resp, _ = self.udp_sock.recvfrom(32)
            if len(resp) >= 16:
                import struct
                s_peak, t_peak, ml_peak, mr_peak = struct.unpack("ffff", resp[:16])
                if s_peak > 0.0001:
                    self.peak_synth_db = 20.0 * np.log10(s_peak)
                else:
                    self.peak_synth_db = -60.0

                if not self.song_player.is_playing:
                    # When only playing keys (no backing track), master follows synth
                    mix_lin = s_peak * self.master_volume
                    if mix_lin > 0.0001:
                        db = 20.0 * np.log10(mix_lin)
                        self.peak_left_db = db
                        self.peak_right_db = db
                    else:
                        self.peak_left_db = -60.0
                        self.peak_right_db = -60.0
        except Exception:
            pass

    def get_telemetry(self) -> Dict[str, Any]:
        self.query_vst_meters()
        return {
            "is_running": self.is_running,
            "device_name": self.current_device_name,
            "device_id": self.current_device_id,
            "hostapi": self.current_hostapi,
            "samplerate": self.samplerate,
            "blocksize": self.blocksize,
            "latency_ms": round((self.blocksize / float(self.samplerate)) * 1000.0, 1) if self.samplerate > 0 else 0,
            "master_volume": round(self.master_volume, 2),
            "track_volume": round(self.track_volume, 2),
            "metronome_volume": round(self.metronome_volume, 2),
            "vu_master_l": round(self.peak_left_db, 1),
            "vu_master_r": round(self.peak_right_db, 1),
            "vu_track": round(self.peak_track_db, 1),
            "vu_synth": round(self.peak_synth_db, 1),
            "is_clipping": self.is_clipping,
            "metronome_bpm": self.metronome.bpm,
            "metronome_enabled": self.metronome.enabled,
            "metronome_time_sig": self.metronome.time_sig_num,
            "metronome_profile": self.metronome.sound_profile,
            "equalizer": self.equalizer.get_state()
        }
