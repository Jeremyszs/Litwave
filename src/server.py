"""
HTTP & WebSocket Server for Montage Practice DAW
Connects the backend audio/MIDI engine to the Impeccable studio frontend
"""

import os
import json
import asyncio
import threading
import time
from typing import List
from starlette.applications import Starlette
from starlette.responses import JSONResponse, HTMLResponse, FileResponse
from starlette.routing import Route, WebSocketRoute, Mount
from starlette.staticfiles import StaticFiles
from starlette.websockets import WebSocket, WebSocketDisconnect

from src.audio_engine import AudioEngine
from src.midi_manager import MidiManager
from src.montage_host import MontageHost
from src.ear_training import EarTrainingManager
from src.analyzer import analyze_track
from src.lyrics import fetch_synced_lyrics
from src.async_worker import run_in_executor

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(STATIC_DIR, exist_ok=True)

class AppState:
    def __init__(self):
        self.audio = AudioEngine()
        self.midi = MidiManager(on_event_callback=self._on_midi_event)
        self.montage = MontageHost()
        self.ear_training = EarTrainingManager()
        self.ws_clients: List[WebSocket] = []
        self._loop: asyncio.AbstractEventLoop = None
        self.analyzer_visible_clients = 1
        self._monitor_running = True
        self._monitor_thread = threading.Thread(target=self._monitor_native_engine, daemon=True)
        self._monitor_thread.start()
        
        # Start audio with default ASIO or system device
        self.audio.start_stream()
        
        # Open first MIDI port if any available
        ports = self.midi.get_available_ports()
        if ports:
            self.midi.open_port(0)

    def _on_midi_event(self, event_dict):
        # Push raw note event immediately to browser & phone to trigger zero-latency chord updates
        if self.ws_clients and self._loop and self._loop.is_running():
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
        while self._monitor_running:
            now = time.monotonic()
            if now - last_sync > 2.0 and self.montage.native_status.get("reachable") is not True:
                self.montage.sync_master_dsp_settings()
                last_sync = now
            self.montage.poll_realtime_state(include_spectrum=self.analyzer_visible_clients > 0)
            time.sleep(0.12)

    def set_analyzer_visible(self, visible: bool):
        self.analyzer_visible_clients = 1 if visible else 0
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

state = AppState()

# REST Endpoints
async def api_status(request):
    telemetry = {
        "audio": state.audio.get_telemetry(),
        "midi": state.midi.get_snapshot(),
        "song": state.audio.song_player.get_telemetry(),
        "montage": state.montage.check_installation(),
        "engine": state.montage.native_status,
        "devices": {
            "audio_outputs": state.audio.get_output_devices(force_refresh=True),
            "midi_inputs": state.midi.get_available_ports(force_refresh=True)
        }
    }
    return JSONResponse(telemetry)

