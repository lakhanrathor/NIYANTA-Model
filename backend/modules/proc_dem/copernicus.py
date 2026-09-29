"""Auto DEM for any AOI — Copernicus DEM-30m tiles from the public S3 bucket.

Tile math and atomic-download discipline ported from
`damatlas/api/routes/copernicus.py` + `damatlas/pipeline/jobs/queue.py`
(`_run_batch_download`), scoped to what stage.terrain needs: make sure every
1° tile intersecting the AOI is cached under storage/dem, mosaic >1 tile, and
hand back a local GeoTIFF. Falls back to the synthetic valley at the caller
when this raises (offline, oversized AOI, bad bbox).
"""

from __future__ import annotations

import hashlib
import math
import urllib.request
from pathlib import Path
from typing import Any, Callable

from modules.storage import paths

BUCKET = "https://copernicus-dem-30m.s3.amazonaws.com"
MAX_TILES = 16
MIN_VALID_FILE = 1000
CHUNK = 1 << 20
Progress = Callable[[int, str], None] | None


class CopernicusError(RuntimeError):
    pass


def tile_names(bbox: tuple[float, float, float, float], cap: int | None = MAX_TILES) -> list[str]:
    """Copernicus 1° tile names intersecting [west, south, east, north].

    `cap` guards the pipeline against an AOI that would take gigabytes to
    fetch; callers that are deliberately downloading on the user's behalf pass
    `cap=None` to get the full list.
    """
    west, south, east, north = (float(v) for v in bbox)
    if not (-180.0 <= west < east <= 180.0 and -90.0 <= south < north <= 90.0):
        raise CopernicusError(f"invalid bbox {list(bbox)}")
    names: list[str] = []
    # exact integer edges (east=78.0) must not pull in the tile fully outside
    for lat in range(math.floor(south), math.floor(north - 1e-9) + 1):
        for lon in range(math.floor(west), math.floor(east - 1e-9) + 1):
            ns = f"N{lat:02d}" if lat >= 0 else f"S{abs(lat):02d}"
            ew = f"E{lon:03d}" if lon >= 0 else f"W{abs(lon):03d}"
            names.append(f"Copernicus_DSM_COG_10_{ns}_00_{ew}_00_DEM")
    if cap is not None and len(names) > cap:
        raise CopernicusError(f"AOI needs {len(names)} tiles (cap {cap})")
    return names


