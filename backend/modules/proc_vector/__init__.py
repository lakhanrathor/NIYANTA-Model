"""proc_vector — SHP/GeoJSON/KML → canonical PostGIS layers (MODULE_SPEC 4.8)."""

from __future__ import annotations

import json
from typing import Any

import geopandas as gpd

from modules.db import client as db
from modules.storage import paths

LAYER_KEYWORDS = {
    "village": ("village", " revenue", "census", "settlement"),
    "road": ("road", "highway", "nh ", "sh "),
    "bridge": ("bridge",),
    "hospital": ("hospital", "health"),
    "critical": ("critical", "school", "shelter"),
    "boundary": ("boundary", "district", "tehsil", "block"),
}


def guess_layer(dataset: dict, columns: list[str]) -> str:
    haystack = f"{dataset.get('name', '')} {' '.join(columns)}".lower()
    for layer, keywords in LAYER_KEYWORDS.items():
        if any(kw in haystack for kw in keywords):
            return layer
    return "boundary"


def process(dataset: dict, progress=None) -> dict[str, Any]:
    src = paths.abs_path(dataset["path"])
    gdf = gpd.read_file(src)
    if gdf.empty:
        raise ValueError("vector dataset has no features")
    if gdf.crs is None:
        raise ValueError("vector CRS missing; cannot reproject to EPSG:4326")
    gdf = gdf.to_crs(4326)
    layer = guess_layer(dataset, [str(c) for c in gdf.columns])
    if progress:
        progress(40, f"vector: {len(gdf)} features as layer '{layer}'")

    count = 0
    for _, row in gdf.iterrows():
        geom = row.geometry
        if geom is None or geom.is_empty:
            continue
        props = {k: _safe(v) for k, v in row.items() if k != "geometry"}
        name = str(props.get("name") or props.get("NAME") or props.get("Name") or dataset.get("name") or "")
        db.execute(
            """INSERT INTO vector_feature (dataset_id, layer, name, geom, props)
               VALUES (%s, %s, %s, ST_SetSRID(ST_GeomFromText(%s), 4326), %s::jsonb)""",
            (dataset["id"], layer, name or None, geom.wkt, json.dumps(props)),
        )
        count += 1

    minx, miny, maxx, maxy = (float(v) for v in gdf.total_bounds)
    return {"kind": "inundation_vector", "path": None,
            "meta": {"layer": layer, "count": count,
                     "bbox": [minx, miny, maxx, maxy], "crs": "EPSG:4326"}}


def _safe(value: Any) -> Any:
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)