async def api_transport(request):
    body = await request.json()
    action = body.get("action")
    sp = state.audio.song_player
    
    if action == "play":
        sp.play()
        # Align metronome phase ONCE at play/seek trigger
        if state.audio.metronome.enabled:
            downbeat = sp.get_beat_origin()
            cur_sec = sp.current_frame / float(state.audio.samplerate)
            state.audio.metronome.sync_to_playhead(cur_sec, downbeat)
    elif action == "pause":
        sp.pause()
    elif action == "stop":
        sp.stop()
        if state.audio.metronome.enabled:
            downbeat = sp.get_beat_origin()
            state.audio.metronome.sync_to_playhead(0.0, downbeat)
    elif action == "toggle":
        sp.toggle_play()
        if sp.is_playing and state.audio.metronome.enabled:
            downbeat = sp.get_beat_origin()
            cur_sec = sp.current_frame / float(state.audio.samplerate)
            state.audio.metronome.sync_to_playhead(cur_sec, downbeat)
    elif action == "seek":
        sec = float(body.get("seconds", 0.0))
        sp.seek_seconds(sec)
        if state.audio.metronome.enabled:
            downbeat = sp.get_beat_origin()
            state.audio.metronome.sync_to_playhead(sec, downbeat)
    elif action == "loop_a":
        sec = body.get("seconds")
        sp.set_loop_a(float(sec) if sec is not None else None)
    elif action == "loop_b":
        sec = body.get("seconds")
        sp.set_loop_b(float(sec) if sec is not None else None)
    elif action == "toggle_loop":
        sp.toggle_loop()
    elif action == "clear_loop":
        sp.clear_loop()
    elif action == "clear_track":
        sp.clear_track()
    elif action == "add_marker":
        name = body.get("name")
        sec = body.get("time")
        scene = body.get("scene")
        sp.add_marker(name, sec, scene)
    elif action == "remove_marker":
        m_id = int(body.get("id", 0))
        sp.remove_marker(m_id)
    elif action == "update_marker":
        m_id = int(body.get("id", 0))
        new_time = float(body["time"]) if "time" in body else None
        name = body.get("name")
        scene = body.get("scene")
        sp.update_marker(m_id, new_sec=new_time, name=name, scene=scene)
    elif action == "clear_markers":
        sp.clear_markers()
    elif action == "record_chord":
        c_name = body.get("chord")
        nash = body.get("nashville", "")
        sec = body.get("time")
        if c_name:
            sp.record_chord(c_name, nash, float(sec) if sec is not None else None)
    elif action == "clear_chords":
        sp.clear_chord_chart()
    elif action == "speed":
        spd = float(body.get("speed", 1.0))
        sp.set_speed(spd)
    elif action == "pitch_shift":
        semi = int(body.get("semitones", 0))
        sp.set_pitch_shift(semi)
    elif action == "volume":
        vol = float(body.get("volume", 0.8))
        sp.set_volume(vol)
        state.audio.track_volume = vol
        
    telem = sp.get_telemetry()
    telem["success"] = True
    return JSONResponse(telem)

async def api_mixer(request):
    body = await request.json()
    if "master_volume" in body:
        mv = float(body["master_volume"])
        state.audio.master_volume = mv
        state.montage.set_master_output_gain(mv)
    if "track_volume" in body:
        v = float(body["track_volume"])
        state.audio.track_volume = v
        state.audio.song_player.set_volume(v)
    if "metronome_volume" in body:
        state.audio.metronome_volume = float(body["metronome_volume"])
    if "metronome_profile" in body:
        state.audio.metronome.set_sound_profile(str(body["metronome_profile"]))
    if "metronome_bpm" in body:
        state.audio.metronome.set_bpm(float(body["metronome_bpm"]))
    if "metronome_time_sig" in body:
        state.audio.metronome.set_time_sig(int(body["metronome_time_sig"]))
    if "toggle_metronome" in body:
        state.audio.metronome.toggle()
        # Immediately lock phase to backing track if song is playing
        if state.audio.metronome.enabled and state.audio.song_player.is_playing:
            sp = state.audio.song_player
            downbeat = sp.get_beat_origin()
            cur_sec = sp.current_frame / float(state.audio.samplerate)
            state.audio.metronome.sync_to_playhead(cur_sec, downbeat)
        
    if "equalizer_band" in body:
        b_info = body["equalizer_band"]
        idx = int(b_info.get("index", 0))
        freq = float(b_info["freq"]) if "freq" in b_info else None
        gain = float(b_info["gain"]) if "gain" in b_info else None
        q = float(b_info["q"]) if "q" in b_info else None
        state.audio.equalizer.update_band(idx, freq=freq, gain=gain, q=q)
        # Simultaneously update native montage_live_engine C++ VST host
        b_obj = state.audio.equalizer.bands[idx]
        t_code = 0 if b_obj["type"] == "lowshelf" else (1 if b_obj["type"] == "peaking" else 2)
        state.montage.update_vst_equalizer(idx, t_code, b_obj["freq"], b_obj["gain"], b_obj["q"])
    if "equalizer_enabled" in body:
        state.audio.equalizer.enabled = bool(body["equalizer_enabled"])
    if "equalizer_reset" in body:
        state.audio.equalizer.reset_flat()
        for idx in range(4):
            b_obj = state.audio.equalizer.bands[idx]
            t_code = 0 if b_obj["type"] == "lowshelf" else (1 if b_obj["type"] == "peaking" else 2)
            state.montage.update_vst_equalizer(idx, t_code, b_obj["freq"], 0.0, b_obj["q"])
        
    telem = state.audio.get_telemetry()
    telem["success"] = True
    return JSONResponse(telem)

