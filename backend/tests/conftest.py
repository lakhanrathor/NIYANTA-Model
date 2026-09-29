from __future__ import annotations

import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

# Tests get their own database file so the suite never leaves runs/scenarios/
# alerts in the demo DB that the running UI reads.
os.environ.setdefault("NIYANTA_DB", str(BACKEND / "data" / "niyanta_test.sqlite"))

# Hermetic suite: no network terrain/imagery during tests. The auto paths are
# covered by test_copernicus.py, which re-enables them against a cached tile.
from config import settings  # noqa: E402

settings.auto_dem = False
settings.auto_imagery = False


import pytest  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _tidy_run_scratch():
    """Tests write multi-GB solver scratch under storage/runs.

    Keep the shared tree (test_seg_sam reads the GEE cache there) but drop the
    run directories this session created so the demo storage stays clean.
    """
    from modules.storage import paths

    runs = paths.RUNS
    before = {p.name for p in runs.glob("*") if p.is_dir()}
    yield
    import shutil

    for p in runs.glob("*"):
        if p.is_dir() and p.name not in before:
            shutil.rmtree(p, ignore_errors=True)
