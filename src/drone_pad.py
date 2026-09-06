import os
import json
import time
import threading
from typing import Optional, Dict, Any, List

class DronePadManager:
    """
    Manages continuous ambient worship drone pad (Root + 5th + Octave)
    Crossfades seamlessly between root keys without abrupt silence.
    Compatible with both Yamaha MONTAGE M (Channel 8) and Litwave Community VST (Part 8).
    """

    NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    ROOT_MIDI = {
        "C": 36,   # C2
        "C#": 37,  # C#2
        "Db": 37,
        "D": 38,   # D2
        "D#": 39,  # D#2
        "Eb": 39,
        "E": 40,   # E2
        "F": 41,   # F2
        "F#": 42,  # F#2
        "Gb": 42,
        "G": 43,   # G2
        "G#": 44,  # G#2
        "Ab": 44,
        "A": 45,   # A2
        "A#": 46,  # A#2
        "Bb": 46,
        "B": 47    # B2
    }

    def __init__(self, host_ref):
        self.host = host_ref
        self.drone_part = 8 # Part 8 (channel index 7) is dedicated for Ambient Drone Pad
        self.is_active = False
        self.current_root = "C"
        self.volume = 95 # 0-127
        self.cutoff = 68 # 0-127 (smooth warm filter)
        self.active_pitches: List[int] = []
        self._fade_thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()

    def get_status(self) -> Dict[str, Any]:
        return {
            "active": self.is_active,
            "root": self.current_root,
            "volume": self.volume,
            "cutoff": self.cutoff,
            "part": self.drone_part,
            "pitches": self.active_pitches
        }

    def _get_drone_notes(self, root: str) -> List[int]:
        base = self.ROOT_MIDI.get(root.strip(), 36)
        # Root + 5th + Octave + 5th above: e.g. for C: C2 (36), G2 (43), C3 (48), G3 (55)
        return [base, base + 7, base + 12, base + 19]

    def start_drone(self, root: Optional[str] = None):
        with self._lock:
            if root:
                self.current_root = root
            self.is_active = True
            # Engage Part 8 hardware isolation so keybed and sustain pedal do not override Part 8
            self.host.set_drone_isolation(True)
            # Set dedicated Part 8 volume and cutoff
            self.host.set_part_volume(self.drone_part, self.volume)
            self.host.send_part_cc(self.drone_part, 74, self.cutoff) # CC 74 Brightness / Cutoff
            
            # Send note offs for any lingering pitches
            for p in self.active_pitches:
                self.host.send_note_off(self.drone_part - 1, p)
                self.host.send_note_off(self.drone_part, p)
            self.active_pitches = []

            # Trigger fresh root chord
            notes = self._get_drone_notes(self.current_root)
            for note in notes:
                # Send to both index 7 (0-indexed) and 8 (1-indexed) so engine always catches it
                self.host.send_note_on(self.drone_part - 1, note, velocity=85)
                self.host.send_note_on(self.drone_part, note, velocity=85)
            self.active_pitches = notes

    def stop_drone(self):
        with self._lock:
            self.is_active = False
            for p in self.active_pitches:
                self.host.send_note_off(self.drone_part - 1, p)
                self.host.send_note_off(self.drone_part, p)
            self.active_pitches = []
            # Release Part 8 isolation so it returns to being a normal playable keyboard part
            self.host.set_drone_isolation(False)

    def set_root(self, root: str):
        with self._lock:
            if not self.is_active:
                self.current_root = root
                return

            if root == self.current_root:
                return

            old_pitches = list(self.active_pitches)
            new_root = root
            self.current_root = root
            new_pitches = self._get_drone_notes(new_root)

        # Smooth crossfade in background worker thread
        def _crossfade():
            # 1. Trigger new notes at low velocity and swell
            for note in new_pitches:
                self.host.send_note_on(self.drone_part - 1, note, velocity=75)
                self.host.send_note_on(self.drone_part, note, velocity=75)
            with self._lock:
                self.active_pitches = new_pitches

            # 2. Allow harmonic blend overlap for 1.8 seconds
            time.sleep(1.8)

            # 3. Release old notes
            for note in old_pitches:
                self.host.send_note_off(self.drone_part - 1, note)
                self.host.send_note_off(self.drone_part, note)

        t = threading.Thread(target=_crossfade, daemon=True)
        t.start()

    def set_volume(self, vol: int):
        vol = max(0, min(127, int(vol)))
        self.volume = vol
        self.host.set_part_volume(self.drone_part, vol)

    def set_cutoff(self, cutoff: int):
        cutoff = max(0, min(127, int(cutoff)))
        self.cutoff = cutoff
        self.host.send_part_cc(self.drone_part, 74, cutoff)