async def api_audio_device(request):
    body = await request.json()
    dev_id = int(body.get("device_id", 0))
    sr = body.get("samplerate")
    bs = body.get("blocksize")
    ok = state.audio.start_stream(device_id=dev_id, samplerate=sr, blocksize=bs)
    return JSONResponse({"success": ok, "telemetry": state.audio.get_telemetry()})

async def api_midi_device(request):
    body = await request.json()
    if "port" in body:
        port = body.get("port")
        state.midi.open_port(port)
    return JSONResponse({"success": True, "snapshot": state.midi.get_snapshot()})

async def api_upload_song(request):
    form = await request.form()
    file = form.get("file")
    if not file:
        return JSONResponse({"error": "No file uploaded"}, status_code=400)
        
    dest_path = os.path.join(STATIC_DIR, "uploads", file.filename)
    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    
    contents = await file.read()
    with open(dest_path, "wb") as f:
        f.write(contents)
        
    ok = state.audio.song_player.load_file(dest_path)
    return JSONResponse({
        "success": ok,
        "filename": file.filename,
        "song": state.audio.song_player.get_telemetry()
    })

async def api_launch_license_manager(request):
    ok = state.montage.open_license_manager()
    return JSONResponse({"success": ok})

async def index(request):
    html_path = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(html_path):
        with open(html_path, "r", encoding="utf-8") as f:
            return HTMLResponse(f.read())
    return HTMLResponse("<h1>Montage Practice DAW is starting...</h1>")

class CustomJSONEncoder(json.JSONEncoder):
    def default(self, obj):
        import numpy as np
        if isinstance(obj, (np.bool_, np.bool)):
            return bool(obj)
        if isinstance(obj, (np.integer, np.int64, np.int32)):
            return int(obj)
        if isinstance(obj, (np.floating, np.float32, np.float64)):
            return float(obj)
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        return super().default(obj)

async def ws_telemetry(websocket: WebSocket):
    await websocket.accept()
    state.ws_clients.append(websocket)
    state._loop = asyncio.get_event_loop()
    tick = 0
    try:
        while True:
            tick += 1
            # Every 25 ticks (~1.0s), include refreshed device lists in telemetry
            include_devices = (tick % 25 == 0)
            telemetry = {
                "type": "telemetry",
                "audio": state.audio.get_telemetry(),
                "song": state.audio.song_player.get_telemetry(),
                "midi": state.midi.get_snapshot(),
                "engine": state.montage.native_status,
                "spectrum": state.montage.spectrum_bins if state.analyzer_visible_clients > 0 else [],
                "montage": {
                    "engine_type": state.montage.engine_type,
                    "is_running": state.montage.native_status.get("reachable", False),
                    "master_volume": state.montage.master_vst_volume,
                    "part_volumes": state.montage.part_volumes,
                    "part_reverbs": state.montage.part_reverbs,
                    "part_mutes": state.montage.part_mutes,
                    "part_solos": state.montage.part_solos,
                    "part_names": state.montage.part_names,
                    "scene_names": state.montage.scene_names,
                    "part_pans": state.montage.part_pans,
                    "part_cutoffs": state.montage.part_cutoffs,
                    "part_resonances": state.montage.part_resonances,
                    "part_attacks": state.montage.part_attacks,
                    "part_releases": state.montage.part_releases,
                    "part_chorus": state.montage.part_chorus,
                    "current_scene": state.montage.current_scene
                }
            }
            if include_devices:
                telemetry["devices"] = {
                    "audio_outputs": state.audio.get_output_devices(),
                    "midi_inputs": state.midi.get_available_ports()
                }
            await websocket.send_text(json.dumps(telemetry, cls=CustomJSONEncoder))
            await asyncio.sleep(0.04) # 25fps refresh
    except (WebSocketDisconnect, asyncio.CancelledError, RuntimeError):
        pass
    finally:
        if websocket in state.ws_clients:
            state.ws_clients.remove(websocket)

