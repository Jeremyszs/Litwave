"""
Regression checks for where Litwave keeps the user's own data (scenes, names, setlists, playlist, FX pads, MIDI, DSP):
- src/user_data.py resolves a git-ignored data/ folder (or LITWAVE_DATA_DIR), seeds it from the legacy files in src/
  exactly once, and never overwrites what is already there
- every module that persists user data uses it, so runtime edits can no longer dirty tracked files in src/
"""

import os
import re
import sys
import json
import shutil
import tempfile

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, REPO_ROOT)

TMP = tempfile.mkdtemp(prefix="litwave-data-")
os.environ["LITWAVE_DATA_DIR"] = os.path.join(TMP, "data")  # must be set before the modules below are imported

from src import user_data  # noqa: E402

SRC_DIR = os.path.join(REPO_ROOT, "src")
PERSISTING_MODULES = {
    "fx_sampler.py": "fx_pads_settings.json",
    "midi_manager.py": "midi_settings.json",
    "montage_host.py": ["scene_presets.json", "custom_names.json", "master_dsp_settings.json"],
    "playlist_manager.py": "saved_playlist.json",
    "setlist_manager.py": "saved_setlists.json",
}


def test_data_dir_follows_env_and_is_created():
    d = user_data.data_dir()
    assert d == os.path.join(TMP, "data"), d
    assert os.path.isdir(d)


def test_default_dir_is_a_gitignored_data_folder():
    saved = os.environ.pop("LITWAVE_DATA_DIR")
    try:
        d = user_data.data_dir(create=False)
        assert d == os.path.join(REPO_ROOT, "data"), d
    finally:
        os.environ["LITWAVE_DATA_DIR"] = saved
    with open(os.path.join(REPO_ROOT, ".gitignore"), encoding="utf-8") as f:
        lines = [ln.strip() for ln in f]
    assert "data/" in lines, "data/ must be git-ignored"


def test_seeds_from_legacy_file_once_and_never_overwrites():
    legacy = os.path.join(SRC_DIR, "_user_data_probe.json")
    with open(legacy, "w", encoding="utf-8") as f:
        json.dump({"from": "legacy"}, f)
    try:
        path = user_data.data_path("_user_data_probe.json")
        assert path == os.path.join(user_data.data_dir(), "_user_data_probe.json")
        with open(path, encoding="utf-8") as f:
            assert json.load(f) == {"from": "legacy"}, "first run should copy the legacy file"
        with open(path, "w", encoding="utf-8") as f:
            json.dump({"from": "user edit"}, f)
        again = user_data.data_path("_user_data_probe.json")
        with open(again, encoding="utf-8") as f:
            assert json.load(f) == {"from": "user edit"}, "an existing data file must never be overwritten"
        with open(legacy, "r", encoding="utf-8") as f:
            assert json.load(f) == {"from": "legacy"}, "the legacy file stays untouched"
    finally:
        os.remove(legacy)


def test_missing_legacy_file_just_returns_the_path():
    p = user_data.data_path("does_not_exist_anywhere.json")
    assert p.startswith(user_data.data_dir()) and not os.path.exists(p)


def test_persisting_modules_use_the_data_folder_not_src():
    for module, names in PERSISTING_MODULES.items():
        names = [names] if isinstance(names, str) else names
        with open(os.path.join(SRC_DIR, module), encoding="utf-8") as f:
            text = f.read()
        assert "user_data" in text, f"{module} must resolve its files through user_data"
        for name in names:
            bad = re.search(r"os\.path\.join\(\s*(os\.path\.dirname\(__file__\)|base_dir)\s*,\s*[\"']" + re.escape(name), text)
            assert not bad, f"{module} still builds {name} next to the source"


def test_managers_default_to_the_data_folder():
    from src.setlist_manager import SetlistManager
    from src.playlist_manager import PlaylistManager
    from src import fx_sampler
    sm = SetlistManager()
    assert os.path.dirname(os.path.abspath(sm.data_file)) == os.path.abspath(user_data.data_dir()), sm.data_file
    pm = PlaylistManager()
    assert os.path.dirname(os.path.abspath(pm.data_file)) == os.path.abspath(user_data.data_dir()), pm.data_file
    assert os.path.dirname(os.path.abspath(fx_sampler.SETTINGS_FILE)) == os.path.abspath(user_data.data_dir())


def test_source_json_files_are_not_touched_by_running_the_managers():
    tracked = {n: os.path.getmtime(os.path.join(SRC_DIR, n)) for n in os.listdir(SRC_DIR) if n.endswith(".json") and os.path.isfile(os.path.join(SRC_DIR, n))}
    from src.setlist_manager import SetlistManager
    sm = SetlistManager()
    sm.create_setlist("Probe")
    for n, t in tracked.items():
        assert os.path.getmtime(os.path.join(SRC_DIR, n)) == t, f"src/{n} was modified"
    assert not os.path.exists(os.path.join(SRC_DIR, "saved_setlists.json"))


if __name__ == "__main__":
    try:
        test_data_dir_follows_env_and_is_created()
        test_default_dir_is_a_gitignored_data_folder()
        test_seeds_from_legacy_file_once_and_never_overwrites()
        test_missing_legacy_file_just_returns_the_path()
        test_persisting_modules_use_the_data_folder_not_src()
        test_managers_default_to_the_data_folder()
        test_source_json_files_are_not_touched_by_running_the_managers()
        print("ALL USER DATA FOLDER CHECKS PASSED")
    finally:
        shutil.rmtree(TMP, ignore_errors=True)
