"""
Playlist and song library API handlers and route factory.
Extracted from src/server.py for modularity and isolation.
Preserves route paths, HTTP methods, request/response JSON shapes, status codes,
upload behavior, and playlist tracking without circular imports or side-effects.
"""

import os
from typing import Optional
from starlette.responses import JSONResponse


def create_playlist_handlers(app_state, upload_dir: Optional[str] = None):
    """
    Factory creating playlist and song handling endpoints with injected app state and upload directory.
    Avoids circular imports and allows isolated regression testing with mock state and custom dirs.
    """
    if upload_dir is None:
        upload_dir = os.path.join(os.path.dirname(__file__), "static", "uploads")

    async def handle_playlist(request):
        """List all audio files saved in the DAW playlist for instant switching and setlist queuing"""
        current_fn = getattr(app_state.audio.song_player, "filename", None) if getattr(app_state, "audio", None) else None
        tracks = app_state.playlist.get_tracks(current_filename=current_fn)
        return JSONResponse({"tracks": tracks})

    async def handle_playlist_select(request):
        """Load a song from the library into the active song player and record in playlist"""
        data = await request.json()
        filename = data.get("filename")
        if not filename:
            return JSONResponse({"error": "No filename"}, status_code=400)
        # Prevent directory traversal attacks
        safe_filename = os.path.basename(filename)
        fpath = os.path.join(upload_dir, safe_filename)
        if not os.path.exists(fpath):
            return JSONResponse({"error": "File not found"}, status_code=404)
        ok = app_state.audio.song_player.load_file(fpath)
        if ok:
            app_state.playlist.record_song(safe_filename)
        return JSONResponse({
            "success": ok,
            "filename": safe_filename,
            "song": app_state.audio.song_player.get_telemetry()
        })

    async def handle_upload_song(request):
        """Handle song file upload, persist to uploads directory, load into player, and record in playlist"""
        form = await request.form()
        file = form.get("file")
        if not file:
            return JSONResponse({"error": "No file uploaded"}, status_code=400)

        safe_filename = os.path.basename(file.filename)
        dest_path = os.path.join(upload_dir, safe_filename)
        os.makedirs(os.path.dirname(dest_path), exist_ok=True)

        contents = await file.read()
        with open(dest_path, "wb") as f:
            f.write(contents)

        ok = app_state.audio.song_player.load_file(dest_path)
        if ok:
            app_state.playlist.record_song(safe_filename)
        return JSONResponse({
            "success": ok,
            "filename": safe_filename,
            "song": app_state.audio.song_player.get_telemetry()
        })

    return handle_playlist, handle_playlist_select, handle_upload_song