async def api_open_editor(request):
    try:
        data = await request.json() if request.method == "POST" else {}
        action = data.get("action")
        engine = data.get("engine") # "yamaha" or "community"
        if action == "kill":
            ok = state.montage.kill_vst_engine()
            return JSONResponse({"success": ok, "action": "kill"})
        elif action == "switch":
            state.montage.kill_vst_engine()
            time.sleep(0.3)
            ok = state.montage.open_vst_editor(hidden=False, engine=engine)
            return JSONResponse({"success": ok, "action": "switched", "engine": state.montage.engine_type})
        elif action in ("hide", "show", "minimize"):
            # Check if running first
            if not state.montage.is_engine_running():
                ok = state.montage.open_vst_editor(hidden=(action == "hide"), engine=engine)
                return JSONResponse({"success": ok, "action": "started_fresh", "engine": state.montage.engine_type})
            ok = state.montage.toggle_vst_window(action)
            return JSONResponse({"success": ok, "action": action, "engine": state.montage.engine_type})
        elif action == "start":
            hidden = bool(data.get("hidden", True))
            ok = state.montage.open_vst_editor(hidden=hidden, engine=engine)
            return JSONResponse({"success": ok, "action": "started", "engine": state.montage.engine_type})
    except Exception:
        pass
    ok = state.montage.open_vst_editor()
    return JSONResponse({"success": ok, "engine": state.montage.engine_type})

async def api_voices_catalog(request):
    """Return available voice presets in Community SoundFont VST catalog"""
    catalog_path = os.path.join(os.path.dirname(__file__), "voice_catalog.json")
    if os.path.exists(catalog_path):
        try:
            with open(catalog_path, "r", encoding="utf-8") as f:
                return JSONResponse(json.load(f))
        except Exception:
            pass
    return JSONResponse([])

async def api_assign_voice(request):
    """Assign a soundfont voice to a part in Community VST"""
    try:
        data = await request.json()
        part = int(data.get("part", 1))
        bank = int(data.get("bank", 0))
        preset = int(data.get("preset", 0))
        name = data.get("name")
        ok = state.montage.assign_part_voice(part, bank, preset)
        if name:
            state.montage.part_names[part] = name
            state.montage._save_custom_names()
        return JSONResponse({"success": ok, "part": part, "bank": bank, "preset": preset, "name": name})
    except Exception as e:
        return JSONResponse({"success": False, "error": str(e)}, status_code=500)

