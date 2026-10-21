"""Where Litwave keeps the user's own data: scenes, custom names, setlists, playlist, FX pad settings, MIDI and DSP settings.

These used to be written next to the source files in src/, which dirtied git and risked committing personal edits.
They now live in a git-ignored ``data/`` folder in the project (override with the ``LITWAVE_DATA_DIR`` environment
variable). The first time a file is asked for, a copy of the matching legacy file in src/ is used as its starting
point; after that the data file is the only one ever read or written, and the legacy file is left alone.
"""

import os
import shutil

SRC_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SRC_DIR)


def data_dir(create: bool = True) -> str:
    """Folder holding the user's data. Created on demand."""
    path = os.environ.get("LITWAVE_DATA_DIR") or os.path.join(REPO_ROOT, "data")
    path = os.path.abspath(path)
    if create:
        os.makedirs(path, exist_ok=True)
    return path


def data_path(name: str) -> str:
    """Full path of a user-data file, seeding it from the legacy copy in src/ the first time only."""
    path = os.path.join(data_dir(), name)
    if not os.path.exists(path):
        legacy = os.path.join(SRC_DIR, name)
        if os.path.isfile(legacy):
            try:
                shutil.copy2(legacy, path)
            except OSError:
                pass  # read-only data folder etc.: callers fall back to defaults when the file is missing
    return path
