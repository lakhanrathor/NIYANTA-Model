"""GIS packaging: SHP (zip), KML, GeoJSON bundle, GeoTIFF copies, CSVs, ZIP."""

from __future__ import annotations

import csv
import json
import shutil
import zipfile
from pathlib import Path
from typing import Any, Callable

from modules.catalog import catalog
from modules.db import client as db
from modules.run import work_terrain
from modules.storage import paths

ALL_FORMATS = ["shp", "kml", "geojson", "geotiff", "csv", "report"]
# `POST /api/exports` accepts "report" (the artefact is report.html, printed to
# PDF in the browser); older callers sent "pdf". Both names mean the same file,
# so an alias here keeps either spelling working instead of dropping the format.
FORMAT_ALIAS = {"pdf": "report"}


def build_package(run_id: str, formats: list[str] | None = None,
                  progress: Callable[[int, str], None] | None = None) -> dict[str, Any]:
    wanted = formats or ALL_FORMATS
    formats = list(
        dict.fromkeys(FORMAT_ALIAS.get(f, f) for f in wanted if f in ALL_FORMATS or f in FORMAT_ALIAS)
    )
    out = paths.export_dir(run_id)
    for old in out.glob("*"):
        if old.is_file():
            old.unlink()
        else:
            shutil.rmtree(old, ignore_errors=True)
    run_dir = paths.run_dir(run_id)
    files: list[str] = []

    def say(pct: int, msg: str) -> None:
        if progress:
            progress(pct, msg)

    extent_geojson = run_dir / "inundation_vector.geojson"
    hazard_geojson = run_dir / "hazard_villages.geojson"
    stations_json = run_dir / "stations.json"
    impact_json = run_dir / "impact_table.json"
    hg_json = run_dir / "breach_hydrograph.json"
    if not extent_geojson.exists():
        raise ValueError("run has no inundation vector; run stages first")

    stations = json.loads(stations_json.read_text(encoding="utf-8")) if stations_json.exists() else []
    impact = json.loads(impact_json.read_text(encoding="utf-8")) if impact_json.exists() else []
    station_features = _station_points(run_id)

    # ---- geojson bundle
    if "geojson" in formats:
        bundle = {"type": "FeatureCollection", "features": []}
        for src, layer in ((extent_geojson, "inundation_extent"), (hazard_geojson, "hazard_villages")):
            if src.exists():
                data = json.loads(src.read_text(encoding="utf-8"))
                for feat in data.get("features", []):
                    feat.setdefault("properties", {})["layer"] = layer
                    bundle["features"].append(feat)
        bundle["features"].extend(station_features)
        p = out / "niyanta_bundle.geojson"
        p.write_text(json.dumps(bundle), encoding="utf-8")
        files.append(p.name)
        say(94, "export: geojson bundle")

    # ---- shapefile (zip)
    if "shp" in formats:
        try:
            import geopandas as gpd

            shp_dir = out / "shp"
            shp_dir.mkdir(exist_ok=True)
            gpd.read_file(extent_geojson).to_file(shp_dir / "inundation_extent.shp")
            if hazard_geojson.exists() and json.loads(hazard_geojson.read_text())["features"]:
                gpd.read_file(hazard_geojson).to_file(shp_dir / "hazard_villages.shp")
            if station_features:
                gpd.GeoDataFrame.from_features(station_features, crs="EPSG:4326").to_file(
                    shp_dir / "stations.shp"
                )
            shp_zip = out / "shapefiles.zip"
            with zipfile.ZipFile(shp_zip, "w", zipfile.ZIP_DEFLATED) as zf:
                for f in shp_dir.glob("*"):
                    zf.write(f, f.name)
            files.append(shp_zip.name)
            say(96, "export: shapefiles")
        except Exception as exc:
            files.append(f"shp FAILED: {exc}")

    # ---- kml
    if "kml" in formats:
        _write_kml(out / "niyanta_flood.kml", extent_geojson, hazard_geojson, run_id)
        files.append("niyanta_flood.kml")
        say(97, "export: kml")

    # ---- geotiff copies
    if "geotiff" in formats:
        for kind in ("max_depth", "arrival_time", "inundation_extent"):
            src = run_dir / f"{kind}.tif"
            if src.exists():
                dst = out / f"{kind}.tif"
                shutil.copy2(src, dst)
                files.append(dst.name)
        say(98, "export: geotiffs")

    # ---- csv
    if "csv" in formats:
        if stations:
            _write_csv(out / "stations.csv", stations)
            files.append("stations.csv")
        if impact:
            _write_csv(out / "village_impact.csv", impact)
            files.append("village_impact.csv")
        sens = db.query_one("SELECT sensitivity FROM breach_solution WHERE scenario_id = "
                            "(SELECT scenario_id FROM run WHERE id = %s)", (run_id,))
        if sens and sens.get("sensitivity"):
            files.append(_sensitivity_csv(out, sens["sensitivity"]))
        if hg_json.exists():
            _hydrograph_csv(out, hg_json)
            files.append("breach_hydrograph.csv")
        say(99, "export: csv tables")

    # ---- report (print-ready HTML; the browser prints it to PDF)
    if "report" in formats:
        from modules.export import report

        rp = report.build(run_id)
        files.append(rp.name)

    # ---- zip package
    package = out / "package.zip"
    with zipfile.ZipFile(package, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in out.rglob("*"):
            if f.is_file() and f != package:
                zf.write(f, f.relative_to(out).as_posix())
    files.append(package.name)
    say(100, "export: package ready")
    return {"files": files, "path": paths.rel(package), "formats": formats}


def _station_points(run_id: str) -> list[dict]:
    from modules.run.work_mesh import load_mesh

    try:
        mesh = load_mesh(run_id)
        grid_meta = work_terrain.load_dem(run_id)[1]
    except Exception:
        return []
    from modules.run import grid as grid_mod

    out = []
    for km, (r, c) in mesh["stations_km"].items():
        lon, lat = grid_mod.cell_to_lonlat(grid_meta, r, c)
        out.append({"type": "Feature", "properties": {"layer": "stations", "km": float(km)},
                    "geometry": {"type": "Point", "coordinates": [lon, lat]}})
    return out


def _write_csv(path: Path, rows: list[dict]) -> None:
    keys: list[str] = []
    for row in rows:
        for k in row:
            if k not in keys:
                keys.append(k)
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=keys, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow({k: ("" if row.get(k) is None else row.get(k)) for k in keys})


def _sensitivity_csv(out: Path, sensitivity: dict) -> str:
    rows = []
    for axis in ("width", "depth", "time"):
        for entry in sensitivity.get(axis) or []:
            rows.append({"axis": axis, "delta_pct": entry.get("delta_pct"),
                         "peak_cms": entry.get("peak_cms"),
                         "delta_peak_pct": round(entry.get("delta_peak_pct") or 0.0, 2)})
    _write_csv(out / "sensitivity.csv", rows)
    return "sensitivity.csv"


def _hydrograph_csv(out: Path, hg_path: Path) -> None:
    hg = json.loads(hg_path.read_text(encoding="utf-8"))
    rows = [{"time_hr": round(t / 3600.0, 3), "q_cms": q, "level_m": lv}
            for t, q, lv in zip(hg["time_s"], hg["q_cms"], hg["level_m"])]
    _write_csv(out / "breach_hydrograph.csv", rows)


def _write_kml(path: Path, extent_geojson: Path, hazard_geojson: Path, run_id: str) -> None:
    import simplekml

    kml = simplekml.Kml(name=f"NIYANTA {run_id[:8]}")
    data = json.loads(extent_geojson.read_text(encoding="utf-8"))
    for feat in data.get("features", []):
        geom = feat["geometry"]
        if geom["type"] == "MultiPolygon":
            rings = [ring for poly in geom["coordinates"] for ring in poly]
        else:
            rings = geom["coordinates"]
        for ring in rings:
            pts = [(lon, lat) for lon, lat, *_ in ring]
            poly = kml.newpolygon(outerboundaryis=pts)
            poly.style.polystyle.color = "7f0000ff"  # translucent red (aabbggrr)
            poly.style.polystyle.outline = 1
    if hazard_geojson.exists():
        hz = json.loads(hazard_geojson.read_text(encoding="utf-8"))
        colors = {"HIGH": "ff0000ff", "MODERATE": "ff00ffff", "LOW": "ff00ff00"}
        for feat in hz.get("features", []):
            props = feat.get("properties", {})
            pm = kml.newpoint(name=props.get("name", "village"),
                              coords=[tuple(feat["geometry"]["coordinates"])])
            pm.style.iconstyle.color = colors.get(props.get("hazard"), "ff0000ff")
            pm.description = (f"hazard={props.get('hazard')} depth={props.get('depth_m', 0):.1f}m "
                              f"arrival={props.get('arrival_hr')} pop={props.get('population')}")
    kml.save(str(path))
