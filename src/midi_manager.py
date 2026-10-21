"""
Robust MIDI & Pedalboard Manager using Mido + Windows Multimedia
Auto-detects CASIO USB-MIDI or any plugged-in keyboard/pedalboard.
"""

import time
import os
import json
import math
import threading
from typing import Callable, Optional, List, Dict, Any
import mido

from src import user_data

NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

def midi_note_to_name(note_number: int) -> str:
    octave = (note_number // 12) - 1
    name = NOTE_NAMES[note_number % 12]
    return f"{name}{octave}"

class MidiManager:
    def __init__(self, on_event_callback: Optional[Callable[[Dict[str, Any]], None]] = None):
        self.port: Optional[mido.ports.BaseInput] = None
        self.current_port_name: Optional[str] = None
        self.preferred_port_name: Optional[str] = None
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
        self.available_ports: List[str] = []
        self._last_scan_time: float = 0.0
        
        # Velocity Curve Processing Settings
        # curve: "linear", "heavy1" (harder touch), "heavy2" (much harder touch), "light1" (softer touch), "light2", "fixed"
        self.velocity_curve: str = "heavy1"
        self.velocity_scale: float = 1.0
        self.velocity_offset: int = 0
        self.velocity_min: int = 1
        self.velocity_max: int = 127
        self.settings_file = user_data.data_path("midi_settings.json")
        self._load_settings()

        # Background worker for auto-detect and reading
        self._running = True
        self._thread = threading.Thread(target=self._worker_loop, daemon=True)
        self._thread.start()

    def _load_settings(self):
        try:
            if os.path.exists(self.settings_file):
                with open(self.settings_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self.velocity_curve = str(data.get("velocity_curve", "heavy1"))
                    self.velocity_scale = float(data.get("velocity_scale", 1.0))
                    self.velocity_offset = int(data.get("velocity_offset", 0))
                    self.velocity_min = int(data.get("velocity_min", 1))
                    self.velocity_max = int(data.get("velocity_max", 127))
        except Exception:
            pass

    def _save_settings(self):
        try:
            temp = self.settings_file + ".tmp"
            with open(temp, "w", encoding="utf-8") as f:
                json.dump({
                    "velocity_curve": self.velocity_curve,
                    "velocity_scale": round(self.velocity_scale, 2),
                    "velocity_offset": self.velocity_offset,
                    "velocity_min": self.velocity_min,
                    "velocity_max": self.velocity_max
                }, f, indent=2)
            os.replace(temp, self.settings_file)
        except Exception:
            pass

    def set_velocity_config(self, curve: Optional[str] = None, scale: Optional[float] = None, offset: Optional[int] = None, min_v: Optional[int] = None, max_v: Optional[int] = None):
        with self.lock:
            if curve is not None:
                self.velocity_curve = str(curve).lower()
            if scale is not None:
                self.velocity_scale = max(0.1, min(3.0, float(scale)))
            if offset is not None:
                self.velocity_offset = max(-64, min(64, int(offset)))
            if min_v is not None:
                self.velocity_min = max(1, min(127, int(min_v)))
            if max_v is not None:
                self.velocity_max = max(1, min(127, int(max_v)))
            self._save_settings()

    def transform_velocity(self, raw_vel: int) -> int:
        if raw_vel <= 0:
            return 0
        x = float(raw_vel) / 127.0
        curve = self.velocity_curve
        if curve == "linear":
            y = x
        elif curve == "heavy1": # Requires harder press to reach loud velocities (convex)
            y = math.pow(x, 1.4)
        elif curve == "heavy2": # Requires significantly harder press
            y = math.pow(x, 1.8)
        elif curve == "light1": # Soft touch boosts to higher velocity (concave)
            y = math.pow(x, 0.7)
        elif curve == "light2": # Very sensitive
            y = math.pow(x, 0.5)
        elif curve == "fixed":
            return int(self.velocity_max)
        else:
            y = x

        y = y * self.velocity_scale
        if self.velocity_offset != 0:
            y += (float(self.velocity_offset) / 127.0)

        out_v = int(round(y * 127.0))
        return max(self.velocity_min, min(self.velocity_max, out_v))

    def get_available_ports(self, force_refresh: bool = False) -> List[str]:
        now = time.time()
        if force_refresh or (now - self._last_scan_time > 1.0) or not self.available_ports:
            try:
                ports = mido.get_input_names()
                self.available_ports = ports
                self._last_scan_time = now
            except Exception:
                self.available_ports = []
        return list(self.available_ports)

    def open_port(self, port_identifier: Optional[Any] = None) -> bool:
        with self.lock:
            self._close_internal()
            ports = self.get_available_ports(force_refresh=True)
            if not ports:
                return False
                
            chosen = None
            if port_identifier is not None:
                # Handle numeric port index passed as int or string digit
                if isinstance(port_identifier, int) and 0 <= port_identifier < len(ports):
                    chosen = ports[port_identifier]
                elif isinstance(port_identifier, str):
                    if port_identifier.isdigit():
                        idx = int(port_identifier)
                        if 0 <= idx < len(ports):
                            chosen = ports[idx]
                    if not chosen:
                        # Case-insensitive substring match
                        for p in ports:
                            if port_identifier.lower() in p.lower():
                                chosen = p
                                break
                                
            if not chosen:
                chosen = ports[0]
                
            try:
                self.port = mido.open_input(chosen)
                self.current_port_name = chosen
                self.preferred_port_name = chosen
                return True
            except Exception as e:
                self.port = None
                self.current_port_name = None
                return False

    def _probe_and_reconnect(self):
        """Checks for new or restored MIDI ports and auto-connects to preferred or first device."""
        ports = self.get_available_ports(force_refresh=True)
        if not ports:
            return
            
        with self.lock:
            if self.port is not None:
                # Verify active port is still listed in physical ports
                if self.current_port_name and not any(self.current_port_name.lower() in p.lower() for p in ports):
                    self._close_internal()
                else:
                    return

        # Attempt to reconnect preferred port, or first port
        target = self.preferred_port_name or ports[0]
        self.open_port(target)

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

    def stop(self):
        """Orderly shutdown: stop worker thread, close port. Idempotent."""
        self._running = False
        if self._thread is not None and self._thread.is_alive():
            self._thread.join(timeout=2.0)
        self.close_port()

    def _worker_loop(self):
        last_hotplug_check = 0.0
        while self._running:
            now = time.time()
            # Periodically scan for device hotplug / auto-reconnect (every 1.0s)
            if now - last_hotplug_check >= 1.0:
                last_hotplug_check = now
                try:
                    self._probe_and_reconnect()
                except Exception:
                    pass
            
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
            if msg.velocity > 0:
                curved_vel = self.transform_velocity(msg.velocity)
                self.active_notes[msg.note] = curved_vel
                event_dict.update({
                    "type": "note_on",
                    "note": msg.note,
                    "original_note": msg.note,
                    "note_name": midi_note_to_name(msg.note),
                    "velocity": curved_vel,
                    "raw_velocity": msg.velocity
                })
            else:
                self.active_notes.pop(msg.note, None)
                event_dict.update({
                    "type": "note_off",
                    "note": msg.note,
                    "note_name": midi_note_to_name(msg.note)
                })
        elif msg.type == 'note_off':
            self.active_notes.pop(msg.note, None)
            event_dict.update({
                "type": "note_off",
                "note": msg.note,
                "note_name": midi_note_to_name(msg.note)
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

    def panic(self) -> List[int]:
        """Clear all Litwave MIDI state and return notes needing explicit Note Off."""
        with self.lock:
            active = sorted(self.active_notes)
            self.active_notes.clear()
            self.pedals.update({
                "sustain": 0,
                "expression": 127,
                "soft": 0,
                "volume": 127,
                "sostenuto": 0,
            })
            self.pitch_bend = 8192
            self.modulation = 0
            return active

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
                "velocity_config": {
                    "curve": self.velocity_curve,
                    "scale": self.velocity_scale,
                    "offset": self.velocity_offset,
                    "min": self.velocity_min,
                    "max": self.velocity_max
                }
            }
