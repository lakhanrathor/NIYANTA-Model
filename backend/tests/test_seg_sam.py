"""SAM refinement: GPU segmentation over the daily S2 quicklook crop."""

from __future__ import annotations

from pathlib import Path

import pytest

from config import settings
from modules.db import client as db
from modules.db import seed
from modules.storage import paths


@pytest.fixture(scope="module", autouse=True)
def boot():
    seed.seed()
    db.ensure_pool()
    yield


def _quicklook() -> Path | None:
    boxes = sorted((paths.ROOT / "gee").glob("*/ *_s2.tif".replace(" ", "")))
    today = boxes[-1] if boxes else None
    if today and today.name.startswith(str(_today())):
        return today
    # fetch today's crop live when none exists yet
    if settings.gee_mode != "online":
        return None
    from modules.gee import client as gee_client, live

    if not gee_client.ready():
        return None
    box = db.query_one("SELECT * FROM watch_box ORDER BY created LIMIT 1")
    out = live.s2_water(box)
    return paths.ROOT / out["path"] if out.get("path") else None


def _today():
    from datetime import date

    return date.today().isoformat()


def test_sam_refine_water_on_quicklook():
    import torch

    if not torch.cuda.is_available():
        pytest.skip("cuda unavailable")
    from modules.gee.handlers import _sam_refine

    tif = _quicklook()
    if tif is None or not tif.exists():
        pytest.skip("no quicklook crop and ee offline")
    out = _sam_refine(str(tif), "s2_indices")
    assert out is not None
    assert out["model"] == "vit_h"
    assert out["device"] == "cuda"
    assert out["points"] > 0
    assert out["area_px"] > 0
    assert 0.0 <= out["iou_with_seeds"] <= 1.0
    assert out["ms"] > 0


def test_best_model_is_vit_h():
    from modules.seg import sam

    assert sam.BEST_MODEL == "vit_h"
    assert "vit_h" in sam.CHECKPOINTS and Path(sam.CHECKPOINTS["vit_h"]).exists()
