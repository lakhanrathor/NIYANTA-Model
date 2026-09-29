"""stage.impact â€” vectorize extent, zonal village/infra analysis, hazard classes."""

from __future__ import annotations

import json
from typing import Any

import numpy as np
import rasterio
from rasterio import features as rio_features
from rasterio.transform import Affine
from shapely import wkt
from shapely.geometry import mapping, shape
from shapely.ops import unary_union

from modules.catalog import catalog
from modules.db import client as db
from modules.jobs.queue import JobContext
from modules.run import grid as grid_mod
from modules.run import result as run_result
from modules.run import work_terrain
from modules.solvers.base import FrameSeries
from modules.storage import paths

EXTENT_THRESHOLD_M = 0.1
M_PER_DEG_LAT = 110540.0
POP_RASTER = paths.POP / "ghs_pop_ind_2025_100m.tif"
POP_SOURCE = "Copernicus GHS-POP R2023A E2025 (India, 100 m)"


def _pop_raster(bbox: tuple[float, float, float, float]) -> tuple[Any, str] | None:
    """GHS-POP when ingested, else the corridor's WorldPop grid (Build step 4)."""
    if POP_RASTER.exists():
        return POP_RASTER, POP_SOURCE
    from modules.discover import worldpop_clip  # noqa: PLC0415

    wp = worldpop_clip.local_path(bbox)
    if wp:
        return wp, f"WorldPop 2020 ({'1 km' if '1km' in wp.name else '100 m'})"
    return None


def _zonal_population(mask: np.ndarray, gt: Affine, shape_hw: tuple[int, int]) -> tuple[float | None, str | None]:
    """People living inside the flood mask, resampled from a population grid.

    Grids hold people *per cell*, so they are resampled as an average and then
    scaled by dst/src cell area — correct whether the grid is coarser (WorldPop
    1 km) or finer than the solve grid. Bilinear alone would copy a whole cell's
    headcount into every smaller cell.

    Returns (None, None) when no population raster is on disk, so the caller
    can fall back to settlement populations instead of inventing a zero.
    """
    h, w = shape_hw
    bbox = (gt.c, gt.f + gt.e * h, gt.c + gt.a * w, gt.f)
    found = _pop_raster(bbox)
    if not found:
        return None, None
    path, source = found
    cos_lat = float(np.cos(np.radians((bbox[1] + bbox[3]) / 2)))
    try:
        from rasterio.warp import Resampling, reproject

        with rasterio.open(path) as src:
            dest = np.zeros(shape_hw, dtype="float32")
            reproject(
                source=rasterio.band(src, 1),
                destination=dest,
                src_transform=src.transform,
                src_crs=src.crs,
                dst_transform=gt,
                dst_crs="EPSG:4326",
                resampling=Resampling.average,
                src_nodata=src.nodata if src.nodata is not None else -200.0,
                dst_nodata=0.0,
            )
            src_area = abs(src.transform.a * src.transform.e)
            if src.crs and src.crs.is_geographic:
                src_area *= M_PER_DEG_LAT ** 2 * cos_lat
    except Exception:  # noqa: BLE001 - unreadable/missing raster -> no zonal figure
        return None, None
    dst_area = abs(gt.a * gt.e) * M_PER_DEG_LAT ** 2 * cos_lat
    dest = np.where(np.isfinite(dest) & (dest > 0), dest, 0.0) * (dst_area / src_area)
    return float(dest[mask].sum()), source


def _hazard(depth: float, vel: float) -> str:
    if depth > 2.0 or vel > 2.0:
        return "HIGH"
    if depth > 0.5:
        return "MODERATE"
    return "LOW"


