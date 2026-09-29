from __future__ import annotations

from pathlib import Path

from config import settings

ROOT = settings.storage_dir
UPLOADS = ROOT / "uploads"
PRODUCTS = ROOT / "products"
TILES = ROOT / "tiles"
EXPORTS = ROOT / "exports"
RUNS = ROOT / "runs"
REPORTS = ROOT / "reports"
TMP = ROOT / "tmp"
DEM = ROOT / "dem"
POP = ROOT / "pop"


def ensure_all() -> None:
    for p in (UPLOADS, PRODUCTS, TILES, EXPORTS, RUNS, REPORTS, TMP, DEM, POP):
        p.mkdir(parents=True, exist_ok=True)


def upload_path(dataset_id: str, name: str) -> Path:
    d = UPLOADS / dataset_id
    d.mkdir(parents=True, exist_ok=True)
    return d / name


def product_path(kind: str, *parts: str) -> Path:
    d = PRODUCTS / kind
    for p in parts[:-1]:
        d = d / p
    d.mkdir(parents=True, exist_ok=True)
    return d / (parts[-1] if parts else kind)


def product_file(kind: str, ident: str, ext: str) -> Path:
    d = PRODUCTS / kind
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{ident}.{ext.lstrip('.')}"


def run_dir(run_id: str) -> Path:
    d = RUNS / run_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def model_dir(run_id: str) -> Path:
    """D-Flow FM scratch: a fresh directory each build."""
    import shutil

    d = RUNS / run_id / "model"
    if d.exists():
        shutil.rmtree(d, ignore_errors=True)
    d.mkdir(parents=True, exist_ok=True)
    return d


def tiles_dir(run_id: str, layer: str) -> Path:
    d = TILES / run_id / layer
    d.mkdir(parents=True, exist_ok=True)
    return d


def export_dir(run_id: str) -> Path:
    d = EXPORTS / run_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def report_path(run_id: str, name: str) -> Path:
    d = REPORTS / run_id
    d.mkdir(parents=True, exist_ok=True)
    return d / name


def rel(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def abs_path(rel_path: str) -> Path:
    p = Path(rel_path)
    if p.is_absolute():
        return p
    return ROOT / p