async def api_montage_volume(request):
    try:
        data = await request.json()
        if "master_volume" in data:
            val = int(data["master_volume"])
            ok = state.montage.set_master_vst_volume(val)
            return JSONResponse({"success": ok, "master_volume": val})
        part = int(data.get("part", 1))
        if "reverb" in data:
            rev = int(data["reverb"])
            ok = state.montage.set_part_reverb(part, rev)
            return JSONResponse({"success": ok, "part": part, "reverb": rev})
        if "mute" in data:
            m = bool(data["mute"])
            ok = state.montage.set_part_mute(part, m)
            return JSONResponse({"success": ok, "part": part, "mute": m})
        if "solo" in data:
            ok = state.montage.toggle_part_solo(part)
            return JSONResponse({"success": ok, "part": part, "solos": state.montage.part_solos, "mutes": state.montage.part_mutes})
        if "pan" in data:
            pan = int(data["pan"])
            state.montage.part_pans[part] = pan
            ok = state.montage.send_part_cc(part, 10, pan) # CC#10 Pan
            return JSONResponse({"success": ok, "part": part, "pan": pan})
        if "cutoff" in data:
            cut = int(data["cutoff"])
            state.montage.part_cutoffs[part] = cut
            ok = state.montage.send_part_cc(part, 74, cut) # CC#74 Brightness / Cutoff
            return JSONResponse({"success": ok, "part": part, "cutoff": cut})
        if "resonance" in data:
            res = int(data["resonance"])
            state.montage.part_resonances[part] = res
            ok = state.montage.send_part_cc(part, 71, res) # CC#71 Harmonic / Resonance
            return JSONResponse({"success": ok, "part": part, "resonance": res})
        if "attack" in data:
            att = int(data["attack"])
            state.montage.part_attacks[part] = att
            ok = state.montage.send_part_cc(part, 73, att) # CC#73 Attack Time
            return JSONResponse({"success": ok, "part": part, "attack": att})
        if "release" in data:
            rel = int(data["release"])
            state.montage.part_releases[part] = rel
            ok = state.montage.send_part_cc(part, 72, rel) # CC#72 Release Time
            return JSONResponse({"success": ok, "part": part, "release": rel})
        if "chorus" in data:
            cho = int(data["chorus"])
            state.montage.part_chorus[part] = cho
            ok = state.montage.send_part_cc(part, 93, cho) # CC#93 Chorus Send
            return JSONResponse({"success": ok, "part": part, "chorus": cho})
        volume = int(data.get("volume", 100)) # 0 - 127
        ok = state.montage.set_part_volume(part, volume)
        return JSONResponse({"success": ok, "part": part, "volume": volume})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)

async def api_remote_info(request):
    """Provides local LAN IP and public tunnel URL for phone pairing QR code"""
    import socket, json
    hostname = socket.gethostname()
    lan_ip = "127.0.0.1"
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        lan_ip = s.getsockname()[0]
        s.close()
    except Exception:
        pass

    tunnel_url = None
    litwave_tunnel_file = os.path.expandvars(r"%LOCALAPPDATA%\litwave\tunnel_state.json")
    if os.path.exists(litwave_tunnel_file):
        try:
            with open(litwave_tunnel_file, "r", encoding="utf-8") as f:
                tdata = json.load(f)
                tunnel_url = tdata.get("tunnelUrl")
        except Exception:
            pass

    return JSONResponse({
        "lan_ip": lan_ip,
        "port": 8080,
        "local_url": f"http://{lan_ip}:8080/remote",
        "tunnel_url": f"{tunnel_url}/remote" if tunnel_url else None,
        "preferred_url": f"{tunnel_url}/remote" if tunnel_url else f"http://{lan_ip}:8080/remote"
    })

async def remote_page(request):
    path = os.path.join(STATIC_DIR, "remote.html")
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return HTMLResponse(f.read())
    return HTMLResponse("<h1>Remote page not found</h1>", status_code=404)

async def api_montage_scene(request):
    try:
        data = await request.json()
        action = data.get("action", "select")
        scene = int(data.get("scene", 1))
        if action == "save":
            ok = state.montage.save_scene_snapshot(scene)
            return JSONResponse({"success": ok, "action": "save", "scene": scene, "snapshot": state.montage.saved_scenes[scene]})
        elif action == "recall":
            ok = state.montage.recall_saved_scene(scene)
            return JSONResponse({"success": ok, "action": "recall", "scene": scene, "snapshot": state.montage.saved_scenes[scene]})
        else:
            ok = state.montage.select_scene(scene)
            return JSONResponse({"success": ok, "action": "select", "scene": scene})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)

async def api_custom_names(request):
    """Saves and retrieves custom user labels for MONTAGE M Parts 1-8 and Scenes 1-8"""
    try:
        if request.method == "POST":
            data = await request.json()
            parts = data.get("parts")
            scenes = data.get("scenes")
            ok = state.montage.save_custom_names(parts, scenes)
            return JSONResponse({"success": ok, "parts": state.montage.part_names, "scenes": state.montage.scene_names})
        else:
            return JSONResponse({"parts": state.montage.part_names, "scenes": state.montage.scene_names})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)

