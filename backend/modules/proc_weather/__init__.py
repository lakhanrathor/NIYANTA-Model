"""proc_weather — rainfall/inflow tables → QC + upstream BC product (MODULE_SPEC 4.10)."""

from __future__ import annotations

import csv
import json
from typing import Any

from modules.db import client as db
from modules.storage import paths

TIME_KEYS = ("time", "ts", "datetime", "date", "hour")
FLOW_KEYS = ("inflow_cms", "inflow", "discharge", "flow", "q", "cusecs")


def process(dataset: dict, progress=None) -> dict[str, Any]:
    src = paths.abs_path(dataset["path"])
    rows = _read(src)
    if progress:
        progress(40, f"weather: {len(rows)} rows read")
    qc = {"rows_in": len(rows), "dropped": 0, "negative_dropped": 0}
    series: list[tuple[str, float]] = []
    for row in rows:
        t = _first(row, TIME_KEYS)
        q = _first(row, FLOW_KEYS)
        if t is None or q is None:
            qc["dropped"] += 1
            continue
        try:
            qv = float(q)
        except (TypeError, ValueError):
            qc["dropped"] += 1
            continue
        if qv < 0:
            qc["negative_dropped"] += 1
            qc["dropped"] += 1
            continue
        series.append((str(t), qv))

    product_kind = "bc_upstream"
    path = None
    if series:
        out = paths.product_file("bc_upstream", str(dataset["id"]), "csv")
        out.parent.mkdir(parents=True, exist_ok=True)
        with open(out, "w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(["time", "inflow_cms"])
            w.writerows(series)
        path = paths.rel(out)
    else:
        product_kind = "weather_ingested"
        db.execute(
            """INSERT INTO connector_snapshot (name, status, counts, last_sync)
               VALUES ('weather', 'ok', %s::jsonb, now())
               ON CONFLICT (name) DO UPDATE SET status = 'ok',
                 counts = EXCLUDED.counts, last_sync = now()""",
            (json.dumps(qc),),
        )
    if progress:
        progress(85, f"weather: {qc}")
    return {"kind": product_kind, "path": path,
            "meta": {"qc": qc, "series_len": len(series)}}


def _read(src) -> list[dict]:
    if src.suffix.lower() in (".json", ".geojson"):
        data = json.loads(src.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return data
        return data.get("series") or data.get("records") or [data]
    with open(src, newline="", encoding="utf-8-sig") as fh:
        return list(csv.DictReader(fh))


def _first(row: dict, keys: tuple[str, ...]):
    lower = {str(k).strip().lower(): v for k, v in row.items()}
    for key in keys:
        if key in lower and lower[key] not in (None, ""):
            return lower[key]
    return None
