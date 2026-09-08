"""
Song Analysis and Synced Lyrics API handler.
Extracted from src/server.py for modularity and isolation.
Preserves route path, HTTP methods, request/response JSON shapes, status codes,
lazy MIR analyzer loading, background executor execution, and synced lyrics retrieval.
"""

import os
from typing import Optional, Callable
from starlette.responses import JSONResponse


def _default_get_analyzer_track():
    from src.analyzer import analyze_track
    return analyze_track


def _default_run_in_executor(func, *args):
    from src.async_worker import run_in_executor
    return run_in_executor(func, *args)


def _default_fetch_synced_lyrics(filename, duration=None, audio_path=None):
    from src.lyrics import fetch_synced_lyrics
    return fetch_synced_lyrics(filename, duration=duration, audio_path=audio_path)


def create_analysis_handler(
    app_state,
    upload_dir: Optional[str] = None,
    get_analyzer_fn: Optional[Callable] = None,
    run_executor_fn: Optional[Callable] = None,
    fetch_lyrics_fn: Optional[Callable] = None
):
    """
    Factory creating the api_analyze_song handler with injected dependencies.
    Keeps heavy analyzer imports lazy and allows isolated testing with mocks.
    """
    if upload_dir is None:
        upload_dir = os.path.join(os.path.dirname(__file__), "static", "uploads")
    if get_analyzer_fn is None:
        get_analyzer_fn = _default_get_analyzer_track
    if run_executor_fn is None:
        run_executor_fn = _default_run_in_executor
    if fetch_lyrics_fn is None:
        fetch_lyrics_fn = _default_fetch_synced_lyrics

    async def handle_analyze_song(request):
        """Trigger deep MIR analysis: BPM, Key, Time Signature, and Chord Progression"""
        try:
            data = {}
            if request.method == "POST":
                try:
                    data = await request.json()
                except Exception:
                    data = {}
            sp = app_state.audio.song_player
            raw_name = data.get("filename") or sp.filename
            if not raw_name:
                return JSONResponse({"error": "No active song loaded"}, status_code=400)
            filename = os.path.basename(raw_name)
            if filename != sp.filename:
                return JSONResponse({"error": "Requested song is not active"}, status_code=409)

            fpath = os.path.join(upload_dir, filename)
            if not os.path.exists(fpath):
                return JSONResponse({"error": "File not found"}, status_code=404)

            # Keep analysis away from the async loop and real-time audio callback.
            analyze_fn = get_analyzer_fn()
            res = await run_executor_fn(analyze_fn, fpath)
            if sp.filename != filename:
                return JSONResponse({"error": "Active song changed during analysis"}, status_code=409)

            lyrics = None
            try:
                duration = sp.total_frames / float(sp.target_samplerate) if sp.target_samplerate > 0 else None
                lyrics_result = fetch_lyrics_fn(filename, duration=duration, audio_path=fpath)
                if lyrics_result and lyrics_result.get("lines"):
                    lyrics = lyrics_result["lines"]
            except Exception as error:
                print(f"[Server] Failed to fetch lyrics: {error}")

            if not sp.apply_analysis(filename, res, lyrics):
                if sp.filename != filename:
                    return JSONResponse({"error": "Active song changed during analysis"}, status_code=409)
                return JSONResponse({"error": "Failed to save analysis; existing chart preserved"}, status_code=500)
            if res.get("bpm"):
                app_state.audio.metronome.set_bpm(float(res["bpm"]))

            # Record detected key/BPM to playlist library
            app_state.playlist.record_song(raw_name, key=res.get("key"), bpm=res.get("bpm"))

            return JSONResponse({"success": True, "result": res, "song": sp.get_telemetry()})
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)

    return handle_analyze_song
