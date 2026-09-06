import os
import json
from typing import List, Dict, Any, Optional

class PlaylistManager:
    """
    Manages the DAW Practice Playlist library.
    Every song loaded into the DAW is saved to this persistent playlist.
    Automatically discovers audio files in uploads/ and tracks metadata
    (title, filename, key, bpm, size_mb, last_loaded).
    """
    def __init__(self, data_file: Optional[str] = None, upload_dir: Optional[str] = None):
        base_dir = os.path.dirname(__file__)
        if not data_file:
            data_file = os.path.join(base_dir, "saved_playlist.json")
        if not upload_dir:
            upload_dir = os.path.join(base_dir, "static", "uploads")
        self.data_file = data_file
        self.upload_dir = upload_dir
        self.tracks: List[Dict[str, Any]] = self._load_and_sync()

    def _load_and_sync(self) -> List[Dict[str, Any]]:
        tracks = []
        if os.path.exists(self.data_file):
            try:
                with open(self.data_file, "r", encoding="utf-8") as f:
                    tracks = json.load(f)
            except Exception:
                tracks = []

        # Auto-sync with uploads directory so existing files are always known
        os.makedirs(self.upload_dir, exist_ok=True)
        known_filenames = {t.get("filename") for t in tracks if t.get("filename")}
        modified = False

        try:
            for f in sorted(os.listdir(self.upload_dir)):
                if f.lower().endswith(('.mp3', '.wav', '.flac', '.ogg', '.m4a')):
                    fpath = os.path.join(self.upload_dir, f)
                    size_mb = round(os.path.getsize(fpath) / (1024 * 1024), 2)
                    if f not in known_filenames:
                        title = os.path.splitext(f)[0]
                        tracks.append({
                            "filename": f,
                            "title": title,
                            "key": "--",
                            "bpm": 0,
                            "size_mb": size_mb
                        })
                        known_filenames.add(f)
                        modified = True
                    else:
                        for t in tracks:
                            if t.get("filename") == f and ("size_mb" not in t or t["size_mb"] == 0):
                                t["size_mb"] = size_mb
                                modified = True
        except Exception:
            pass

        if modified or not os.path.exists(self.data_file):
            self._save(tracks)
        return tracks

    def _save(self, tracks: Optional[List[Dict[str, Any]]] = None):
        if tracks is None:
            tracks = self.tracks
        try:
            with open(self.data_file, "w", encoding="utf-8") as f:
                json.dump(tracks, f, indent=2)
        except Exception as e:
            print(f"Failed to save playlist: {e}")

    def record_song(self, filename: str, key: Optional[str] = None, bpm: Optional[float] = None) -> Dict[str, Any]:
        """Save or update a song when it is loaded or analyzed in the DAW"""
        clean_title = os.path.splitext(filename)[0]
        fpath = os.path.join(self.upload_dir, filename)
        size_mb = round(os.path.getsize(fpath) / (1024 * 1024), 2) if os.path.exists(fpath) else 0.0

        for t in self.tracks:
            if t.get("filename") == filename:
                if key and key != "--":
                    t["key"] = key
                if bpm and bpm > 0:
                    t["bpm"] = round(bpm, 1)
                t["size_mb"] = size_mb
                self._save()
                return t

        new_entry = {
            "filename": filename,
            "title": clean_title,
            "key": key or "--",
            "bpm": round(bpm, 1) if bpm else 0,
            "size_mb": size_mb
        }
        self.tracks.append(new_entry)
        self._save()
        return new_entry

    def get_tracks(self, current_filename: Optional[str] = None) -> List[Dict[str, Any]]:
        self._load_and_sync()
        result = []
        for t in self.tracks:
            item = dict(t)
            item["is_current"] = (current_filename is not None and t.get("filename") == current_filename)
            result.append(item)
        return sorted(result, key=lambda x: x.get("title", "").lower())
