"""worldpop_clip — population raster for a corridor → zonal counts per village.

WorldPop publishes ~100m GeoTIFFs per country at
  https://data.worldpop.org/GIS/Population/Global_2000_2020/2020/{ISO3}/...
The file is cached under storage/pop and registered as a `population` dataset;
`proc_population` then does the zonal sum into `village_population`.
Failing here must not fail the corridor — the caller marks it `failed`.
"""

from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Any, Callable

from loguru import logger

from modules.storage import paths

Progress = Callable[[int, str], None] | None
NET_TIMEOUT = 120
USER_AGENT = "Niyanta/1.0 (SIH26161 dam-break modelling)"
# `_fetch` already does 3 Range-resumed in-process attempts; each outer round
# adds 3 more against a fresh connection (flaky links stall for minutes at a
# time, and a 1.8 GB file must finish across many such stalls).
RESUME_ROUNDS = 6

# Single flight per process: prepare, the Downloads button and a second corridor
# of the same country must never append to the same .part — two writers corrupt
# it, which is what used to rewind the bar to 1/1844 MB mid-download.
_FETCH_LOCK = threading.Lock()

# approximate country for a bbox — enough to pick the right WorldPop file
_BBOX_COUNTRY = [
    ((68.0, 8.0, 97.5, 37.5), ("IND", "ind")),
    ((60.8, 23.5, 77.5, 37.5), ("PAK", "pak")),
    ((73.5, 23.8, 97.5, 29.7), ("NPL", "npl")),
    ((88.0, 26.0, 92.8, 28.3), ("BTN", "btn")),
    ((60.0, 24.0, 105.0, 54.0), ("CHN", "chn")),
]


def _names(iso3: str) -> tuple[str, str]:
    """(100 m country file, 1 km aggregate) — same WorldPop 2020 ppp product.

    The 100 m India file is 1.8 GB and data.worldpop.org ignores HTTP Range, so
    a dropped link restarts it from zero; the 1 km aggregate is ~19 MB. We fetch
    the aggregate and use the 100 m file only when someone already has it.
    """
    iso = iso3.lower()
    return f"{iso}_ppp_2020.tif", f"{iso}_ppp_2020_1km_Aggregated.tif"


def local_path(bbox: tuple[float, float, float, float] | None) -> Path | None:
    """The best WorldPop raster on disk for this bbox (100 m, else 1 km)."""
    if not bbox:
        return None
    iso3, _ = _country(bbox)
    for name in _names(iso3):
        p = paths.POP / name
        if p.exists() and p.stat().st_size > 100_000:
            return p
    return None


def cached(bbox: tuple[float, float, float, float] | None) -> bool:
    """True when a WorldPop raster for this bbox's country is already on disk."""
    return local_path(bbox) is not None


def fetch(river_id: str, bbox: tuple[float, float, float, float] | None,
          progress: Progress = None,
          cancel: Callable[[], None] | None = None) -> dict[str, Any]:
    if not bbox:
        raise ValueError("no bbox for WorldPop clip")
    iso3, _ = _country(bbox)
    existing = local_path(bbox)
    if existing:
        if progress:
            progress(100, f"population: cached {iso3}")
        return {"path": existing, "cached": True}

    # WorldPop directories are uppercase ISO3, file names lowercase
    name = _names(iso3)[1]
    url = (
        "https://data.worldpop.org/GIS/Population/Global_2000_2020_1km/2020/"
        f"{iso3}/{name}"
    )
    paths.POP.mkdir(parents=True, exist_ok=True)
    dest = paths.POP / name

    # Wait our turn without holding the worker blind: poll so the cancel check
    # still stops this job while it queues behind an active download.
    while not _FETCH_LOCK.acquire(timeout=2.0):
        if cancel:
            cancel()
        if progress:
            progress(0, "population: waiting for an active download")
    try:
        # Re-check under the lock: whoever held it may have finished the file.
        if dest.exists() and dest.stat().st_size > 100_000:
            if progress:
                progress(100, f"population: cached {iso3}")
            return {"path": dest, "cached": True}

        if progress:
            progress(0, f"population: downloading {iso3}")
        from modules.proc_dem.copernicus import _fetch  # noqa: PLC0415 - reuse resume helper

        last = {"pct": -1, "mb": -1}

        def byte_progress(done: int, total: int) -> None:
            # Raw download percent: the caller shows this directly as the job bar
            # and the dataset row, so 40 MB of 1844 MB must read ~2%, not ~14%.
            pct = int(100 * min(done / max(total, 1), 1.0))
            mb = done // 10_000_000
            # A whole percent of this file is ~18 MB, so on a slow link the bar and
            # the MB counter would both sit still for minutes; tick every 10 MB.
            if pct == last["pct"] and mb == last["mb"]:
                return
            last["pct"] = pct
            last["mb"] = mb
            if progress:
                progress(pct, f"population: {done // 1_000_000}/{max(total, 1) // 1_000_000} MB")

        _resume_fetch(url, dest, byte_progress if progress else None, cancel,
                      announce=progress)
    finally:
        _FETCH_LOCK.release()
    if progress:
        progress(100, "population: registering dataset")
    _register(dest, bbox, iso3)
    if progress:
        progress(100, "population: ready")
    return {"path": dest, "cached": False}