async def api_midi_panic(request):
    """Stop stuck notes across Litwave and every native plugin MIDI channel."""
    active_notes = state.midi.panic()
    state.montage.panic(active_notes)
    return JSONResponse({"success": True, "released_notes": len(active_notes)})


async def api_master_dsp(request):
    """Update persisted master spectrum analyzer and stage warmth controls."""
    try:
        data = await request.json()
        if not isinstance(data, dict):
            return JSONResponse({"error": "Expected JSON object"}, status_code=400)
        if "warmth" in data and isinstance(data["warmth"], dict):
            w = data["warmth"]
            state.montage.configure_warmth(
                enabled=w.get("enabled"),
                drive=w.get("drive"),
                mode=w.get("mode"),
            )
        if "analyzer_enabled" in data:
            state.montage.set_analyzer_enabled(bool(data["analyzer_enabled"]))
        if "analyzer_visible" in data:
            state.set_analyzer_visible(bool(data["analyzer_visible"]))
        # Refresh native status immediately so returned JSON and cached telemetry are up to date
        fresh_status = state.montage.query_native_status()
        return JSONResponse({"success": True, "engine": fresh_status})
    except (TypeError, ValueError) as error:
        return JSONResponse({"error": str(error)}, status_code=400)


async def api_play_voicing(request):
    """Audition a chord voicing directly to MONTAGE M via UDP"""
    try:
        data = await request.json()
        chord_name = data.get("chord", "C")
        notes = data.get("notes", [])
        if not notes:
            return JSONResponse({"success": False, "error": "No notes provided"}, status_code=400)

        # Convert pitch note names (e.g. ['C', 'E', 'G']) to MIDI note numbers
        note_map = {'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3, 'E': 4,
                    'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8, 'Ab': 8, 'A': 9,
                    'A#': 10, 'Bb': 10, 'B': 11}
        root_name = chord_name.split('/')[0].strip()
        root_key = root_name[:2] if len(root_name) > 1 and root_name[1] in ('#', 'b') else root_name[:1]
        root_semi = note_map.get(root_key, 0)
        root_midi = 60 + root_semi  # Center around C4

        intervals = []
        for n in notes:
            n_clean = n.strip()
            semi = note_map.get(n_clean, 0)
            diff = (semi - root_semi) % 12
            intervals.append(diff)

        # Deduplicate preserving order
        unique_intervals = sorted(list(set(intervals)))
        state.ear_training.play_voicing(root_midi, unique_intervals, duration=1.5)
        return JSONResponse({"success": True, "chord": chord_name, "notes": notes})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)


async def api_ear_exercise(request):
    """Generate or retrieve ear training exercise"""
    try:
        body = await request.json() if request.method == "POST" else {}
        action = body.get("action", "generate")
        if action == "replay":
            ok = state.ear_training.replay_current()
            return JSONResponse({"success": ok})
        elif action == "check":
            ans = body.get("answer")
            res = state.ear_training.check_answer(ans)
            return JSONResponse(res)
        else: # generate
            module = body.get("module", "chord_quality")
            ex = state.ear_training.generate_exercise(module)
            return JSONResponse({"success": True, "exercise": ex, "score": state.ear_training.current_score})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)

async def api_playlist(request):
    """List all audio files present in uploads/ library for instant one-click switching"""
    upload_dir = os.path.join(STATIC_DIR, "uploads")
    os.makedirs(upload_dir, exist_ok=True)
    files = []
    for f in os.listdir(upload_dir):
        if f.lower().endswith(('.mp3', '.wav', '.flac', '.ogg', '.m4a')):
            fpath = os.path.join(upload_dir, f)
            files.append({
                "filename": f,
                "size_mb": round(os.path.getsize(fpath) / (1024 * 1024), 2),
                "is_current": (state.audio.song_player.filename == f)
            })
    return JSONResponse({"tracks": sorted(files, key=lambda x: x["filename"])})

