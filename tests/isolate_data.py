"""Import this first in any test that imports src.*: it points LITWAVE_DATA_DIR at a throwaway folder so tests can
never read or write the user's real data (src.server builds its managers at import time)."""

import atexit
import os
import shutil
import tempfile

if "LITWAVE_DATA_DIR" not in os.environ:
    _dir = tempfile.mkdtemp(prefix="litwave-test-data-")
    os.environ["LITWAVE_DATA_DIR"] = _dir
    atexit.register(shutil.rmtree, _dir, ignore_errors=True)
