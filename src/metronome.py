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