async def api_playlist_select(request):
    """Load a song from the library into the active song player"""
    data = await request.json()
    filename = data.get("filename")
    if not filename:
        return JSONResponse({"error": "No filename"}, status_code=400)
    upload_dir = os.path.join(STATIC_DIR, "uploads")
    fpath = os.path.join(upload_dir, filename)
    if not os.path.exists(fpath):
        return JSONResponse({"error": "File not found"}, status_code=404)
    ok = state.audio.song_player.load_file(fpath)
    return JSONResponse({"success": ok, "filename": filename, "song": state.audio.song_player.get_telemetry()})

async def api_analyze_song(request):
    """Trigger deep MIR analysis: BPM, Key, Time Signature, and Chord Progression"""
    try:
        data = {}
        if request.method == "POST":
            try:
                data = await request.json()
            except Exception:
                data = {}
        sp = state.audio.song_player
        raw_name = data.get("filename") or sp.filename
        if not raw_name:
            return JSONResponse({"error": "No active song loaded"}, status_code=400)
        filename = os.path.basename(raw_name)
        if filename != sp.filename:
            return JSONResponse({"error": "Requested song is not active"}, status_code=409)

        upload_dir = os.path.join(STATIC_DIR, "uploads")
        fpath = os.path.join(upload_dir, filename)
        if not os.path.exists(fpath):
            return JSONResponse({"error": "File not found"}, status_code=404)

        # Keep analysis away from the async loop and real-time audio callback.
        res = await run_in_executor(analyze_track, fpath)
        if sp.filename != filename:
            return JSONResponse({"error": "Active song changed during analysis"}, status_code=409)

        lyrics = None
        try:
            duration = sp.total_frames / float(sp.target_samplerate) if sp.target_samplerate > 0 else None
            lyrics_result = fetch_synced_lyrics(filename, duration=duration, audio_path=fpath)
            if lyrics_result and lyrics_result.get("lines"):
                lyrics = lyrics_result["lines"]
        except Exception as error:
            print(f"[Server] Failed to fetch lyrics: {error}")

        if not sp.apply_analysis(filename, res, lyrics):
            if sp.filename != filename:
                return JSONResponse({"error": "Active song changed during analysis"}, status_code=409)
            return JSONResponse({"error": "Failed to save analysis; existing chart preserved"}, status_code=500)
        if res.get("bpm"):
            state.audio.metronome.set_bpm(float(res["bpm"]))

        return JSONResponse({"success": True, "result": res, "song": sp.get_telemetry()})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

routes = [
    Route("/", index),
    Route("/remote", remote_page),
    Route("/api/remote-info", api_remote_info, methods=["GET"]),
    Route("/api/status", api_status, methods=["GET"]),
    Route("/api/transport", api_transport, methods=["POST"]),
    Route("/api/mixer", api_mixer, methods=["POST"]),
    Route("/api/audio/device", api_audio_device, methods=["POST"]),
    Route("/api/midi/device", api_midi_device, methods=["POST"]),
    Route("/api/upload", api_upload_song, methods=["POST"]),
    Route("/api/playlist", api_playlist, methods=["GET"]),
    Route("/api/playlist/select", api_playlist_select, methods=["POST"]),
    Route("/api/analyze", api_analyze_song, methods=["GET", "POST"]),
    Route("/api/montage/editor", api_open_editor, methods=["POST"]),
    Route("/api/montage/voices", api_voices_catalog, methods=["GET"]),
    Route("/api/montage/assign_voice", api_assign_voice, methods=["POST"]),
    Route("/api/montage/volume", api_montage_volume, methods=["POST"]),
    Route("/api/montage/scene", api_montage_scene, methods=["POST"]),
    Route("/api/montage/names", api_custom_names, methods=["GET", "POST"]),
    Route("/api/montage/audition", api_play_voicing, methods=["POST"]),
    Route("/api/midi/panic", api_midi_panic, methods=["POST"]),
    Route("/api/master/dsp", api_master_dsp, methods=["POST"]),
    Route("/api/ear-training", api_ear_exercise, methods=["GET", "POST"]),
    Route("/api/montage/license", api_launch_license_manager, methods=["POST"]),
    WebSocketRoute("/ws", ws_telemetry),
    Mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
]

app = Starlette(routes=routes)
