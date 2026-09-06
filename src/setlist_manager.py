import os
import json
from typing import List, Dict, Any, Optional

class SetlistManager:
    """
    Manages Setlists and Patch Snapshots for live performance & practice.
    Each song in a setlist saves:
      - song_id / file_path
      - title, artist, key, tempo
      - 8-part VST sound preset (voices, volumes, reverbs, pans, mutes) for Yamaha or Community VST
      - ambient drone pad root key
    """
    def __init__(self, data_file: Optional[str] = None):
        if not data_file:
            data_file = os.path.join(os.path.dirname(__file__), "saved_setlists.json")
        self.data_file = data_file
        self.setlists: List[Dict[str, Any]] = self._load()

    def _load(self) -> List[Dict[str, Any]]:
        if os.path.exists(self.data_file):
            try:
                with open(self.data_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        # Default starter setlist
        return [
            {
                "id": "sunday_morning",
                "name": "Sunday Morning Service",
                "songs": []
            }
        ]

    def _save(self):
        try:
            with open(self.data_file, "w", encoding="utf-8") as f:
                json.dump(self.setlists, f, indent=2)
        except Exception as e:
            print(f"Failed to save setlists: {e}")

    def get_setlists(self) -> List[Dict[str, Any]]:
        return self.setlists

    def get_setlist(self, setlist_id: str) -> Optional[Dict[str, Any]]:
        for s in self.setlists:
            if s.get("id") == setlist_id:
                return s
        return None

    def create_setlist(self, name: str) -> Dict[str, Any]:
        new_id = f"setlist_{len(self.setlists) + 1}"
        item = {
            "id": new_id,
            "name": name,
            "songs": []
        }
        self.setlists.append(item)
        self._save()
        return item

    def delete_setlist(self, setlist_id: str) -> bool:
        initial_len = len(self.setlists)
        self.setlists = [s for s in self.setlists if s.get("id") != setlist_id]
        if len(self.setlists) < initial_len:
            if not self.setlists:
                self.create_setlist("Main Setlist")
            self._save()
            return True
        return False

    def move_song(self, setlist_id: str, song_id: str, direction: str) -> bool:
        # ponytail: simple index swap; add drag-and-drop ordering when requested
        s = self.get_setlist(setlist_id)
        if not s:
            return False
        songs = s.get("songs", [])
        idx = next((i for i, item in enumerate(songs) if item.get("id") == song_id), -1)
        if idx == -1:
            return False
        target = idx - 1 if direction == "up" else idx + 1
        if 0 <= target < len(songs):
            songs[idx], songs[target] = songs[target], songs[idx]
            self._save()
            return True
        return False

    def add_song_to_setlist(self, setlist_id: str, song_data: Dict[str, Any]) -> bool:
        s = self.get_setlist(setlist_id)
        if not s:
            return False
        # song_data must contain title, file_path/url, key, tempo, patch_snapshot
        if "id" not in song_data:
            song_data["id"] = f"song_{len(s.get('songs', [])) + 1}"
        s.setdefault("songs", []).append(song_data)
        self._save()
        return True

    def remove_song_from_setlist(self, setlist_id: str, song_id: str) -> bool:
        s = self.get_setlist(setlist_id)
        if not s:
            return False
        songs = s.get("songs", [])
        s["songs"] = [item for item in songs if item.get("id") != song_id]
        self._save()
        return True

    def update_song_patch(self, setlist_id: str, song_id: str, patch_snapshot: Dict[str, Any]) -> bool:
        s = self.get_setlist(setlist_id)
        if not s:
            return False
        for song in s.get("songs", []):
            if song.get("id") == song_id:
                song["patch_snapshot"] = patch_snapshot
                self._save()
                return True
        return False
