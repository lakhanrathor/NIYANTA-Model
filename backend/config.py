from __future__ import annotations

import importlib.util
import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
REPO_DIR = BACKEND_DIR.parent

# Verify HTTPS against the OS certificate store (what the browser trusts).
# Behind a TLS-inspecting proxy/antivirus, Python's bundled CA list rejects the
# re-signed chain ("self-signed certificate in certificate chain") and every
# Overpass / WorldPop / Copernicus / Earth Engine download fails.
try:
    import truststore

    truststore.inject_into_ssl()
except ImportError:  # optional: plain certifi verification without it
    pass


def _fix_gis_env() -> None:
    """Portable-DB scripts export PROJ_LIB/GDAL_DATA pointing at PostGIS 3.6's
    ancient proj.db (layout v2), which modern rasterio/GDAL reject. Redirect to
    the bundled data dirs before any GIS library initialises PROJ."""
    spec = importlib.util.find_spec("rasterio")
    if not spec or not spec.origin:
        return
    base = Path(spec.origin).parent
    proj_data = base / "proj_data"
    if (proj_data / "proj.db").exists():
        os.environ["PROJ_LIB"] = str(proj_data)
        os.environ["PROJ_DATA"] = str(proj_data)
    gdal_data = base / "gdal_data"
    if gdal_data.exists():
        os.environ["GDAL_DATA"] = str(gdal_data)


_fix_gis_env()


def _default_engine_root() -> str:
    candidates = [
        Path(r"C:\Users\ankitkumar\Desktop\work\1\damatlas\engines\delft3d_fm\2026.01\kernels"),
        Path(r"C:\Users\ankitkumar\Desktop\work\1\dflowfm_2026\Deltares\Delft3D FM Suite 2026.01 HMWQ"),
        REPO_DIR / "delft3d_fm_suite",
        REPO_DIR / "damatlas" / "engines" / "delft3d_fm" / "2026.01" / "kernels",
    ]
    for c in candidates:
        if c.exists():
            return str(c)
    return ""


class Settings:
    # Single-file SQLite database (WAL). No server, no port, fully portable.
    # NIYANTA_DB overrides the location; tests point it at a scratch file.
    db_path = Path(os.getenv("NIYANTA_DB", str(BACKEND_DIR / "data" / "niyanta.sqlite")))

    storage_dir = Path(os.getenv("NIYANTA_STORAGE", str(BACKEND_DIR / "storage")))
    engine_root = os.getenv("NIYANTA_ENGINE_ROOT", "") or _default_engine_root()
    workers = int(os.getenv("NIYANTA_WORKERS", "2"))
    gee_mode = os.getenv("NIYANTA_GEE_MODE", "online")  # offline | online
    gee_project = os.getenv("NIYANTA_GEE_PROJECT", "zeta-antenna-398715")
    gee_service_account = os.getenv("NIYANTA_GEE_SA", str(REPO_DIR / "deploy" / "ee" / "service-account.json"))
    gee_daily_hour = int(os.getenv("NIYANTA_GEE_HOUR", "7"))
    scheduler_enabled = os.getenv("NIYANTA_SCHEDULER", "1") == "1"
    cors_origins = os.getenv("NIYANTA_CORS", "http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173")
    demo_dir = Path(os.getenv("NIYANTA_DEMO_DIR", str(REPO_DIR / "data" / "demo")))
    # Any-AOI real data: auto-fetch Copernicus DEM-30m in stage.terrain and
    # auto-enqueue a GEE sweep for the run's watch box on execute.
    auto_dem = os.getenv("NIYANTA_AUTO_DEM", "1") == "1"
    auto_imagery = os.getenv("NIYANTA_AUTO_IMAGERY", "1") == "1"

settings = Settings()