def handle_impact(ctx: JobContext) -> dict[str, Any]:
    run_id = ctx.run_id or ctx.params["run_id"]
    run = catalog.run_get(run_id)
    assert run
    ctx.progress(81, "impact: vectorizing extent")

    run_dir = paths.run_dir(run_id)
    frames = FrameSeries.load(run_dir / "frames.npz")
    grid_meta = frames.meta.get("grid") or work_terrain.load_dem(run_id)[1]
    gt = Affine(*grid_mod.geotransform(grid_meta))
    cell_m = float(grid_meta["cell_m"])

    mask = frames.max_depth > EXTENT_THRESHOLD_M
    if not mask.any():
        # legitimate result: dry run — record zero impact, skip analysis
        empty = {"type": "FeatureCollection", "features": []}
        p = run_dir / "inundation_vector.geojson"
        p.write_text(json.dumps(empty), encoding="utf-8")
        catalog.product_create("inundation_vector", paths.rel(p), run_id=run_id, meta={"parts": 0})
        run_result.merge(run_id, impact={"population_exposed": 0, "villages_affected": 0,
                                         "infra": {"roads_km": 0.0, "bridges": 0, "hospitals": 0},
                                         "by_village": []})
        ctx.progress(87, "impact: dry run, zero impact")
        return {"population_exposed": 0, "villages_affected": 0}

    # ---- vectorize
    polys = []
    for geom, val in rio_features.shapes(mask.astype(np.uint8), mask=mask, transform=gt):
        if val == 1:
            polys.append(shape(geom))
    extent = unary_union(polys).buffer(0)
    if extent.is_empty:
        raise ValueError("vectorized extent empty")
    ctx.progress(84, f"impact: extent {extent.area * (M_PER_DEG_LAT ** 2) / 1e6:.1f} kmÂ²")
    pop_zonal, pop_source = _zonal_population(mask, gt, frames.max_depth.shape)

    extent_path = run_dir / "inundation_vector.geojson"
    extent_path.write_text(
        json.dumps({"type": "FeatureCollection",
                    "features": [{"type": "Feature", "properties": {"run_id": run_id},
                                  "geometry": mapping(extent)}]}),
        encoding="utf-8",
    )
    catalog.product_create("inundation_vector", paths.rel(extent_path), run_id=run_id,
                           meta={"parts": len(polys)})

    # helper lookups on the grid
    def cell_stats(lon: float, lat: float) -> tuple[float, float, float]:
        r, c = grid_mod.lonlat_to_cell(grid_meta, lon, lat)
        depth = float(frames.max_depth[r, c])
        vel = float(frames.max_vel[r, c])
        arr = float(frames.arrival_s[r, c])
        return depth, vel, (arr / 3600.0 if not np.isnan(arr) else None)  # type: ignore[return-value]

    # ---- villages
    villages = db.query(
        """SELECT vf.id, vf.name, ST_AsText(vf.geom) AS wkt, vp.count AS pop
           FROM vector_feature vf
           LEFT JOIN village_population vp ON vp.village_id = vf.id
           WHERE vf.layer = 'village'"""
    )
    by_village: list[dict[str, Any]] = []
    pop_exposed = 0
    villages_hit = 0
    hazard_features: list[dict[str, Any]] = []
    for v in villages:
        pt = wkt.loads(v["wkt"])
        lon, lat = pt.x, pt.y
        depth, vel, arrival_hr = cell_stats(lon, lat)
        in_extent = extent.intersects(pt) and depth > 0.0
        if not in_extent:
            continue
        villages_hit += 1
        pop = int(v["pop"] or 0)
        pop_exposed += pop
        hz = _hazard(depth, vel)
        by_village.append({"name": v["name"], "population": pop, "depth_m": round(depth, 2),
                           "velocity_ms": round(vel, 2), "arrival_hr": arrival_hr,
                           "hazard": hz})
        hazard_features.append({"type": "Feature", "geometry": mapping(pt),
                                "properties": {"name": v["name"], "hazard": hz, "depth_m": depth,
                                               "arrival_hr": arrival_hr, "population": pop}})
    ctx.progress(86, f"impact: {villages_hit} villages, {pop_exposed} exposed")

    # ---- infrastructure
    infra = {"roads_km": 0.0, "bridges": 0, "bridges_closed": 0, "hospitals": 0, "hospitals_hit": 0}
    roads = db.query("SELECT name, ST_AsText(geom) AS wkt, props FROM vector_feature WHERE layer = 'road'")
    coslat = abs(float(np.cos(np.radians(grid_meta["lat_mid"]))))
    for rd in roads:
        line = wkt.loads(rd["wkt"])
        inter = line.intersection(extent)
        if inter.is_empty:
            continue
        # local degreeâ†’km approximation
        km = 0.0
        geoms = getattr(inter, "geoms", [inter])
        for g in geoms:
            lons, lats = zip(*g.coords)
            seg = sum(
                np.hypot((lons[i + 1] - lons[i]) * coslat, lats[i + 1] - lats[i])
                for i in range(len(lons) - 1)
            ) * M_PER_DEG_LAT / 1000.0
            km += seg
        infra["roads_km"] += km

    for layer, key in (("bridge", "bridges"), ("hospital", "hospitals")):
        rows = db.query(f"SELECT name, ST_AsText(geom) AS wkt FROM vector_feature WHERE layer = '{layer}'")
        for row in rows:
            geom = wkt.loads(row["wkt"])
            if not extent.intersects(geom):
                continue
            infra[key] += 1
            # OSM bridges arrive as ways (the deck line), not points — sample
            # the flood at a point guaranteed to lie on the feature
            pt = geom if geom.geom_type == "Point" else geom.representative_point()
            depth, _, _ = cell_stats(pt.x, pt.y)
            if layer == "bridge" and depth > 1.0:
                infra["bridges_closed"] += 1
            if layer == "hospital":
                infra["hospitals_hit"] += 1
    infra["roads_km"] = round(infra["roads_km"], 2)

    buildings_hit = sum(
        1
        for b in db.query("SELECT ST_AsText(geom) AS wkt FROM vector_feature WHERE layer = 'building'")
        if extent.intersects(wkt.loads(b["wkt"]))
    )
    # OSM clip (infra_footprint): the same per-frame sampling the players
    # draw, so on-screen colours and these counts are one computation.
    try:
        from modules.run import infra_exposure  # noqa: PLC0415

        osm = infra_exposure.ensure(run_id)["summary"]
        # bridges/hospitals/schools are mirrored into vector_feature by the
        # OSM clip and already counted above — take only buildings and roads
        buildings_hit += osm["buildings_flooded"]
        infra["roads_km"] = round(infra["roads_km"] + osm["road_km_cut"], 2)
    except Exception as exc:  # noqa: BLE001 - impact must not fail on the overlay
        ctx.progress(88, f"impact: OSM exposure skipped ({exc})")

    # ---- hazard layer product
    hazard_fc = {"type": "FeatureCollection", "features": hazard_features}
    hazard_path = run_dir / "hazard_villages.geojson"
    hazard_path.write_text(json.dumps(hazard_fc), encoding="utf-8")
    catalog.product_create("hazard_layer", paths.rel(hazard_path), run_id=run_id,
                           meta={"villages": len(hazard_features)})

    impact_path = run_dir / "impact_table.json"
    impact_path.write_text(json.dumps(by_village), encoding="utf-8")
    catalog.product_create("impact_table", paths.rel(impact_path), run_id=run_id,
                           meta={"villages_affected": villages_hit, "population_exposed": pop_exposed})

    pop_exposed_final = int(round(pop_zonal)) if pop_zonal is not None else pop_exposed
    population_method = (
        "zonal sum of the population grid over the flood extent"
        if pop_zonal is not None
        else "sum of inundated settlement populations (OSM place tags)"
    )
    population_source = pop_source or "OSM place population tags"
    # Build's manual impact numbers win over the modelled totals when the
    # scenario asked for them; otherwise the WorldPop / OSM result stands.
    spec = catalog.scenario_get(run["scenario_id"]) or {}
    manual = (spec.get("spec") or {}).get("impact") or {}
    if manual.get("source") == "manual":
        if manual.get("population") is not None:
            pop_exposed_final = int(manual["population"])
            population_method = "manual override (scenario.impact.population)"
            population_source = "entered in Build"
        if manual.get("houses") is not None:
            buildings_hit = int(manual["houses"])
    run_result.merge(
        run_id,
        impact={
            "population_exposed": pop_exposed_final,
            "population_method": population_method,
            "population_source": population_source,
            "villages_affected": villages_hit,
            "buildings_affected": buildings_hit,
            "assets_million": manual.get("assets_million"),
            "infra": infra,
            "by_village": by_village,
        },
        hazard={"classes": ["HIGH", "MODERATE", "LOW"], "layer": paths.rel(hazard_path)},
    )
    ctx.progress(
        87,
        f"impact: pop {pop_exposed_final}, {villages_hit} villages, "
        f"roads {infra['roads_km']} km, bridges {infra['bridges']}",
    )
    return {"population_exposed": pop_exposed_final, "villages_affected": villages_hit, "infra": infra}

