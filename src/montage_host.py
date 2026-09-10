"""
Yamaha MONTAGE M E.S.P. Host Manager
Manages discovery, verification, license state, and native editor launching
"""

import os
import json
import math
import socket
import struct
import subprocess
from typing import Dict, Any, Optional, List

NATIVE_STATUS_MAGIC = 0x5354574C
SPECTRUM_MAGIC = 0x54435053
NATIVE_STATUS_FORMAT = "<IffIIIIfffIIfIf32s96s"
NATIVE_STATUS_SIZE = struct.calcsize(NATIVE_STATUS_FORMAT)
SPECTRUM_FORMAT = "<II96f"
SPECTRUM_SIZE = struct.calcsize(SPECTRUM_FORMAT)

VST3_DIR = r"C:\Program Files\Common Files\VST3\Yamaha\Expanded Softsynth Plugin for MONTAGE M.vst3"
VST3_BIN = r"C:\Program Files\Common Files\VST3\Yamaha\Expanded Softsynth Plugin for MONTAGE M.vst3\Contents\x86_64-win\Expanded Softsynth Plugin for MONTAGE M.vst3"
DATA_DIR = r"C:\ProgramData\Yamaha\Expanded Softsynth Plugin for MONTAGE M"
STEINBERG_SAM = r"C:\Program Files\Steinberg\Activation Manager\SteinbergActivationManager.exe"
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
YAMAHA_ENGINE_EXE = os.path.join(BASE_DIR, "cpp_host", "montage_live_engine.exe")
COMMUNITY_ENGINE_EXE = os.path.join(BASE_DIR, "cpp_host", "litwave_community_engine.exe")
MONTAGE_ENGINE_EXE = COMMUNITY_ENGINE_EXE

