"""
Metronome Click Generator with Selectable Sound Profiles
Includes high-treble studio rimshot/woodblock and sharp impulse click
that effortlessly cuts through loud backing tracks and piano monitors.
"""

import numpy as np

class Metronome:
    CLICK_PROFILES = {
        "treble": {"name": "Studio Treble Click", "high_freq": 2800.0, "low_freq": 1600.0, "transient_freq": 4800.0},
        "woodblock": {"name": "Acoustic Woodblock", "high_freq": 1800.0, "low_freq": 1050.0, "transient_freq": 3200.0},
        "beep": {"name": "Digital Beep", "high_freq": 2000.0, "low_freq": 1000.0, "transient_freq": 0.0},
    }

    def __init__(self, samplerate: int = 48000):
        self.samplerate = samplerate
        self.enabled = False
        self.bpm = 120.0
        self.time_sig_num = 4
        self.volume = 1.0
        self.sound_profile = "treble"
        
        # Audio frame state
        self.sample_interval = int((60.0 / self.bpm) * self.samplerate)
        self.current_beat = 0
        self.frame_counter = 0
        
        # Pre-synthesize default clicks
        self._refresh_clicks()
        
        self.active_click = None
        self.click_pos = 0
        self.phase_offset_frames = 0

    def set_sound_profile(self, profile: str):
        if profile in self.CLICK_PROFILES:
            self.sound_profile = profile
            self._refresh_clicks()

    def _refresh_clicks(self):
        cfg = self.CLICK_PROFILES.get(self.sound_profile, self.CLICK_PROFILES["treble"])
        self.click_high = self._generate_click(cfg["high_freq"], 0.018, cfg["transient_freq"])
        self.click_low = self._generate_click(cfg["low_freq"], 0.014, cfg["transient_freq"] * 0.75)

    def sync_to_playhead(self, playhead_seconds: float, first_downbeat_sec: float = 0.0):
        """
        Locks the metronome phase to the song's actual acoustic beat grid.
        Eliminates the 2-3 beat latency/drift.
        """
        if self.bpm <= 0 or self.samplerate <= 0:
            return
        beat_interval_sec = 60.0 / self.bpm
        # Time elapsed since the very first downbeat of the track
        rel_time = playhead_seconds - first_downbeat_sec
        if rel_time < 0:
            # Still in pickup / pre-downbeat time
            beats_passed = 0
            phase_within_beat = (first_downbeat_sec - playhead_seconds) % beat_interval_sec
            self.frame_counter = int(phase_within_beat * self.samplerate)
            self.current_beat = 0
        else:
            total_beats = int(rel_time / beat_interval_sec)
            self.current_beat = total_beats % self.time_sig_num
            phase_within_beat = rel_time % beat_interval_sec
            time_to_next_beat = beat_interval_sec - phase_within_beat
            self.frame_counter = int(time_to_next_beat * self.samplerate) % self.sample_interval

    def _generate_click(self, freq: float, duration: float, transient_freq: float = 4800.0) -> np.ndarray:
        frames = int(duration * self.samplerate)
        t = np.linspace(0, duration, frames, endpoint=False)
        # Fast exponential decay for punchy cut
        envelope = np.exp(-t * 260.0)
        sine = np.sin(2 * np.pi * freq * t) * envelope
        
        # Add piercing high-treble transient spike (first 1.5ms) for monitor clarity
        if transient_freq > 0:
            tr_len = min(frames, int(0.0015 * self.samplerate))
            t_tr = t[:tr_len]
            attack_transient = np.sin(2 * np.pi * transient_freq * t_tr) * np.exp(-t_tr * 800.0) * 0.7
            sine[:tr_len] += attack_transient
            
        # Peak normalize to prevent clipping
        peak = np.max(np.abs(sine))
        if peak > 0:
            sine /= peak
        return sine.astype(np.float32)

    def set_bpm(self, bpm: float):
        self.bpm = max(30.0, min(300.0, bpm))
        self.sample_interval = int((60.0 / self.bpm) * self.samplerate)

    def set_time_sig(self, num: int):
        self.time_sig_num = max(1, num)

    def toggle(self):
        self.enabled = not self.enabled
        self.active_click = None
        self.click_pos = 0

    def get_audio_block(self, num_frames: int) -> np.ndarray:
        # Always advance frame_counter so the metronome clock never loses time
        output = np.zeros((num_frames, 2), dtype=np.float32)
        
        for i in range(num_frames):
            if self.frame_counter == 0:
                # Trigger click
                if self.current_beat == 0:
                    self.active_click = self.click_high
                else:
                    self.active_click = self.click_low
                self.click_pos = 0
                self.current_beat = (self.current_beat + 1) % self.time_sig_num
                
            self.frame_counter = (self.frame_counter + 1) % self.sample_interval
            
            # Synthesize audio only when enabled
            if self.enabled and self.active_click is not None and self.click_pos < len(self.active_click):
                val = self.active_click[self.click_pos] * self.volume
                output[i, 0] += val
                output[i, 1] += val
                self.click_pos += 1
            elif not self.enabled and self.active_click is not None:
                self.click_pos += 1
                
        return output
