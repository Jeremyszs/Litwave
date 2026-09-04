"""
Metronome Click Generator
Generates high-precision accented click sounds (high pitch on downbeat, low pitch on upbeats)
"""

import numpy as np

class Metronome:
    def __init__(self, samplerate: int = 48000):
        self.samplerate = samplerate
        self.enabled = False
        self.bpm = 120.0
        self.time_sig_num = 4
        self.volume = 0.5
        
        # Audio frame state
        self.sample_interval = int((60.0 / self.bpm) * self.samplerate)
        self.current_beat = 0
        self.frame_counter = 0
        
        # Pre-synthesize click tones (8ms decayed sine bursts)
        self.click_high = self._generate_click(1500.0, 0.015)
        self.click_low = self._generate_click(800.0, 0.012)
        
        self.active_click = None
        self.click_pos = 0
        self.phase_offset_frames = 0

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
            # If we are right at the beat boundary (< 20ms), trigger click now
            time_to_next_beat = beat_interval_sec - phase_within_beat
            self.frame_counter = int(time_to_next_beat * self.samplerate) % self.sample_interval

    def _generate_click(self, freq: float, duration: float) -> np.ndarray:
        frames = int(duration * self.samplerate)
        t = np.linspace(0, duration, frames, endpoint=False)
        envelope = np.exp(-t * 220) # Exponential decay with punchy transient
        sine = np.sin(2 * np.pi * freq * t) * envelope
        # Add high-frequency attack tick for stage/monitor cut-through
        attack_transient = np.sin(2 * np.pi * 3200.0 * t[:min(frames, 48)]) * 0.5
        sine[:len(attack_transient)] += attack_transient
        # Peak normalize to prevent clipping at unity
        peak = np.max(np.abs(sine))
        if peak > 0: sine /= peak
        return sine.astype(np.float32)

    def set_bpm(self, bpm: float):
        self.bpm = max(30.0, min(300.0, bpm))
        self.sample_interval = int((60.0 / self.bpm) * self.samplerate)

    def set_time_sig(self, num: int):
        self.time_sig_num = max(1, num)

    def toggle(self):
        self.enabled = not self.enabled
        if not self.enabled:
            self.active_click = None
            self.click_pos = 0

    def get_audio_block(self, num_frames: int) -> np.ndarray:
        output = np.zeros((num_frames, 2), dtype=np.float32)
        if not self.enabled:
            return output
            
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
            
            if self.active_click is not None and self.click_pos < len(self.active_click):
                val = self.active_click[self.click_pos] * self.volume
                output[i, 0] += val
                output[i, 1] += val
                self.click_pos += 1
                
        return output
