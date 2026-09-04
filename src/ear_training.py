"""
Ear Training & Harmonic Practice Service for Litwave DAW
Connects to Yamaha MONTAGE M VST via UDP loopback on port 9123.
Provides:
- Authentic humanized piano chord voicings (bass + open spread + micro-timing)
- Chord Quality identification (Triads -> 7ths -> 9ths/13ths/Altereds)
- Harmonic Progressions & Nashville Numbers (ii-V-I, I-V-vi-IV, etc.)
- Melodic Call & Response (listen to lick, play back on CASIO keyboard)
- Relative Pitch Drone (contextual intervals against a pedal note)
"""

import time
import random
import socket
import threading
from typing import Dict, Any, List, Optional

NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
ROMAN_MAJ = ["I", "bII", "ii", "bIII", "iii", "IV", "#IV", "V", "bVI", "vi", "bVII", "vii°"]
NASHVILLE_NUMS = ["1", "b2", "2-", "b3", "3-", "4", "#4", "5", "b6", "6-", "b7", "7dim"]

def note_to_midi(name_with_octave: str) -> int:
    name = name_with_octave[:-1]
    octave = int(name_with_octave[-1])
    idx = NOTE_NAMES.index(name)
    return (octave + 1) * 12 + idx

class EarTrainingManager:
    def __init__(self, udp_target=("127.0.0.1", 9123)):
        self.udp_target = udp_target
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.active_exercise: Optional[Dict[str, Any]] = None
        self.current_key_root: int = 0 # 0 = C, 2 = D, 5 = F, 7 = G, etc.
        self.current_score = {"correct": 0, "total": 0, "streak": 0}
        self.playback_thread: Optional[threading.Thread] = None

    def send_midi_note(self, pitch: int, velocity: int, duration_sec: float = 0.8, delay_sec: float = 0.0):
        """Schedules Note On and Note Off to MONTAGE M via UDP"""
        def _play():
            if delay_sec > 0:
                time.sleep(delay_sec)
            try:
                # 0x90 Note On
                pkt_on = bytes([0x90, 0, pitch & 0x7F, velocity & 0x7F])
                self.sock.sendto(pkt_on, self.udp_target)
                time.sleep(duration_sec)
                # 0x80 Note Off
                pkt_off = bytes([0x80, 0, pitch & 0x7F, 0])
                self.sock.sendto(pkt_off, self.udp_target)
            except Exception as e:
                print(f"[EarTraining] MIDI error: {e}")

        t = threading.Thread(target=_play, daemon=True)
        t.start()

    def play_voicing(self, root_midi: int, intervals: List[int], duration: float = 1.6):
        """Plays humanized open keyboard voicing with micro-strum delay"""
        # Low bass root (octave 2 or 3)
        bass_note = (root_midi % 12) + 36 # C2 to B2
        self.send_midi_note(bass_note, random.randint(75, 88), duration_sec=duration, delay_sec=0.0)

        # Right hand open harmony notes
        for idx, semi in enumerate(intervals):
            rh_note = root_midi + semi
            while rh_note < 60: # Keep above Middle C
                rh_note += 12
            strum_delay = (idx + 1) * random.uniform(0.012, 0.022)
            vel = random.randint(65, 80)
            self.send_midi_note(rh_note, vel, duration_sec=duration - strum_delay, delay_sec=strum_delay)

    def generate_exercise(self, module: str, level: str = "all") -> Dict[str, Any]:
        """Generates a new exercise for Chord Quality, Progression, Melody, or Interval"""
        root_idx = random.randint(0, 11)
        root_name = NOTE_NAMES[root_idx]
        root_midi = 60 + root_idx # Octave 4 center

        if module == "chord_quality":
            # Library of rich piano voicings
            types = [
                {"id": "maj", "name": "Major", "abbr": f"{root_name}", "intervals": [0, 4, 7]},
                {"id": "min", "name": "Minor", "abbr": f"{root_name}m", "intervals": [0, 3, 7]},
                {"id": "maj7", "name": "Major 7th", "abbr": f"{root_name}Maj7", "intervals": [0, 4, 7, 11]},
                {"id": "min7", "name": "Minor 7th", "abbr": f"{root_name}m7", "intervals": [0, 3, 7, 10]},
                {"id": "dom7", "name": "Dominant 7th", "abbr": f"{root_name}7", "intervals": [0, 4, 7, 10]},
                {"id": "sus4", "name": "Suspended 4th", "abbr": f"{root_name}sus4", "intervals": [0, 5, 7]},
                {"id": "maj9", "name": "Major 9th", "abbr": f"{root_name}Maj9", "intervals": [0, 4, 7, 11, 14]},
                {"id": "min9", "name": "Minor 9th", "abbr": f"{root_name}m9", "intervals": [0, 3, 7, 10, 14]},
                {"id": "dim7", "name": "Diminished 7th", "abbr": f"{root_name}dim7", "intervals": [0, 3, 6, 9]},
                {"id": "m7b5", "name": "Half Diminished (m7b5)", "abbr": f"{root_name}m7b5", "intervals": [0, 3, 6, 10]}
            ]
            picked = random.choice(types)
            # Create 4 multiple choice options
            other_types = [t for t in types if t["id"] != picked["id"]]
            distractors = random.sample(other_types, min(3, len(other_types)))
            choices = [picked] + distractors
            random.shuffle(choices)

            self.active_exercise = {
                "module": "chord_quality",
                "question": f"Identify the chord quality ({root_name} Root):",
                "root_name": root_name,
                "root_midi": root_midi,
                "intervals": picked["intervals"],
                "answer_id": picked["id"],
                "answer_name": picked["name"],
                "answer_abbr": picked["abbr"],
                "choices": [{"id": c["id"], "label": c["name"], "abbr": c["abbr"]} for c in choices]
            }
            # Auto play voicing
            self.play_voicing(root_midi, picked["intervals"])
            return self.active_exercise

        elif module == "progression":
            key_roots = [0, 5, 7, 9, 2] # C, F, G, A, D
            k_root = random.choice(key_roots)
            k_name = NOTE_NAMES[k_root]
            
            # Common progressions with Nashville & Roman numerals
            progressions = [
                {
                    "name": "Pop / Anthem",
                    "nashville": "1 - 5 - 6- - 4",
                    "roman": "I - V - vi - IV",
                    "chords": [
                        {"root_offset": 0, "intervals": [0, 4, 7], "num": "1 (I)"},
                        {"root_offset": 7, "intervals": [0, 4, 7], "num": "5 (V)"},
                        {"root_offset": 9, "intervals": [0, 3, 7], "num": "6- (vi)"},
                        {"root_offset": 5, "intervals": [0, 4, 7], "num": "4 (IV)"}
                    ]
                },
                {
                    "name": "Jazz Standard ii - V - I",
                    "nashville": "2- - 5 - 1 - 6-",
                    "roman": "ii - V - I - vi",
                    "chords": [
                        {"root_offset": 2, "intervals": [0, 3, 7, 10], "num": "2- (ii)"},
                        {"root_offset": 7, "intervals": [0, 4, 7, 10], "num": "5 (V)"},
                        {"root_offset": 0, "intervals": [0, 4, 7, 11], "num": "1 (I)"},
                        {"root_offset": 9, "intervals": [0, 3, 7, 10], "num": "6- (vi)"}
                    ]
                },
                {
                    "name": "50s Doo-Wop Progression",
                    "nashville": "1 - 6- - 4 - 5",
                    "roman": "I - vi - IV - V",
                    "chords": [
                        {"root_offset": 0, "intervals": [0, 4, 7], "num": "1 (I)"},
                        {"root_offset": 9, "intervals": [0, 3, 7], "num": "6- (vi)"},
                        {"root_offset": 5, "intervals": [0, 4, 7], "num": "4 (IV)"},
                        {"root_offset": 7, "intervals": [0, 4, 7], "num": "5 (V)"}
                    ]
                },
                {
                    "name": "Emotional / Ballad vi - IV - I - V",
                    "nashville": "6- - 4 - 1 - 5",
                    "roman": "vi - IV - I - V",
                    "chords": [
                        {"root_offset": 9, "intervals": [0, 3, 7], "num": "6- (vi)"},
                        {"root_offset": 5, "intervals": [0, 4, 7], "num": "4 (IV)"},
                        {"root_offset": 0, "intervals": [0, 4, 7], "num": "1 (I)"},
                        {"root_offset": 7, "intervals": [0, 4, 7], "num": "5 (V)"}
                    ]
                }
            ]
            picked = random.choice(progressions)
            other_p = [p for p in progressions if p["name"] != picked["name"]]
            choices = [picked] + random.sample(other_p, 3)
            random.shuffle(choices)

            self.active_exercise = {
                "module": "progression",
                "question": f"Identify the Progression in Key of {k_name}:",
                "key_name": k_name,
                "key_root": k_root,
                "chords": picked["chords"],
                "answer_id": picked["name"],
                "answer_nashville": picked["nashville"],
                "answer_roman": picked["roman"],
                "choices": [{"id": c["name"], "nashville": c["nashville"], "roman": c["roman"]} for c in choices]
            }
            self.play_progression(k_root, picked["chords"])
            return self.active_exercise

        elif module == "melodic_response":
            k_name = NOTE_NAMES[root_idx]
            major_scale = [0, 2, 4, 5, 7, 9, 11, 12]
            phrase_length = random.choice([3, 4])
            phrase_intervals = [random.choice(major_scale) for _ in range(phrase_length)]
            phrase_notes = [root_midi + semi for semi in phrase_intervals]
            phrase_names = [NOTE_NAMES[n % 12] for n in phrase_notes]

            self.active_exercise = {
                "module": "melodic_response",
                "question": f"Play back the melody on keys (Key of {k_name}):",
                "key_name": k_name,
                "notes": phrase_notes,
                "note_names": phrase_names,
                "current_step": 0
            }
            self.play_melody(phrase_notes)
            return self.active_exercise

        elif module == "relative_interval":
            intervals = [
                {"semi": 1, "name": "Minor 2nd", "deg": "b2"},
                {"semi": 2, "name": "Major 2nd", "deg": "2"},
                {"semi": 3, "name": "Minor 3rd", "deg": "b3"},
                {"semi": 4, "name": "Major 3rd", "deg": "3"},
                {"semi": 5, "name": "Perfect 4th", "deg": "4"},
                {"semi": 6, "name": "Tritone / b5", "deg": "b5"},
                {"semi": 7, "name": "Perfect 5th", "deg": "5"},
                {"semi": 8, "name": "Minor 6th", "deg": "b6"},
                {"semi": 9, "name": "Major 6th", "deg": "6"},
                {"semi": 10, "name": "Minor 7th", "deg": "b7"},
                {"semi": 11, "name": "Major 7th", "deg": "7"},
                {"semi": 12, "name": "Octave", "deg": "8"}
            ]
            picked = random.choice(intervals)
            other_i = [i for i in intervals if i["semi"] != picked["semi"]]
            choices = [picked] + random.sample(other_i, 3)
            random.shuffle(choices)

            drone_pitch = (root_idx % 12) + 48 # C3 to B3
            target_pitch = drone_pitch + picked["semi"]

            self.active_exercise = {
                "module": "relative_interval",
                "question": f"Identify interval against {root_name} Drone:",
                "drone_pitch": drone_pitch,
                "target_pitch": target_pitch,
                "answer_id": picked["semi"],
                "answer_name": picked["name"],
                "answer_deg": picked["deg"],
                "choices": [{"id": c["semi"], "label": c["name"], "deg": c["deg"]} for c in choices]
            }
            self.play_relative_interval(drone_pitch, target_pitch)
            return self.active_exercise

        return {}

    def play_progression(self, key_root: int, chords: List[Dict[str, Any]]):
        def _prog():
            base_midi = 60 + (key_root % 12)
            for c in chords:
                c_root = base_midi + c["root_offset"]
                self.play_voicing(c_root, c["intervals"], duration=1.2)
                time.sleep(1.3)
        t = threading.Thread(target=_prog, daemon=True)
        t.start()

    def play_melody(self, notes: List[int]):
        def _mel():
            for idx, n in enumerate(notes):
                self.send_midi_note(n, random.randint(75, 88), duration_sec=0.45)
                time.sleep(0.55)
        t = threading.Thread(target=_mel, daemon=True)
        t.start()

    def play_relative_interval(self, drone_pitch: int, target_pitch: int):
        def _rel():
            # Sound drone first
            self.send_midi_note(drone_pitch, 80, duration_sec=2.4)
            time.sleep(0.6)
            # Sound target melodic note over it
            self.send_midi_note(target_pitch, 85, duration_sec=1.6)
        t = threading.Thread(target=_rel, daemon=True)
        t.start()

    def replay_current(self):
        if not self.active_exercise:
            return False
        mod = self.active_exercise.get("module")
        if mod == "chord_quality":
            self.play_voicing(self.active_exercise["root_midi"], self.active_exercise["intervals"])
        elif mod == "progression":
            self.play_progression(self.active_exercise["key_root"], self.active_exercise["chords"])
        elif mod == "melodic_response":
            self.play_melody(self.active_exercise["notes"])
        elif mod == "relative_interval":
            self.play_relative_interval(self.active_exercise["drone_pitch"], self.active_exercise["target_pitch"])
        return True

    def check_answer(self, user_answer: Any) -> Dict[str, Any]:
        if not self.active_exercise:
            return {"success": False, "message": "No active exercise"}
        
        self.current_score["total"] += 1
        mod = self.active_exercise.get("module")
        is_correct = False

        if mod in ["chord_quality", "progression", "relative_interval"]:
            expected = self.active_exercise.get("answer_id")
            if str(user_answer) == str(expected):
                is_correct = True
        
        if is_correct:
            self.current_score["correct"] += 1
            self.current_score["streak"] += 1
        else:
            self.current_score["streak"] = 0

        return {
            "is_correct": is_correct,
            "correct_answer": self.active_exercise.get("answer_name") or self.active_exercise.get("answer_nashville"),
            "score": dict(self.current_score)
        }