class MontageHost:
    def __init__(self):
        self.vst_path = VST3_BIN
        self.data_dir = DATA_DIR
        self.engine_type = "community" # Default to open community soundfont engine
        self.editor_process = None
        self.master_vst_volume = 127
        self.part_volumes = {i: 100 for i in range(1, 9)}
        self.part_reverbs = {i: 40 for i in range(1, 9)}
        self.part_mutes = {i: False for i in range(1, 9)}
        self.part_solos = {i: False for i in range(1, 9)}
        self.current_scene = 1
        self.presets_file = os.path.join(os.path.dirname(__file__), "scene_presets.json")
        self.names_file = os.path.join(os.path.dirname(__file__), "custom_names.json")
        self.dsp_settings_file = os.path.join(os.path.dirname(__file__), "master_dsp_settings.json")
        self.analyzer_enabled = True
        self.analyzer_active = True
        self.warmth_enabled = True
        self.warmth_drive = 1.2
        self.warmth_mode = 0
        self.native_status = {"reachable": False}
        self.spectrum_bins: List[float] = []
        self._load_dsp_settings()
        self.part_names = {i: f"Part {i}" for i in range(1, 9)}
        self.scene_names = {i: f"Scene {i}" for i in range(1, 9)}
        self.part_pans = {i: 64 for i in range(1, 9)}
        self.part_cutoffs = {i: 64 for i in range(1, 9)}
        self.part_resonances = {i: 64 for i in range(1, 9)}
        self.part_attacks = {i: 64 for i in range(1, 9)}
        self.part_releases = {i: 64 for i in range(1, 9)}
        self.part_chorus = {i: 0 for i in range(1, 9)}
        self._load_custom_names()
        # Persistent storage for Scene snapshots: scene 1-8 -> { "master": 127, "parts": { 1: 100, ... } }
        self.saved_scenes = self._load_saved_scenes()

    def _send_udp(self, payload: bytes, response_size: int = 0) -> bytes:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            if response_size:
                sock.settimeout(0.05)
            sock.sendto(payload, ("127.0.0.1", 9123))
            if response_size:
                return sock.recvfrom(response_size)[0]
            return b""
        except OSError:
            return b""
        finally:
            sock.close()

    def _load_dsp_settings(self):
        try:
            with open(self.dsp_settings_file, "r", encoding="utf-8") as file:
                data = json.load(file)
            self.analyzer_enabled = bool(data.get("analyzer_enabled", True))
            self.warmth_enabled = bool(data.get("warmth_enabled", True))
            self.warmth_drive = max(1.0, min(3.0, float(data.get("warmth_drive", 1.2))))
            self.warmth_mode = int(data.get("warmth_mode", 0))
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            pass

    def _persist_dsp_settings(self):
        temp = self.dsp_settings_file + ".tmp"
        with open(temp, "w", encoding="utf-8") as file:
            json.dump({
                "analyzer_enabled": self.analyzer_enabled,
                "warmth_enabled": self.warmth_enabled,
                "warmth_drive": round(self.warmth_drive, 2),
                "warmth_mode": self.warmth_mode,
            }, file, indent=2)
        os.replace(temp, self.dsp_settings_file)

    def configure_warmth(self, enabled=None, drive=None, mode=None) -> bool:
        if enabled is not None:
            self.warmth_enabled = bool(enabled)
        if drive is not None:
            self.warmth_drive = max(1.0, min(3.0, float(drive)))
        if mode is not None:
            self.warmth_mode = 1 if int(mode) == 1 else 0
        self._persist_dsp_settings()
        # Command 'w' (0x77): Stage Warmth config: [ 'w', enabled, mode, 0, drive (float) ]
        payload = struct.pack("<BBBBf", 0x77, int(self.warmth_enabled), self.warmth_mode, 0, self.warmth_drive)
        self._send_udp(payload)
        return True

    def set_analyzer_enabled(self, enabled: bool) -> bool:
        self.analyzer_enabled = bool(enabled)
        self.analyzer_active = self.analyzer_enabled
        self._persist_dsp_settings()
        self._send_udp(bytes([0x48, int(self.analyzer_active), 0, 0]))
        return True

    def set_analyzer_active(self, active: bool) -> bool:
        self.analyzer_active = self.analyzer_enabled and bool(active)
        self._send_udp(bytes([0x48, int(self.analyzer_active), 0, 0]))
        if not self.analyzer_active:
            self.spectrum_bins = []
        return True

    def poll_realtime_state(self, include_spectrum: bool = True):
        self.query_native_status()
        if include_spectrum and self.analyzer_active:
            self.query_spectrum()

    def panic(self, active_notes=None) -> bool:
        # Explicit note-offs supplement the native host's own active-note tracking.
        for note in active_notes or []:
            for channel in range(16):
                self._send_udp(bytes([0x80, channel, int(note) & 0x7F, 0]))
        self._send_udp(bytes([0x21, 0, 0, 0]))
        return True

    @staticmethod
    def _decode_string(raw: bytes) -> str:
        return raw.split(b"\0", 1)[0].decode("utf-8", errors="replace")

    def _parse_native_status(self, packet: bytes) -> Dict[str, Any]:
        if len(packet) != NATIVE_STATUS_SIZE:
            return {"reachable": False}
        values = struct.unpack(NATIVE_STATUS_FORMAT, packet)
        if values[0] != NATIVE_STATUS_MAGIC:
            return {"reachable": False}
        return {
            "reachable": True,
            "dsp_load_percent": round(values[1] * 100.0, 1),
            "peak_dsp_load_percent": round(values[2] * 100.0, 1),
            "xruns": values[3],
            "sample_rate": values[4],
            "buffer_frames": values[5],
            "periods": values[6],
            "buffer_latency_ms": round(values[7], 1),
            "output_latency_ms": round(values[8], 1),
            "total_latency_ms": round(values[9], 1),
            "analyzer_enabled": bool(values[10]),
            "warmth": {
                "enabled": bool(values[11]),
                "drive": round(values[12], 2),
                "mode": int(values[13]),
                "meter": round(values[14], 3),
            },
            "backend": self._decode_string(values[15]),
            "device": self._decode_string(values[16]),
        }

    def query_native_status(self) -> Dict[str, Any]:
        self.native_status = self._parse_native_status(
            self._send_udp(bytes([0x54, 0, 0, 0]), NATIVE_STATUS_SIZE)
        )
        return self.native_status

    def _parse_spectrum(self, packet: bytes) -> List[float]:
        if len(packet) != SPECTRUM_SIZE:
            return []
        values = struct.unpack(SPECTRUM_FORMAT, packet)
        if values[0] != SPECTRUM_MAGIC or values[1] != 96:
            return []
        bins = [round(max(-90.0, min(0.0, float(value))), 1) for value in values[2:]
                if math.isfinite(value)]
        return bins if len(bins) == 96 else []

    def query_spectrum(self) -> List[float]:
        if not self.analyzer_enabled:
            return []
        bins = self._parse_spectrum(self._send_udp(bytes([0x46, 0, 0, 0]), SPECTRUM_SIZE))
        if bins:
            self.spectrum_bins = bins
        return self.spectrum_bins

    def sync_master_dsp_settings(self):
        self.set_analyzer_enabled(self.analyzer_enabled)
        self.configure_warmth(self.warmth_enabled, self.warmth_drive, self.warmth_mode)

    def _load_custom_names(self):
        if os.path.exists(self.names_file):
            try:
                with open(self.names_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    p_names = data.get("parts", {})
                    s_names = data.get("scenes", {})
                    for p in range(1, 9):
                        if str(p) in p_names:
                            self.part_names[p] = str(p_names[str(p)])
                    for s in range(1, 9):
                        if str(s) in s_names:
                            self.scene_names[s] = str(s_names[str(s)])
            except Exception as e:
                print(f"[WARN] Failed to load custom names: {e}")

    def save_custom_names(self, parts: Optional[Dict[str, str]] = None, scenes: Optional[Dict[str, str]] = None):
        if parts:
            for k, v in parts.items():
                p = int(k)
                if 1 <= p <= 8:
                    self.part_names[p] = str(v)[:24]
        if scenes:
            for k, v in scenes.items():
                s = int(k)
                if 1 <= s <= 8:
                    self.scene_names[s] = str(v)[:24]
        try:
            with open(self.names_file, "w", encoding="utf-8") as f:
                json.dump({
                    "parts": {str(k): v for k, v in self.part_names.items()},
                    "scenes": {str(k): v for k, v in self.scene_names.items()}
                }, f, indent=2)
            return True
        except Exception as e:
            print(f"[ERROR] Failed to save custom names: {e}")
            return False

    def send_part_cc(self, part_num: int, cc_num: int, value: int) -> bool:
        """
        Sends standard MIDI CC (e.g. Pan CC#10, Cutoff CC#74, Resonance CC#71, Attack CC#73, Release CC#72, Chorus CC#93)
        to the native montage_live_engine C++ host over UDP command 0x43 ('C').
        """
        if not (1 <= part_num <= 8):
            return False
        value = max(0, min(127, int(value)))
        cc_num = max(0, min(127, int(cc_num)))
        import socket
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            # Command 'C' (0x43): [ 'C', partNum (1-8), ccNum (0-127), value (0-127) ]
            packet = bytes([0x43, part_num & 0xFF, cc_num & 0xFF, value & 0xFF])
            sock.sendto(packet, ("127.0.0.1", 9123))
            sock.close()
            return True
        except Exception as e:
            print(f"Failed to send Part CC {cc_num}: {e}")
            return False

    def _load_saved_scenes(self) -> Dict[int, Any]:
        default_scenes = {
            s: {"master": 127, "parts": {p: 100 for p in range(1, 9)}}
            for s in range(1, 9)
        }
        if os.path.exists(self.presets_file):
            try:
                with open(self.presets_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    # Convert string keys back to int
                    parsed = {}
                    for k, v in data.items():
                        s_num = int(k)
                        parts = {int(pk): int(pv) for pk, pv in v.get("parts", {}).items()}
                        parsed[s_num] = {
                            "master": int(v.get("master", 127)),
                            "parts": parts
                        }
                    # Ensure all 1..8 exist
                    for s in range(1, 9):
                        if s not in parsed:
                            parsed[s] = default_scenes[s]
                    return parsed
            except Exception as e:
                print(f"[WARN] Failed to load scene presets from disk: {e}")
        return default_scenes

    def _persist_saved_scenes(self):
        try:
            with open(self.presets_file, "w", encoding="utf-8") as f:
                json.dump(self.saved_scenes, f, indent=2)
        except Exception as e:
            print(f"[WARN] Failed to write scene presets to disk: {e}")

    def check_installation(self) -> Dict[str, Any]:
        has_vst = os.path.exists(self.vst_path)
        has_data = os.path.exists(self.data_dir)
        has_sam = os.path.exists(STEINBERG_SAM)
        has_host = os.path.exists(MONTAGE_ENGINE_EXE)
        
        perf_count = 0
        perf_dir = os.path.join(self.data_dir, "contents", "current", "performance")
        if os.path.exists(perf_dir):
            perf_count = len([f for f in os.listdir(perf_dir) if f.endswith(".pfm")])
            
        return {
            "vst_installed": has_vst,
            "vst_path": self.vst_path,
            "data_installed": has_data,
            "data_path": self.data_dir,
            "performances_count": perf_count,
            "license_manager_installed": has_sam,
            "host_app_installed": has_host,
            "status": "ready" if (has_vst and has_data) else "missing_components"
        }

    def get_running_engine_type(self) -> Optional[str]:
        """Check which specific engine binary is currently active"""
        import subprocess
        try:
            out_yamaha = subprocess.check_output(
                ['powershell', '-Command', '(Get-Process -Name "montage_live_engine" -ErrorAction SilentlyContinue).Id'],
                creationflags=subprocess.CREATE_NO_WINDOW
            ).decode('utf-8', errors='ignore').strip()
            if out_yamaha:
                return "yamaha"

            out_comm = subprocess.check_output(
                ['powershell', '-Command', '(Get-Process -Name "litwave_community_engine" -ErrorAction SilentlyContinue).Id'],
                creationflags=subprocess.CREATE_NO_WINDOW
            ).decode('utf-8', errors='ignore').strip()
            if out_comm:
                return "community"
        except Exception:
            pass
        return None

    def is_engine_running(self) -> bool:
        """Check if any native C++ host process (Yamaha or Community) is active"""
        return self.get_running_engine_type() is not None

    def kill_vst_engine(self) -> bool:
        """Kill all native C++ host processes completely"""
        import subprocess
        self.toggle_vst_window("kill")
        try:
            subprocess.run(
                ['powershell', '-Command', 'Stop-Process -Name "montage_live_engine","litwave_community_engine" -Force -ErrorAction SilentlyContinue'],
                creationflags=subprocess.CREATE_NO_WINDOW
            )
            return True
        except Exception as e:
            print(f"Error killing engine: {e}")
            return False

    def toggle_vst_window(self, action: str = "toggle") -> bool:
        """
        Controls native Yamaha MONTAGE M VST3 window visibility:
        'show' (1), 'hide' (0), 'minimize' (2)
        """
        import socket
        cmd_map = {"hide": 0, "show": 1, "minimize": 2, "toggle": 1}
        act_code = cmd_map.get(action, 1)
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            # Command 'W' (0x57): [ 'W', action (0=Hide, 1=Show, 2=Minimize), 0, 0 ]
            packet = bytes([0x57, act_code & 0xFF, 0, 0])
            sock.sendto(packet, ("127.0.0.1", 9123))
            sock.close()
            return True
        except Exception as e:
            print(f"Failed to send VST window action: {e}")
            return False

    def open_vst_editor(self, hidden: bool = False, engine: Optional[str] = None) -> bool:
        """Launch the requested engine (Yamaha or Community) with single-instance safety"""
        if engine in ("yamaha", "community"):
            self.engine_type = engine

        current_running = self.get_running_engine_type()

        # If a different engine is currently running, kill it before launching the new one!
        if current_running and current_running != self.engine_type:
            self.kill_vst_engine()
            import time
            time.sleep(0.35)
            current_running = None

        # If the requested engine is ALREADY running:
        if current_running == self.engine_type:
            if self.engine_type == "yamaha":
                # Toggle Yamaha Win32 window
                self.toggle_vst_window("hide" if hidden else "show")
                return True
            else:
                # Community engine is already running fine in background
                return True

        target_exe = COMMUNITY_ENGINE_EXE if self.engine_type == "community" else YAMAHA_ENGINE_EXE
        if os.path.exists(target_exe):
            try:
                cmd = [target_exe]
                if hidden and self.engine_type == "yamaha":
                    cmd.append("--hidden")
                subprocess.Popen(
                    cmd,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    close_fds=True,
                    creationflags=subprocess.DETACHED_PROCESS,
                    cwd=os.path.dirname(target_exe)
                )
                return True
            except Exception as e:
                print(f"Error launching native host ({target_exe}): {e}")
                return False
        return False

    def open_license_manager(self) -> bool:
        if os.path.exists(STEINBERG_SAM):
            subprocess.Popen([STEINBERG_SAM], shell=False)
            return True
        return False

    def send_midi_cc(self, channel: int, cc_number: int, value: int) -> bool:
        """Send a MIDI Control Change packet to the native C++ engine via UDP"""
        import socket
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            # 0xB0 = CC command, channel 0..15, cc_number (e.g. 7), value 0..127
            packet = bytes([0xB0, channel & 0x0F, cc_number & 0x7F, value & 0x7F])
            sock.sendto(packet, ("127.0.0.1", 9123))
            sock.close()
            return True
        except Exception as e:
            print(f"Failed to send UDP MIDI CC: {e}")
            return False

    def send_drone_note_on(self, note: int, velocity: int = 85) -> bool:
        """Send dedicated drone Note On (cmd 0x98) - isolated and recognized across both Yamaha & Community"""
        try:
            packet = bytes([0x98, 0, note & 0x7F, velocity & 0x7F])
            self._send_udp(packet)
            return True
        except Exception as e:
            print(f"Failed to send Drone Note On: {e}")
            return False

    def send_drone_note_off(self, note: int) -> bool:
        """Send dedicated drone Note Off (cmd 0x88) - isolated and recognized across both Yamaha & Community"""
        try:
            packet = bytes([0x88, 0, note & 0x7F, 0])
            self._send_udp(packet)
            return True
        except Exception as e:
            print(f"Failed to send Drone Note Off: {e}")
            return False

    def set_drone_voice(self, bank_idx: int, preset_idx: int) -> bool:
        """Assign voice preset to dedicated Drone Synth over UDP command 0x99"""
        try:
            packet = bytes([0x99, bank_idx & 0xFF, preset_idx & 0xFF, 0])
            self._send_udp(packet)
            return True
        except Exception as e:
            print(f"Failed to set Drone voice: {e}")
            return False

    def set_drone_volume(self, vol: int) -> bool:
        """Set dedicated Drone volume over UDP command 0x97"""
        try:
            vol = max(0, min(127, int(vol)))
            packet = bytes([0x97, vol & 0x7F, 0, 0])
            self._send_udp(packet)
            return True
        except Exception as e:
            print(f"Failed to set Drone volume: {e}")
            return False

    def set_drone_cutoff(self, cutoff: int) -> bool:
        """Set dedicated Drone cutoff filter over UDP command 0x96"""
        try:
            cutoff = max(0, min(127, int(cutoff)))
            packet = bytes([0x96, cutoff & 0x7F, 0, 0])
            self._send_udp(packet)
            return True
        except Exception as e:
            print(f"Failed to set Drone cutoff: {e}")
            return False

    def send_note_on(self, channel: int, note: int, velocity: int = 80) -> bool:
        """Send Note On: [ 0x90, channel (0-15), note (0-127), velocity (0-127) ]"""
        try:
            packet = bytes([0x90, channel & 0x0F, note & 0x7F, velocity & 0x7F])
            self._send_udp(packet)
            return True
        except Exception as e:
            print(f"Failed to send Note On: {e}")
            return False

    def send_note_off(self, channel: int, note: int) -> bool:
        """Send Note Off: [ 0x80, channel (0-15), note (0-127), 0 ]"""
        try:
            packet = bytes([0x80, channel & 0x0F, note & 0x7F, 0])
            self._send_udp(packet)
            return True
        except Exception as e:
            print(f"Failed to send Note Off: {e}")
            return False

    def set_drone_isolation(self, is_isolated: bool) -> bool:
        """Toggle Part 8 isolation over UDP command 'D' (0x44)"""
        try:
            val = 1 if is_isolated else 0
            packet = bytes([0x44, val, 0, 0])
            self._send_udp(packet)
            return True
        except Exception as e:
            print(f"Failed to send Drone Isolation: {e}")
            return False

    def assign_part_voice(self, part_num: int, bank_idx: int, preset_idx: int) -> bool:
        """Assign voice preset to a part over UDP command 'K' (0x4B)"""
        try:
            packet = bytes([0x4B, part_num & 0xFF, bank_idx & 0xFF, preset_idx & 0xFF])
            self._send_udp(packet)
            return True
        except Exception as e:
            print(f"Failed to assign voice to part {part_num}: {e}")
            return False
    def set_part_volume(self, part_number: int, volume_val: int) -> bool:
        """
        Sets volume for MONTAGE M Part (1-8).
        Sends ONLY the direct VST3 parameter update ('V') targeting P1-P8 Volume tags.
        Does NOT send MIDI CC#7 on channel 0, which was altering the Common/Master slider.
        """
        import socket
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            # Direct VST3 parameter change packet: [ 'V', partNum (1-8), volume (0-127), 0 ]
            packet_v = bytes([0x56, part_number & 0xFF, volume_val & 0x7F, 0])
            sock.sendto(packet_v, ("127.0.0.1", 9123))
            sock.close()
            self.part_volumes[part_number] = volume_val
            return True
        except Exception as e:
            print(f"Failed to set part volume: {e}")
            return False

    def set_part_reverb(self, part_number: int, reverb_val: int) -> bool:
        """
        Sets Reverb Send for Part (1-8) in MONTAGE M (Tag 568872068, etc.).
        reverb_val: 0 - 127
        """
        if not (1 <= part_number <= 8):
            return False
        import socket
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            # Command 'R' (0x52): [ 'R', partNum (1-8), reverbVal (0-127), 0 ]
            packet_r = bytes([0x52, part_number & 0xFF, reverb_val & 0x7F, 0])
            sock.sendto(packet_r, ("127.0.0.1", 9123))
            sock.close()
            self.part_reverbs[part_number] = reverb_val
            return True
        except Exception as e:
            print(f"Failed to set part reverb: {e}")
            return False

    def set_part_mute(self, part_number: int, is_muted: bool) -> bool:
        """
        Sets Mute Switch for Part (1-8) in MONTAGE M (Tag 568871075, etc.).
        """
        if not (1 <= part_number <= 8):
            return False
        import socket
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            # Command 'U' (0x55): [ 'U', partNum (1-8), isMuted (1 or 0), 0 ]
            packet_u = bytes([0x55, part_number & 0xFF, 1 if is_muted else 0, 0])
            sock.sendto(packet_u, ("127.0.0.1", 9123))
            sock.close()
            self.part_mutes[part_number] = bool(is_muted)
            return True
        except Exception as e:
            print(f"Failed to set part mute: {e}")
            return False

    def toggle_part_solo(self, part_number: int) -> bool:
        """
        Toggles Solo for Part (1-8). If soloed, mutes all other parts.
        If un-soloed, unmutes all parts that were not individually muted.
        """
        if not (1 <= part_number <= 8):
            return False
        new_solo = not self.part_solos[part_number]
        self.part_solos[part_number] = new_solo
        
        has_any_solo = any(self.part_solos.values())
        for p in range(1, 9):
            if has_any_solo:
                should_mute = not self.part_solos[p]
            else:
                should_mute = self.part_mutes.get(p, False)
            # Send mute packet directly to engine
            import socket
            try:
                sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                packet_u = bytes([0x55, p & 0xFF, 1 if should_mute else 0, 0])
                sock.sendto(packet_u, ("127.0.0.1", 9123))
                sock.close()
            except Exception:
                pass
        return True

    def set_master_vst_volume(self, volume_val: int) -> bool:
        """
        Sets Common / Master Performance Volume in MONTAGE M VST (Tag 2003600142).
        volume_val: 0 - 127
        """
        import socket
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            # Command 'M' (0x4D): [ 'M', 0, volume (0-127), 0 ]
            packet_m = bytes([0x4D, 0, volume_val & 0x7F, 0])
            sock.sendto(packet_m, ("127.0.0.1", 9123))
            sock.close()
            self.master_vst_volume = volume_val
            return True
        except Exception as e:
            print(f"Failed to set master VST volume: {e}")
            return False

    def set_master_output_gain(self, gain_float: float) -> bool:
        """
        Sets global hardware output gain in C++ host across both VST and Backing Track.
        Command 'G' (0x47): [ 'G', 0, 0, 0, gainFloat (float32) ]
        """
        import socket
        import struct
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            payload = struct.pack("<BBBBf", 0x47, 0, 0, 0, float(gain_float))
            sock.sendto(payload, ("127.0.0.1", 9123))
            sock.close()
            return True
        except Exception as e:
            print(f"Failed to send Master hardware gain: {e}")
            return False

    def update_vst_equalizer(self, band_idx: int, eq_type: int, freq: float, gain: float, q: float) -> bool:
        """
        Sends real-time parametric EQ updates to montage_live_engine C++ host over UDP (Port 9123).
        Command 'E' (0x45): [ 'E', bandIdx (0-3), type (0-2), 0, freq (float32), gain (float32), q (float32) ]
        """
        import socket
        import struct
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            payload = struct.pack("<BBBBfff", 0x45, band_idx & 0xFF, eq_type & 0xFF, 0, float(freq), float(gain), float(q))
            sock.sendto(payload, ("127.0.0.1", 9123))
            sock.close()
            return True
        except Exception as e:
            print(f"Failed to send EQ update to native host: {e}")
            return False

    def select_scene(self, scene_number: int) -> bool:
        """
        Switches active Scene (1-8) in Yamaha MONTAGE M via MIDI CC#92.
        scene_number: 1 - 8
        """
        if not (1 <= scene_number <= 8):
            return False
        import socket
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            # Command 'S' (0x53): [ 'S', sceneNumber (1-8), 0, 0 ]
            packet_s = bytes([0x53, scene_number & 0xFF, 0, 0])
            sock.sendto(packet_s, ("127.0.0.1", 9123))
            sock.close()
            self.current_scene = scene_number
            return True
        except Exception as e:
            print(f"Failed to switch Scene: {e}")
            return False

    def save_scene_snapshot(self, scene_number: int) -> bool:
        """
        Saves the current master volume and Part 1-8 volumes into the specified scene slot (1-8)
        and persists them to disk so they survive application restarts.
        """
        if not (1 <= scene_number <= 8):
            return False
        self.saved_scenes[scene_number] = {
            "master": self.master_vst_volume,
            "parts": dict(self.part_volumes)
        }
        self._persist_saved_scenes()
        return True

    def recall_saved_scene(self, scene_number: int) -> bool:
        """
        Recalls the saved master volume and Part 1-8 volumes for the scene,
        sending them to the VST engine and switching to that scene.
        """
        if not (1 <= scene_number <= 8):
            return False
        self.select_scene(scene_number)
        snap = self.saved_scenes.get(scene_number)
        if snap:
            if "master" in snap:
                self.set_master_vst_volume(snap["master"])
            if "parts" in snap:
                for p, v in snap["parts"].items():
                    self.set_part_volume(int(p), int(v))
        return True