def _resume_fetch(url: str, dest, progress, cancel,
                  announce: Progress = None) -> None:
    """Drive `_fetch` to completion across rounds of stalls.

    Each round resumes from whatever `.part` the previous one left, so a link
    that dies at 770/1844 MB continues there next round instead of restarting.
    Giving up with the `.part` intact means the next job picks up mid-file.
    """
    from modules.jobs.queue import JobCancelled, JobPaused  # noqa: PLC0415
    from modules.proc_dem.copernicus import CopernicusError, _fetch  # noqa: PLC0415

    part = dest.with_suffix(dest.suffix + ".part")
    last: Exception | None = None
    for round_no in range(1, RESUME_ROUNDS + 1):
        try:
            _fetch(url, dest, attempts=3, progress=progress, cancel=cancel,
                   keep_partial_on_no_range=True)
            return
        except (JobCancelled, JobPaused):
            raise  # pause/cancel must stop the rounds, not be retried
        except Exception as exc:  # noqa: BLE001 - network boundary
            last = exc
            have = part.stat().st_size if part.exists() else 0
            if have == 0:
                break  # nothing to resume and 3 in-process attempts failed
            if announce:
                announce(0, f"population: resuming {have // 1_000_000} MB "
                            f"(round {round_no}/{RESUME_ROUNDS})")
            logger.warning("worldpop round {}/{} stopped at {} MB: {}",
                           round_no, RESUME_ROUNDS, have // 1_000_000, exc)
            # sleep in cancel-aware slices so a pause isn't delayed minutes
            for _ in range(5):
                if cancel:
                    cancel()
                time.sleep(2.0)
    raise CopernicusError(f"download {url} failed after "
                          f"{RESUME_ROUNDS} resume rounds: {last}") from last


def _country(bbox: tuple[float, float, float, float]) -> tuple[str, str]:
    w, s, e, n = bbox
    cx, cy = (w + e) / 2, (s + n) / 2
    for (bw, bs, be, bn), iso in _BBOX_COUNTRY:
        if bw <= cx <= be and bs <= cy <= bn:
            return iso
    return "IND", "ind"


def _register(dest, bbox: tuple[float, float, float, float], iso3: str) -> None:
    from modules.catalog import catalog  # noqa: PLC0415
    from modules.db import client as db  # noqa: PLC0415
    from modules.storage import paths as _paths  # noqa: PLC0415

    rel = _paths.rel(dest)
    if db.query_one("SELECT id FROM dataset WHERE path = %s AND deleted_at IS NULL", (rel,)):
        return
    ds = catalog.dataset_create(
        "population",
        f"WorldPop {iso3} 2020" + (" (1 km)" if "1km" in dest.name else ""),
        path=rel,
        meta={"source": "worldpop", "iso3": iso3, "bbox": list(bbox), "auto": True},
    )
    catalog.dataset_set_status(str(ds["id"]), "ready")
