"""
Runtime lifecycle and state management for Montage Practice DAW.
Houses AppState, lifespan management, and clean hardware boot/shutdown.
Does NOT construct audio/MIDI hardware, native VST hosts, or background threads on import.
"""

import os
import json
import asyncio
import logging
import threading
import time
from contextlib import asynccontextmanager
from typing import List, Optional, Callable, Any, Dict
from starlette.websockets import WebSocket

from src.setlist_manager import SetlistManager
from src.playlist_manager import PlaylistManager

logger = logging.getLogger("litwave")

# Single source of truth for valid FX pad banks (A-F).
SUPPORTED_FX_BANKS = ("A", "B", "C", "D", "E", "F")


class AppState:
    def __init__(self, on_midi_event_cb: Optional[Callable[[Dict[str, Any]], None]] = None):
        # ponytail: no audio/MIDI/native objects here; constructed in boot().
        # Safe data-only init so `import src.runtime` or `import src.server` never touches hardware.
        self.audio = None         # AudioEngine, created in boot()
        self.midi = None          # MidiManager, created in boot()
        self.montage = None       # MontageHost, created in boot()
        self.drone_pad = None     # DronePadManager, created in boot()
        self.ear_training = None  # EarTrainingManager, created in boot()
        self.setlist = SetlistManager()
        self.playlist = PlaylistManager()
        self.ws_clients: List[WebSocket] = []
        self._loop: Optional[asyncio.AbstractEventLoop] = None
        self.analyzer_visible_clients = 1
        self._monitor_running = True
        self._monitor_thread: Optional[threading.Thread] = None
        self._booted = False
        self._on_midi_event_cb = on_midi_event_cb

    def boot(self):
        """Construct runtime components and start hardware resources.
        Called once via Starlette lifespan, never on import."""
        if self._booted:
            return
        self._booted = True

        # Lazy imports: these modules pull in native/audio deps (sounddevice, mido, miniaudio).
        from src.audio_engine import AudioEngine
        from src.midi_manager import MidiManager
        from src.montage_host import MontageHost
        from src.ear_training import EarTrainingManager
        from src.drone_pad import DronePadManager

        # Dependency order: MontageHost first (pure state + UDP), then AudioEngine
        # (creates UDP socket, SongPlayer, FxSampler which preloads samples),
        # then MidiManager (starts worker thread), then managers that depend on them.
        self.montage = MontageHost()
        self.audio = AudioEngine()
        cb = self._on_midi_event_cb or self._default_on_midi_event
        self.midi = MidiManager(on_event_callback=cb)
        self.drone_pad = DronePadManager(self.montage)
        self.ear_training = EarTrainingManager()

        self._monitor_thread = threading.Thread(target=self._monitor_native_engine, daemon=True)
        self._monitor_thread.start()

        # Start audio with default ASIO or system device
        self.audio.start_stream()

        # Open first MIDI port if any available
        ports = self.midi.get_available_ports()
        if ports:
            self.midi.open_port(0)

    def shutdown(self):
        """Orderly shutdown of owned runtime resources. Idempotent."""
        self._monitor_running = False
        if self._monitor_thread and self._monitor_thread.is_alive():
            self._monitor_thread.join(timeout=2.0)
        if self.audio is not None:
            try:
                self.audio.stop_stream()
            except Exception:
                logger.warning("audio.stop_stream error", exc_info=True)
            try:
                self.audio.udp_sock.close()
            except Exception:
                logger.warning("audio.udp_sock.close error", exc_info=True)
        if self.midi is not None:
            try:
                self.midi.stop()
            except Exception:
                logger.warning("midi.stop error", exc_info=True)

    def _default_on_midi_event(self, event_dict):
        # Push raw note event immediately to browser & phone to trigger zero-latency chord updates
        if self.ws_clients and self._loop and self._loop.is_running() and self.midi is not None:
            ev_type = event_dict.get("type")
            if ev_type in ("note_on", "note_off"):
                snapshot = self.midi.get_snapshot()
                event_dict["active_notes"] = snapshot["active_notes"]
                event_dict["active_note_names"] = snapshot["active_note_names"]
                msg = json.dumps({
                    "type": "midi_event",
                    "data": event_dict
                })
                for client in list(self.ws_clients):
                    try:
                        asyncio.run_coroutine_threadsafe(client.send_text(msg), self._loop)
                    except Exception:
                        pass

    def _monitor_native_engine(self):
        """Poll slow native DSP/FFT state off the audio and ASGI threads."""
        last_sync = 0.0
        while self._monitor_running and self.montage is not None:
            now = time.monotonic()
            if now - last_sync > 2.0 and self.montage.native_status.get("reachable") is not True:
                self.montage.sync_master_dsp_settings()
                last_sync = now
            self.montage.poll_realtime_state(include_spectrum=self.analyzer_visible_clients > 0)
            time.sleep(0.12)

    def set_analyzer_visible(self, visible: bool):
        self.analyzer_visible_clients = 1 if visible else 0
        if self.montage is not None:
            self.montage.set_analyzer_active(visible)

    async def broadcast(self, message: str):
        dead_clients = []
        for client in self.ws_clients:
            try:
                await client.send_text(message)
            except Exception:
                dead_clients.append(client)
        for d in dead_clients:
            if d in self.ws_clients:
                self.ws_clients.remove(d)


@asynccontextmanager
async def create_lifespan(app_state: AppState):
    """Lifespan context manager factory for Starlette."""
    app_state.boot()
    yield
    app_state.shutdown()
