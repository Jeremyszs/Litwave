"""
Song Player & Backing Track Engine for Montage Practice DAW
Supports MP3, WAV, FLAC, OGG, AAC playback with:
- Scrubbing & sample-accurate seeking
- A-B practice looping
- Playback speed scaling (0.5x to 1.5x)
- Waveform peak downsampling for high-density visualizer
"""

import os
import json
import threading
import numpy as np
import soundfile as sf
import miniaudio
from typing import Optional, Dict, Any, Tuple

class SongPlayer:
    def __init__(self, target_samplerate: int = 48000):
        self.target_samplerate = target_samplerate
        self.lock = threading.Lock()
        
        # Audio buffer (channels, frames) float32
        self.audio_data: Optional[np.ndarray] = None 
        self.duration_seconds: float = 0.0
        self.total_frames: int = 0
        self.filepath: Optional[str] = None
        self.filename: Optional[str] = None
        
        # Transport state
        self.is_playing: bool = False
        self.current_frame: int = 0
        self.volume: float = 0.8 # 0.0 to 1.0
        self.speed: float = 1.0  # 0.5 to 1.5
        self.pitch_shift_semitones: int = 0
        self._raw_unpitched_audio: Optional[np.ndarray] = None
        
        # A-B Loop (in seconds)
        self.loop_enabled: bool = False
        self.loop_a_sec: Optional[float] = None
        self.loop_b_sec: Optional[float] = None

        # Song Section Practice Markers & Synced Live Chord Progression
        self.markers: List[Dict[str, Any]] = [] # [{'id': 1, 'name': 'Verse 1', 'time': 12.5}]
        self.chord_chart: List[Dict[str, Any]] = [] # [{'time': 12.5, 'chord': 'Fmaj7', 'nashville': '[4]'}]
        
        # Audio Intelligence metadata
        self.analysis_data: Optional[Dict[str, Any]] = None
        self.lyrics_sheet: List[Dict[str, Any]] = [] # [{'time': 11.12, 'text': '...', 'chords': ['C', 'Am7']}]
        
        # Waveform peak cache for UI visualizer (normalized 0.0 - 1.0)
        self.waveform_peaks: list[float] = []

    def load_file(self, filepath: str) -> bool:
        """Load audio file and resample to match current engine samplerate exactly"""
        if not os.path.exists(filepath):
            return False
            
        with self.lock:
            try:
                # 1. Read native file info
                file_info = miniaudio.get_file_info(filepath)
                native_sr = file_info.sample_rate
                
                # 2. Decode raw audio at its native samplerate
                decoded = miniaudio.decode_file(
                    filepath,
                    output_format=miniaudio.SampleFormat.FLOAT32,
                    nchannels=2,
                    sample_rate=native_sr
                )
                raw_samples = np.frombuffer(decoded.samples, dtype=np.float32)
                frames = len(raw_samples) // 2
                stereo = raw_samples.reshape((frames, 2)).T # shape (2, frames)
                
                # 3. High-quality resample to engine target_samplerate if mismatched
                if native_sr != self.target_samplerate and self.target_samplerate > 0:
                    import soxr
                    # Resample both channels cleanly without pitch alteration
                    left_resampled = soxr.resample(stereo[0], native_sr, self.target_samplerate, quality='HQ')
                    right_resampled = soxr.resample(stereo[1], native_sr, self.target_samplerate, quality='HQ')
                    stereo = np.vstack([left_resampled, right_resampled])
                    frames = stereo.shape[1]

                self.audio_data = stereo
                self._raw_unpitched_audio = stereo.copy()
                self.pitch_shift_semitones = 0
                self.total_frames = frames
                self.duration_seconds = frames / float(self.target_samplerate)
                self.filepath = filepath
                self.filename = os.path.basename(filepath)
                self.current_frame = 0
                self.is_playing = False
                self.loop_enabled = False
                self.loop_a_sec = None
                self.loop_b_sec = None
                
                # Precompute 800-point visual waveform overview
                self._compute_waveform_peaks(800)
                
                # Auto-load persisted chord chart, analysis, and lyrics sheet
                self.markers = []
                self.chord_chart = []
                self.analysis_data = None
                self.lyrics_sheet = []
                self._load_persisted_chart()
                return True
            except Exception as e:
                print(f"Error loading audio file {filepath}: {e}")
                return False

    def _compute_waveform_peaks(self, num_points: int = 800):
        if self.audio_data is None or self.total_frames == 0:
            self.waveform_peaks = []
            return
            
        # Mono mixdown for peak calculation
        mono = np.mean(np.abs(self.audio_data), axis=0)
        chunk_size = max(1, len(mono) // num_points)
        peaks = []
        for i in range(0, len(mono), chunk_size):
            chunk = mono[i : i + chunk_size]
            peaks.append(float(np.max(chunk)) if len(chunk) > 0 else 0.0)
            
        # Normalize to 0.0 - 1.0
        max_val = max(peaks) if peaks else 1.0
        if max_val > 0.0:
            self.waveform_peaks = [round(p / max_val, 3) for p in peaks[:num_points]]
        else:
            self.waveform_peaks = peaks[:num_points]

    def play(self):
        with self.lock:
            if self.audio_data is not None:
                self.is_playing = True

    def pause(self):
        with self.lock:
            self.is_playing = False

    def stop(self):
        with self.lock:
            self.is_playing = False
            self.current_frame = 0

    def toggle_play(self):
        with self.lock:
            if self.audio_data is not None:
                self.is_playing = not self.is_playing

    def seek_seconds(self, seconds: float):
        with self.lock:
            if self.audio_data is None:
                return
            target_frame = int(seconds * self.target_samplerate)
            self.current_frame = max(0, min(self.total_frames - 1, target_frame))

    def set_loop_a(self, sec: Optional[float] = None):
        with self.lock:
            if sec is None:
                sec = self.current_frame / float(self.target_samplerate)
            self.loop_a_sec = round(sec, 2)
            if self.loop_b_sec is not None and self.loop_b_sec <= self.loop_a_sec:
                self.loop_b_sec = self.loop_a_sec + 2.0

    def set_loop_b(self, sec: Optional[float] = None):
        with self.lock:
            if sec is None:
                sec = self.current_frame / float(self.target_samplerate)
            self.loop_b_sec = round(sec, 2)
            if self.loop_a_sec is not None and self.loop_a_sec >= self.loop_b_sec:
                self.loop_a_sec = max(0.0, self.loop_b_sec - 2.0)

    def toggle_loop(self):
        with self.lock:
            self.loop_enabled = not self.loop_enabled

    def clear_track(self):
        with self.lock:
            self.is_playing = False
            self.audio_data = None
            self._raw_unpitched_audio = None
            self.duration_seconds = 0.0
            self.total_frames = 0
            self.current_frame = 0
            self.filepath = None
            self.filename = None
            self.loop_enabled = False
            self.loop_a_sec = None
            self.loop_b_sec = None
            self.waveform_peaks = []
            self.markers = []
            self.chord_chart = []
            self.analysis_data = None
            self.lyrics_sheet = []

    def _get_chart_file(self) -> Optional[str]:
        if not self.filepath:
            return None
        return self.filepath + ".chords.json"

    def _load_persisted_chart(self):
        chart_file = self._get_chart_file()
        if chart_file and os.path.exists(chart_file):
            try:
                with open(chart_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self.chord_chart = data.get("chord_chart", [])
                    if "markers" in data and not self.markers:
                        self.markers = data.get("markers", [])
                    self.analysis_data = data.get("analysis", None)
                    self.lyrics_sheet = data.get("lyrics_sheet", [])
            except Exception as e:
                print(f"[SongPlayer] Failed to load chord chart: {e}")

    def _persist_chart(self):
        chart_file = self._get_chart_file()
        if chart_file:
            try:
                with open(chart_file, "w", encoding="utf-8") as f:
                    json.dump({
                        "filename": self.filename,
                        "markers": self.markers,
                        "chord_chart": self.chord_chart,
                        "analysis": self.analysis_data,
                        "lyrics_sheet": self.lyrics_sheet
                    }, f, indent=2)
            except Exception as e:
                print(f"[SongPlayer] Failed to persist chord chart: {e}")

    def record_chord(self, chord_name: str, nashville: str, sec: Optional[float] = None):
        """Records a played chord into the song's real-time timeline"""
        with self.lock:
            if sec is None:
                sec = self.current_frame / float(self.target_samplerate) if self.target_samplerate > 0 else 0.0
            sec = round(float(sec), 2)
            
            # Avoid duplicate rapid triggers within 0.4s of same chord
            if self.chord_chart:
                last = self.chord_chart[-1]
                if last["chord"] == chord_name and abs(sec - last["time"]) < 0.4:
                    return
            
            # Insert or replace chord at current time
            self.chord_chart = [c for c in self.chord_chart if abs(c["time"] - sec) > 0.25]
            self.chord_chart.append({"time": sec, "chord": chord_name, "nashville": nashville})
            self.chord_chart.sort(key=lambda c: c["time"])
            self._persist_chart()

    def clear_chord_chart(self):
        with self.lock:
            self.chord_chart = []
            self._persist_chart()

    def add_marker(self, name: Optional[str] = None, sec: Optional[float] = None, scene: Optional[int] = None) -> Dict[str, Any]:
        with self.lock:
            if sec is None:
                sec = self.current_frame / float(self.target_samplerate) if self.target_samplerate > 0 else 0.0
            sec = round(float(sec), 2)
            idx = len(self.markers) + 1
            marker_name = name or f"Section {idx}"
            marker = {"id": idx, "name": marker_name, "time": sec, "scene": int(scene) if scene and 1 <= int(scene) <= 8 else None}
            self.markers.append(marker)
            self.markers.sort(key=lambda m: m["time"])
            self._persist_chart()
            return marker

    def update_marker(self, marker_id: int, new_sec: Optional[float] = None, name: Optional[str] = None, scene: Optional[int] = None):
        with self.lock:
            for m in self.markers:
                if m["id"] == marker_id:
                    if new_sec is not None:
                        m["time"] = round(float(new_sec), 2)
                    if name is not None:
                        m["name"] = str(name)[:32]
                    if scene is not None:
                        m["scene"] = int(scene) if 1 <= int(scene) <= 8 else None
                    break
            self.markers.sort(key=lambda m: m["time"])
            self._persist_chart()

    def update_marker_time(self, marker_id: int, new_sec: float):
        self.update_marker(marker_id, new_sec=new_sec)

    def remove_marker(self, marker_id: int):
        with self.lock:
            self.markers = [m for m in self.markers if m["id"] != marker_id]
            self._persist_chart()

    def clear_markers(self):
        with self.lock:
            self.markers = []
            self._persist_chart()

    def clear_loop(self):
        with self.lock:
            self.loop_enabled = False
            self.loop_a_sec = None
            self.loop_b_sec = None

    def set_volume(self, vol: float):
        with self.lock:
            self.volume = max(0.0, min(1.5, vol))

    def set_speed(self, speed: float):
        with self.lock:
            self.speed = max(0.5, min(1.5, speed))

    def resample_to_current_rate(self, from_sr: int, to_sr: int):
        """Called dynamically when switching audio devices/clock rates (e.g. 44.1k -> 48k)"""
        with self.lock:
            if self._raw_unpitched_audio is None or from_sr == to_sr or from_sr <= 0 or to_sr <= 0:
                return
            try:
                import soxr
                left = soxr.resample(self._raw_unpitched_audio[0], from_sr, to_sr, quality='HQ')
                right = soxr.resample(self._raw_unpitched_audio[1], from_sr, to_sr, quality='HQ')
                self._raw_unpitched_audio = np.vstack([left, right])
                self.target_samplerate = to_sr
                self.total_frames = self._raw_unpitched_audio.shape[1]
                self.duration_seconds = self.total_frames / float(to_sr)
                self.current_frame = int(self.current_frame * (to_sr / float(from_sr)))

                # Apply pitch shift if any active
                if self.pitch_shift_semitones != 0:
                    import librosa
                    l = librosa.effects.pitch_shift(self._raw_unpitched_audio[0], sr=to_sr, n_steps=self.pitch_shift_semitones)
                    r = librosa.effects.pitch_shift(self._raw_unpitched_audio[1], sr=to_sr, n_steps=self.pitch_shift_semitones)
                    self.audio_data = np.vstack([l, r])
                else:
                    self.audio_data = self._raw_unpitched_audio.copy()
            except Exception as e:
                print("Error on rate change resample:", e)

    def set_pitch_shift(self, semitones: int):
        """Shift backing track pitch by -12 to +12 semitones without changing tempo"""
        semitones = max(-12, min(12, int(semitones)))
        with self.lock:
            if self._raw_unpitched_audio is None or semitones == self.pitch_shift_semitones:
                return
            self.pitch_shift_semitones = semitones
            if semitones == 0:
                self.audio_data = self._raw_unpitched_audio.copy()
            else:
                import librosa
                # Shift both stereo channels with high fidelity
                left = librosa.effects.pitch_shift(self._raw_unpitched_audio[0], sr=self.target_samplerate, n_steps=semitones)
                right = librosa.effects.pitch_shift(self._raw_unpitched_audio[1], sr=self.target_samplerate, n_steps=semitones)
                self.audio_data = np.vstack([left, right])
            self._compute_waveform_peaks(800)

    def get_audio_block(self, num_frames: int) -> np.ndarray:
        """
        Called in the high-priority audio callback thread.
        Returns (num_frames, 2) float32 interleaved audio buffer.
        """
        output = np.zeros((num_frames, 2), dtype=np.float32)
        
        with self.lock:
            if not self.is_playing or self.audio_data is None or self.total_frames == 0:
                return output
                
            # Loop range frames
            loop_a_frame = int(self.loop_a_sec * self.target_samplerate) if (self.loop_enabled and self.loop_a_sec is not None) else 0
            loop_b_frame = int(self.loop_b_sec * self.target_samplerate) if (self.loop_enabled and self.loop_b_sec is not None) else self.total_frames

            # Speed factor frame step (if 1.0, step is 1)
            frames_to_read = int(round(num_frames * self.speed))
            start = self.current_frame
            end = start + frames_to_read
            
            # Check loop boundary
            if self.loop_enabled and self.loop_b_sec is not None and end >= loop_b_frame:
                # Wrap around to loop A
                read_len = max(0, loop_b_frame - start)
                if read_len > 0:
                    part1 = self.audio_data[:, start:loop_b_frame]
                else:
                    part1 = np.zeros((2, 0), dtype=np.float32)
                
                remaining = frames_to_read - read_len
                new_start = loop_a_frame
                new_end = new_start + remaining
                part2 = self.audio_data[:, new_start:new_end] if remaining > 0 else np.zeros((2, 0), dtype=np.float32)
                
                raw_chunk = np.concatenate([part1, part2], axis=1)
                self.current_frame = new_end
            elif end >= self.total_frames:
                # End of song reached
                read_len = max(0, self.total_frames - start)
                raw_chunk = self.audio_data[:, start : self.total_frames]
                self.is_playing = False
                self.current_frame = 0
            else:
                raw_chunk = self.audio_data[:, start:end]
                self.current_frame = end

            # Handle resample/speed interpolation if speed != 1.0
            if raw_chunk.shape[1] > 0:
                if raw_chunk.shape[1] != num_frames:
                    # Quick linear resample along time axis
                    indices = np.linspace(0, raw_chunk.shape[1] - 1, num_frames)
                    left = np.interp(indices, np.arange(raw_chunk.shape[1]), raw_chunk[0])
                    right = np.interp(indices, np.arange(raw_chunk.shape[1]), raw_chunk[1])
                    output[:, 0] = left * self.volume
                    output[:, 1] = right * self.volume
                else:
                    output[:, 0] = raw_chunk[0] * self.volume
                    output[:, 1] = raw_chunk[1] * self.volume
                    
        return output

    def get_telemetry(self) -> Dict[str, Any]:
        with self.lock:
            current_sec = (self.current_frame / float(self.target_samplerate)) if self.target_samplerate > 0 else 0.0
            return {
                "has_track": self.audio_data is not None,
                "filename": self.filename,
                "duration_seconds": round(self.duration_seconds, 2),
                "current_time_seconds": round(current_sec, 2),
                "is_playing": self.is_playing,
                "volume": round(self.volume, 2),
                "speed": round(self.speed, 2),
                "pitch_shift": self.pitch_shift_semitones,
                "loop_enabled": self.loop_enabled,
                "loop_a": self.loop_a_sec,
                "loop_b": self.loop_b_sec,
                "markers": list(self.markers),
                "chord_chart": list(self.chord_chart),
                "analysis": self.analysis_data,
                "lyrics_sheet": list(self.lyrics_sheet),
                "waveform_peaks": self.waveform_peaks
            }
