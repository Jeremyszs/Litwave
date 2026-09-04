"""
Robust MIDI & Pedalboard Manager using Mido + Windows Multimedia
Auto-detects CASIO USB-MIDI or any plugged-in keyboard/pedalboard.
"""

import time
import threading
from typing import Callable, Optional, List, Dict, Any
import mido

NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

def midi_note_to_name(note_number: int) -> str:
    octave = (note_number // 12) - 1
    name = NOTE_NAMES[note_number % 12]
    return f"{name}{octave}"

class MidiManager:
    def __init__(self, on_event_callback: Optional[Callable[[Dict[str, Any]], None]] = None):
        self.port: Optional[mido.ports.BaseInput] = None
        self.current_port_name: Optional[str] = None
        self.on_event = on_event_callback
        self.lock = threading.Lock()
        
        # State tracking
        self.active_notes: Dict[int, int] = {}
        self.pedals = {
            "sustain": 0,      # CC64
            "expression": 127,  # CC11
            "soft": 0,         # CC67
            "volume": 127,     # CC7
            "sostenuto": 0     # CC66
        }
        self.pitch_bend: int = 8192
        self.modulation: int = 0
        self.transpose_semitones: int = 0
        
        # Background worker for auto-detect and reading
        self._running = True
        self._thread = threading.Thread(target=self._worker_loop, daemon=True)
        self._thread.start()

    def get_available_ports(self) -> List[str]:
        try:
            return mido.get_input_names()
        except Exception:
            return []

    def open_port(self, port_name: Optional[str] = None) -> bool:
        with self.lock:
            self._close_internal()
            ports = self.get_available_ports()
            if not ports:
                return False
                
            chosen = None
            if port_name:
                for p in ports:
                    if port_name.lower() in p.lower():
                        chosen = p
                        break
            if not chosen:
                chosen = ports[0]
                
            try:
                self.port = mido.open_input(chosen)
                self.current_port_name = chosen
                return True
            except Exception as e:
                self.port = None
                self.current_port_name = None
                return False

    def _close_internal(self):
        if self.port:
            try:
                self.port.close()
            except Exception:
                pass
            self.port = None
        self.current_port_name = None
        self.active_notes.clear()

    def close_port(self):
        with self.lock:
            self._close_internal()

    def _worker_loop(self):
        while self._running:
            # Auto-connect if no port is currently open
            if self.port is None:
                ports = self.get_available_ports()
                if ports:
                    self.open_port(ports[0])
            
            if self.port is not None:
                try:
                    # Non-blocking receive
                    for msg in self.port.iter_pending():
                        self._process_mido_msg(msg)
                except Exception:
                    with self.lock:
                        self._close_internal()
            time.sleep(0.005) # 5ms polling for responsive input

    def _process_mido_msg(self, msg: mido.Message):
        event_dict: Dict[str, Any] = {
            "timestamp": time.time(),
            "channel": getattr(msg, 'channel', 0) + 1,
            "raw": list(msg.bytes())
        }
        
        if msg.type == 'note_on':
            transposed_note = max(0, min(127, msg.note + self.transpose_semitones))
            if msg.velocity > 0:
                self.active_notes[transposed_note] = msg.velocity
                event_dict.update({
                    "type": "note_on",
                    "note": transposed_note,
                    "original_note": msg.note,
                    "note_name": midi_note_to_name(transposed_note),
                    "velocity": msg.velocity
                })
            else:
                self.active_notes.pop(transposed_note, None)
                event_dict.update({
                    "type": "note_off",
                    "note": transposed_note,
                    "note_name": midi_note_to_name(transposed_note)
                })
        elif msg.type == 'note_off':
            transposed_note = max(0, min(127, msg.note + self.transpose_semitones))
            self.active_notes.pop(transposed_note, None)
            event_dict.update({
                "type": "note_off",
                "note": transposed_note,
                "note_name": midi_note_to_name(transposed_note)
            })
        elif msg.type == 'control_change':
            cc_num = msg.control
            cc_val = msg.value
            event_dict.update({"type": "control_change", "cc": cc_num, "value": cc_val})
            
            if cc_num == 64:
                self.pedals["sustain"] = cc_val
                event_dict["pedal"] = "sustain"
                event_dict["is_pressed"] = cc_val >= 64
            elif cc_num == 11:
                self.pedals["expression"] = cc_val
                event_dict["pedal"] = "expression"
                event_dict["percent"] = round((cc_val / 127.0) * 100, 1)
            elif cc_num == 67:
                self.pedals["soft"] = cc_val
                event_dict["pedal"] = "soft"
                event_dict["is_pressed"] = cc_val >= 64
            elif cc_num == 7:
                self.pedals["volume"] = cc_val
                event_dict["pedal"] = "volume"
                event_dict["percent"] = round((cc_val / 127.0) * 100, 1)
            elif cc_num == 66:
                self.pedals["sostenuto"] = cc_val
                event_dict["pedal"] = "sostenuto"
                event_dict["is_pressed"] = cc_val >= 64
            elif cc_num == 1:
                self.modulation = cc_val
                event_dict["param"] = "modulation"
                
        elif msg.type == 'pitchwheel':
            # normalized -8192 to 8191 -> 0 to 16383
            bend_val = msg.pitch + 8192
            self.pitch_bend = bend_val
            norm_bend = msg.pitch / 8192.0
            event_dict.update({"type": "pitch_bend", "value": bend_val, "normalized": round(norm_bend, 3)})

        if self.on_event:
            try:
                self.on_event(event_dict)
            except Exception:
                pass

    def get_snapshot(self) -> Dict[str, Any]:
        with self.lock:
            active_list = sorted(list(self.active_notes.keys()))
            active_names = [midi_note_to_name(n) for n in active_list]
            return {
                "connected": self.port is not None,
                "port_name": self.current_port_name,
                "active_notes": active_list,
                "active_note_names": active_names,
                "pedals": dict(self.pedals),
                "pitch_bend": self.pitch_bend,
                "modulation": self.modulation,
                "transpose": self.transpose_semitones
            }
