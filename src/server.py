"""
HTTP & WebSocket Server for Montage Practice DAW
Connects the backend audio/MIDI engine to the Impeccable studio frontend
"""

import os
import json
import asyncio
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
from src.lyrics import fetch_synced_lyrics, merge_chords_with_lyrics

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
        
        # Start audio with default ASIO or system device
        self.audio.start_stream()
        
        # Open first MIDI port if any available
        ports = self.midi.get_available_ports()
        if ports:
            self.midi.open_port(0)

    def _on_midi_event(self, event_dict):
        if self._loop and self.ws_clients:
            msg = json.dumps({"type": "midi_event", "data": event_dict})
            asyncio.run_coroutine_threadsafe(self.broadcast(msg), self._loop)

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
        "devices": {
            "audio_outputs": state.audio.get_output_devices(),
            "midi_inputs": state.midi.get_available_ports()
        }
    }
    return JSONResponse(telemetry)

async def api_transport(request):
    body = await request.json()
    action = body.get("action")
    sp = state.audio.song_player
    
    if action == "play":
        sp.play()
    elif action == "pause":
        sp.pause()
    elif action == "stop":
        sp.stop()
    elif action == "toggle":
        sp.toggle_play()
    elif action == "seek":
        sec = float(body.get("seconds", 0.0))
        sp.seek_seconds(sec)
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
        sp.add_marker(name, sec)
    elif action == "remove_marker":
        m_id = int(body.get("id", 0))
        sp.remove_marker(m_id)
    elif action == "update_marker":
        m_id = int(body.get("id", 0))
        new_time = float(body.get("time", 0.0))
        sp.update_marker_time(m_id, new_time)
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
        state.audio.master_volume = float(body["master_volume"])
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

async def ws_telemetry(websocket: WebSocket):
    await websocket.accept()
    state.ws_clients.append(websocket)
    state._loop = asyncio.get_event_loop()
    try:
        while True:
            telemetry = {
                "type": "telemetry",
                "audio": state.audio.get_telemetry(),
                "song": state.audio.song_player.get_telemetry(),
                "midi": state.midi.get_snapshot(),
                "montage": {
                    "master_volume": state.montage.master_vst_volume,
                    "part_volumes": state.montage.part_volumes,
                    "part_reverbs": state.montage.part_reverbs,
                    "part_mutes": state.montage.part_mutes,
                    "part_solos": state.montage.part_solos,
                    "current_scene": state.montage.current_scene
                }
            }
            await websocket.send_text(json.dumps(telemetry))
            await asyncio.sleep(0.04) # 25fps refresh
    except (WebSocketDisconnect, asyncio.CancelledError, RuntimeError):
        pass
    finally:
        if websocket in state.ws_clients:
            state.ws_clients.remove(websocket)

async def api_open_editor(request):
    ok = state.montage.open_vst_editor()
    return JSONResponse({"success": ok})

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
        filename = data.get("filename") or state.audio.song_player.filename
        if not filename:
            return JSONResponse({"error": "No active song loaded"}, status_code=400)
            
        upload_dir = os.path.join(STATIC_DIR, "uploads")
        fpath = os.path.join(upload_dir, filename)
        if not os.path.exists(fpath):
            return JSONResponse({"error": "File not found"}, status_code=404)

        # Run analysis (optimized 22kHz CQT + BTC Transformer)
        res = analyze_track(fpath)
        if "error" not in res:
            # Auto-populate song player chord progression & analysis data
            sp = state.audio.song_player
            sp.analysis_data = {
                "bpm": res["bpm"],
                "key_full": res["key"],
                "key_root": res["key"].replace("m", ""),
                "is_major": not res["key"].endswith("m"),
                "time_signature": 4,
                "first_downbeat_seconds": res.get("first_downbeat_seconds", 0.0)
            }
            # Auto-fill chord progression with BTC clean progression
            sp.chord_chart = res["chords"]
            
            # Fetch synced lyrics from LRCLIB and build musician chord sheet
            try:
                dur = sp.total_frames / float(sp.target_samplerate) if sp.target_samplerate > 0 else None
                lyrics_res = fetch_synced_lyrics(filename, duration=dur)
                if lyrics_res and lyrics_res.get("lines"):
                    merged_sheet = merge_chords_with_lyrics(lyrics_res["lines"], sp.chord_chart)
                    sp.lyrics_sheet = merged_sheet
            except Exception as le:
                print(f"[Server] Failed to fetch lyrics: {le}")
                
            sp._persist_chart()
            
            # Auto-sync metronome BPM & phase to song
            if res.get("bpm"):
                state.audio.metronome.set_bpm(float(res["bpm"]))
            if res.get("time_sig"):
                state.audio.metronome.set_time_sig(4)

        return JSONResponse({"success": True, "result": res, "song": state.audio.song_player.get_telemetry()})
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
    Route("/api/montage/volume", api_montage_volume, methods=["POST"]),
    Route("/api/montage/scene", api_montage_scene, methods=["POST"]),
    Route("/api/ear-training", api_ear_exercise, methods=["GET", "POST"]),
    Route("/api/montage/license", api_launch_license_manager, methods=["POST"]),
    WebSocketRoute("/ws", ws_telemetry),
    Mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
]

app = Starlette(routes=routes)
