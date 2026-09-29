"""proc_population — census CSV (name,pop[,lon,lat]) → village_population (MODULE_SPEC 4.11).

Raster path (WorldPop GeoTIFF) uses zonal sum when a population raster dataset exists;
the CSV path is the demo/authoritative Census route.
"""

from __future__ import annotations

import csv
import json
from typing import Any

from modules.db import client as db
from modules.storage import paths


def process(dataset: dict, progress=None) -> dict[str, Any]:
    src = paths.abs_path(dataset["path"])
    if src.suffix.lower() in (".tif", ".tiff"):
        return _zonal(src, dataset, progress)
    return _census_csv(src, dataset, progress)


def _census_csv(src, dataset: dict, progress) -> dict[str, Any]:
    updated = 0
    missing: list[str] = []
    with open(src, newline="", encoding="utf-8-sig") as fh:
        for row in csv.DictReader(fh):
            name = (row.get("name") or row.get("village") or row.get("NAME") or "").strip()
            pop_raw = row.get("pop") or row.get("population") or row.get("count") or "0"
            if not name:
                continue
            try:
                pop = int(float(pop_raw))
            except ValueError:
                continue
            village = db.query_one(
                "SELECT id FROM vector_feature WHERE layer = 'village' AND name = %s", (name,)
            )
            if not village:
                lon = row.get("lon") or row.get("longitude")
                lat = row.get("lat") or row.get("latitude")
                if lon and lat:
                    village = db.query_one(
                        """INSERT INTO vector_feature (dataset_id, layer, name, geom, props)
                           VALUES (%s, 'village', %s,
                                   ST_SetSRID(ST_MakePoint(%s, %s), 4326), '{}'::jsonb)
                           RETURNING id""",
                        (dataset["id"], name, float(lon), float(lat)),
                    )
                else:
                    missing.append(name)
                    continue
            db.execute(
                """INSERT INTO village_population (village_id, count, source, updated)
                   VALUES (%s, %s, %s, now())
                   ON CONFLICT (village_id) DO UPDATE SET count = EXCLUDED.count,
                     source = EXCLUDED.source, updated = now()""",
                (str(village["id"]), pop, f"dataset:{dataset['id']}"),
            )
            updated += 1
    if progress:
        progress(70, f"population: {updated} villages updated")
    return {"kind": "population_zonal", "path": None,
            "meta": {"villages_updated": updated, "missing_matches": missing[:20]}}


def _zonal(src, dataset: dict, progress) -> dict[str, Any]:
    """WorldPop raster → zonal sum per village polygon (rasterstats-free path)."""
    import numpy as np
    import rasterio
    from rasterio.mask import mask as rio_mask

    villages = db.query(
        "SELECT id, name, ST_AsText(geom) AS wkt FROM vector_feature WHERE layer = 'village'"
    )
    updated = 0
    with rasterio.open(src) as ds:
        from shapely import wkt as shp_wkt

        for vill in villages:
            if not vill.get("wkt"):
                continue
            geom = shp_wkt.loads(vill["wkt"]).buffer(0.004).__geo_interface__
            try:
                arr, _ = rio_mask(ds, [geom], crop=True, filled=True, nodata=ds.nodata or 0)
            except Exception:
                continue
            data = arr[0].astype(float)
            if ds.nodata is not None:
                data = np.where(data == ds.nodata, 0.0, data)
            pop = int(round(float(np.nansum(np.clip(data, 0, None)))))
            if pop <= 0:
                continue
            db.execute(
                """INSERT INTO village_population (village_id, count, source, updated)
                   VALUES (%s, %s, %s, now())
                   ON CONFLICT (village_id) DO UPDATE SET count = EXCLUDED.count,
                     source = EXCLUDED.source, updated = now()""",
                (str(vill["id"]), pop, f"dataset:{dataset['id']}"),
            )
            updated += 1
    if progress:
        progress(70, f"population raster zonal: {updated} villages")
    return {"kind": "population_zonal", "path": None, "meta": {"villages_updated": updated}}
