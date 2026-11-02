"""Print-ready HTML report (Jinja2) — browser prints to PDF."""

from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, Undefined, select_autoescape

from modules.catalog import catalog
from modules.db import client as db
from modules.storage import paths

TEMPLATES = Path(__file__).resolve().parent / "templates"


def build(run_id: str) -> Path:
    run = catalog.run_get(run_id)
    if not run:
        raise ValueError("run not found")
    scenario = catalog.scenario_get(run["scenario_id"]) or {}
    result = run.get("result") or {}
    metrics = run.get("metrics") or {}
    run_dir = paths.run_dir(run_id)

    stations = _read_json(run_dir / "stations.json", [])
    impact_rows = _read_json(run_dir / "impact_table.json", [])
    impact = result.get("impact") or {}
    validation = result.get("validation") or {}
    vrow = db.query_one("SELECT * FROM validation_score WHERE run_id = %s", (run_id,)) or {}
    vdetail = vrow.get("detail") or {}
    if isinstance(vdetail, str):
        vdetail = json.loads(vdetail)

    spec = scenario.get("spec") or {}
    from modules.scenario import lab  # noqa: PLC0415

    label = lab.label_of(spec)[0]
    # OSM exposure + evacuation need the frame stack; absent → section says so
    infra = evac = None
    try:
        from modules.run import evacuation, infra_exposure  # noqa: PLC0415

        infra = infra_exposure.ensure(run_id)
        evac = evacuation.ensure(run_id)
    except FileNotFoundError:
        pass

    breach_row = db.query_one("SELECT * FROM breach_solution WHERE scenario_id = %s",
                              (run["scenario_id"],)) or {}
    breach = {"method": breach_row.get("method"), "mode": breach_row.get("mode"),
              "width_m": breach_row.get("width_m"), "depth_m": breach_row.get("depth_m"),
              "side_slope": breach_row.get("side_slope"), "t_form_hr": breach_row.get("t_form_hr")}

    # thumbnail: final playback frame copied next to the report
    reports_dir = paths.report_path(run_id, "").parent
    reports_dir.mkdir(parents=True, exist_ok=True)
    thumb_rel = ""
    depth_index = paths.tiles_dir(run_id, "depth") / "index.json"
    frames = sorted((paths.tiles_dir(run_id, "depth")).glob("f*.png"))
    if frames:
        shutil.copy2(frames[-1], reports_dir / "map.png")
        thumb_rel = "map.png"
    depth_scale = 10.0
    if depth_index.exists():
        depth_scale = json.loads(depth_index.read_text(encoding="utf-8")).get("depth_scale_m", 10.0)

    env = Environment(loader=FileSystemLoader(str(TEMPLATES)),
                      autoescape=select_autoescape(["html"]))
    # evidence rule: a missing number prints as an em dash, never as 0
    env.filters["f"] = lambda v, fmt="%.1f": "—" if v is None or isinstance(v, Undefined) else fmt % v
    html = env.get_template("report.html.j2").render(
        run=run,
        scenario=scenario,
        metrics=metrics,
        stations=stations,
        impact=impact,
        impact_rows=impact_rows,
        validation=validation,
        vdetail=vdetail,
        label=label,
        infra=(infra or {}).get("summary"),
        infra_thr=(infra or {}).get("thresholds"),
        evac=evac,
        evac_rows=sorted((evac or {}).get("corridors") or [],
                         key=lambda c: -1e9 if c["worst_margin_h"] is None else c["worst_margin_h"])[:12],
        breach=breach,
        thumbnail=thumb_rel,
        depth_scale=depth_scale,
        generated=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        provenance=(scenario.get("spec") or {}).get("provenance", {}).get("producer", "manual"),
    )
    out = reports_dir / "report.html"
    out.write_text(html, encoding="utf-8")
    return out


def _read_json(path: Path, default: Any) -> Any:
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return default
