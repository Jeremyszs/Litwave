"""
Studio 3-Band Equalizer (Low Shelf, Mid Peaking, High Shelf)
Biquad filtering with minimal latency and smooth coefficient updates.
"""

import numpy as np
from scipy import signal

class ParametricEQ3:
    def __init__(self, samplerate: int = 44100):
        self.samplerate = samplerate
        self.low_gain_db = 0.0   # 100 Hz Shelf
        self.mid_gain_db = 0.0   # 1000 Hz Peak
        self.high_gain_db = 0.0  # 8000 Hz Shelf
        
        # State filter delays
        self.zi_low_l = np.zeros(2, dtype=np.float32)
        self.zi_low_r = np.zeros(2, dtype=np.float32)
        self.zi_mid_l = np.zeros(2, dtype=np.float32)
        self.zi_mid_r = np.zeros(2, dtype=np.float32)
        self.zi_high_l = np.zeros(2, dtype=np.float32)
        self.zi_high_r = np.zeros(2, dtype=np.float32)

        self._update_coefficients()

    def set_gains(self, low_db: float, mid_db: float, high_db: float):
        self.low_gain_db = float(low_db)
        self.mid_gain_db = float(mid_db)
        self.high_gain_db = float(high_db)
        self._update_coefficients()

    def _update_coefficients(self):
        sr = self.samplerate
        # Low shelf at 120Hz
        w_low = 120.0 / (sr / 2.0)
        A_low = 10.0 ** (self.low_gain_db / 40.0)
        self.b_low, self.a_low = signal.iirfilter(2, w_low, btype='lowpass', ftype='butter')
        # Scale gain diff
        self.gain_low_factor = 10.0 ** (self.low_gain_db / 20.0)

        # Mid band at 1000Hz (Q ~ 1.0)
        w_mid = [600.0 / (sr / 2.0), 1800.0 / (sr / 2.0)]
        self.b_mid, self.a_mid = signal.iirfilter(1, w_mid, btype='bandpass', ftype='butter')
        self.gain_mid_factor = 10.0 ** (self.mid_gain_db / 20.0) - 1.0

        # High shelf at 6000Hz
        w_high = 6000.0 / (sr / 2.0)
        self.b_high, self.a_high = signal.iirfilter(2, w_high, btype='highpass', ftype='butter')
        self.gain_high_factor = 10.0 ** (self.high_gain_db / 20.0)

    def process(self, stereo_chunk: np.ndarray) -> np.ndarray:
        """Process (frames, 2) in-place or return filtered array"""
        if self.low_gain_db == 0.0 and self.mid_gain_db == 0.0 and self.high_gain_db == 0.0:
            return stereo_chunk

        out = stereo_chunk.copy()
        
        # Apply low band shelf
        if self.low_gain_db != 0.0:
            l_low, self.zi_low_l = signal.lfilter(self.b_low, self.a_low, out[:, 0], zi=self.zi_low_l)
            r_low, self.zi_low_r = signal.lfilter(self.b_low, self.a_low, out[:, 1], zi=self.zi_low_r)
            out[:, 0] += l_low * (self.gain_low_factor - 1.0)
            out[:, 1] += r_low * (self.gain_low_factor - 1.0)

        # Apply mid band peaking
        if self.mid_gain_db != 0.0:
            l_mid, self.zi_mid_l = signal.lfilter(self.b_mid, self.a_mid, out[:, 0], zi=self.zi_mid_l)
            r_mid, self.zi_mid_r = signal.lfilter(self.b_mid, self.a_mid, out[:, 1], zi=self.zi_mid_r)
            out[:, 0] += l_mid * self.gain_mid_factor
            out[:, 1] += r_mid * self.gain_mid_factor

        # Apply high band shelf
        if self.high_gain_db != 0.0:
            l_high, self.zi_high_l = signal.lfilter(self.b_high, self.a_high, out[:, 0], zi=self.zi_high_l)
            r_high, self.zi_high_r = signal.lfilter(self.b_high, self.a_high, out[:, 1], zi=self.zi_high_r)
            out[:, 0] += l_high * (self.gain_high_factor - 1.0)
            out[:, 1] += r_high * (self.gain_high_factor - 1.0)

        return out
