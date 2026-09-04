"""
Yamaha MONTAGE M E.S.P. Host Manager
Manages discovery, verification, license state, and native editor launching
"""

import os
import subprocess
from typing import Dict, Any

VST3_DIR = r"C:\Program Files\Common Files\VST3\Yamaha\Expanded Softsynth Plugin for MONTAGE M.vst3"
VST3_BIN = r"C:\Program Files\Common Files\VST3\Yamaha\Expanded Softsynth Plugin for MONTAGE M.vst3\Contents\x86_64-win\Expanded Softsynth Plugin for MONTAGE M.vst3"
DATA_DIR = r"C:\ProgramData\Yamaha\Expanded Softsynth Plugin for MONTAGE M"
STEINBERG_SAM = r"C:\Program Files\Steinberg\Activation Manager\SteinbergActivationManager.exe"
MONTAGE_ENGINE_EXE = r"C:\Users\Jeremy Rukmana\Projects\montage-practice-daw\cpp_host\montage_live_engine.exe"

class MontageHost:
    def __init__(self):
        self.vst_path = VST3_BIN
        self.data_dir = DATA_DIR
        self.editor_process = None
        self.master_vst_volume = 127
        self.part_volumes = {i: 100 for i in range(1, 9)}

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

    def open_vst_editor(self) -> bool:
        """Launch the exact native Yamaha MONTAGE M GUI window directly"""
        if os.path.exists(MONTAGE_ENGINE_EXE):
            try:
                subprocess.Popen([MONTAGE_ENGINE_EXE], shell=False)
                return True
            except Exception as e:
                print(f"Error launching native host: {e}")
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