def ensure_dem(bbox: tuple[float, float, float, float], progress: Progress = None,
               cancel: Callable[[], None] | None = None) -> Path:
    """Cached tile download for the AOI; mosaics >1 tile. Raises CopernicusError."""
    names = tile_names(bbox)
    paths.DEM.mkdir(parents=True, exist_ok=True)
    files: list[Path] = []
    for i, name in enumerate(names):
        dest = paths.DEM / f"{name}.tif"
        if dest.exists() and dest.stat().st_size > MIN_VALID_FILE:
            files.append(dest)
            if progress:
                progress(6 + 4 * i // max(len(names), 1), f"terrain: cached {name}")
            continue
        if progress:
            progress(6 + 6 * i // max(len(names), 1),
                     f"terrain: downloading Copernicus {i + 1}/{len(names)}")
        _fetch(f"{BUCKET}/{name}/{name}.tif", dest, cancel=cancel)
        files.append(dest)
    if len(files) == 1:
        return files[0]
    return _mosaic(files, bbox)


def _fetch(url: str, dest: Path, attempts: int = 3,
           progress: Callable[[int, int], None] | None = None,
           cancel: Callable[[], None] | None = None,
           keep_partial_on_no_range: bool = False) -> None:
    """Stream to .part then rename — a killed transfer never lands as a real tile.

    Retries with HTTP Range resume from the .part so a mid-stream timeout on a
    slow link only re-fetches the missing tail, not the whole ~40 MB tile.
    `cancel` is polled per chunk: a pause/cancel raises out of the byte loop
    and keeps the .part, so resuming continues exactly this byte range.
    `keep_partial_on_no_range` turns a Range-refused resume into a retryable
    error that keeps the .part instead of discarding it — a multi-GB file
    must never lose 700 MB because one CDN node answered 200.
    """
    from modules.jobs.queue import JobCancelled, JobPaused  # noqa: PLC0415

    part = dest.with_suffix(dest.suffix + ".part")
    last: Exception | None = None
    for attempt in range(attempts):
        offset = part.stat().st_size if part.exists() else 0
        headers = {"User-Agent": "Niyanta/1.0"}
        if offset:
            headers["Range"] = f"bytes={offset}-"
        expected: int | None = None
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=180) as resp:
                status = getattr(resp, "status", 200)
                if status == 200 and offset:
                    if keep_partial_on_no_range:
                        # Range refused on a big file: retry — another attempt
                        # may hit a node that honours it — without losing bytes.
                        raise CopernicusError(
                            f"server ignored Range resume at {offset} bytes")
                    # server ignored Range → restart from scratch
                    part.unlink(missing_ok=True)
                    offset = 0
                content_len = resp.headers.get("Content-Length")
                if status == 206:
                    total = (resp.headers.get("Content-Range") or "").split("/")[-1]
                    expected = int(total) if total.isdigit() else None
                elif content_len and content_len.isdigit():
                    expected = int(content_len)
                with open(part, "ab" if offset else "wb") as out:
                    written = offset
                    while True:
                        chunk = resp.read(CHUNK)
                        if not chunk:
                            break
                        out.write(chunk)
                        written += len(chunk)
                        if progress and expected:
                            progress(written, expected)
                        if cancel:
                            cancel()
            if expected is not None and part.stat().st_size < expected:
                raise CopernicusError(
                    f"short read {part.stat().st_size}/{expected} bytes")
            if part.stat().st_size < MIN_VALID_FILE:
                raise CopernicusError("downloaded file too small")
            part.replace(dest)
            return
        except (JobCancelled, JobPaused):
            raise  # not a network failure: keep the .part, stop the worker
        except Exception as exc:  # noqa: BLE001 - network boundary: retry, keep .part
            last = exc
            if getattr(exc, "code", None) == 416 and part.exists():
                # stale/oversized range → the server can't resume this .part;
                # discard it and the next attempt restarts from zero.
                part.unlink(missing_ok=True)
            if attempt == attempts - 1:
                break
    # Keep the .part on final failure: a multi-GB population file must resume
    # on the next run, not restart from zero (only 416 discards it above).
    raise CopernicusError(f"download {url} failed: {last}") from last


def _mosaic(files: list[Path], bbox: tuple[float, float, float, float]) -> Path:
    """Union of the AOI's tiles → one GeoTIFF (clipping happens in mod_detect.read)."""
    import rasterio
    from rasterio.merge import merge

    key = hashlib.sha256(str([round(float(v), 6) for v in bbox]).encode()).hexdigest()[:8]
    out = paths.DEM / f"aoi_{key}.tif"
    if out.exists() and out.stat().st_size > MIN_VALID_FILE:
        return out
    opened = [rasterio.open(f) for f in files]
    try:
        data, transform = merge(opened)
        profile = opened[0].profile.copy()
    finally:
        for ds in opened:
            ds.close()
    profile.update(height=data.shape[1], width=data.shape[2], transform=transform)
    part = out.with_suffix(".tif.part")
    with rasterio.open(part, "w", **profile) as dst:
        dst.write(data)
    part.replace(out)
    return out


def dataset_for(path: Path, bbox: tuple[float, float, float, float]) -> dict[str, Any]:
    """Register (once) the cached DEM as a ready dataset row for the Data tab."""
    from modules.catalog import catalog
    from modules.db import client as db

    rel = paths.rel(path)
    row = db.query_one(
        "SELECT * FROM dataset WHERE path = %s AND deleted_at IS NULL", (rel,))
    if row:
        return row
    ds = catalog.dataset_create(
        "dem", f"Copernicus DEM-30m {path.stem}", path=rel,
        meta={"source": "copernicus_dem_30m", "bbox": [float(v) for v in bbox],
              "auto": True})
    catalog.dataset_set_status(str(ds["id"]), "ready")
    return ds
