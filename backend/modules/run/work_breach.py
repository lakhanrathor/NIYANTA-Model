"""stage.breach - breach geometry + outflow hydrograph, before the solver runs.

Needs only the ScenarioSpec (no DEM, no mesh), so it is its own stage rather
than being buried inside the solver. Stage.solve re-solves deterministically
from the same spec; this stage's job is to persist the solved breach and the
hydrograph product the Results screen reads.
"""

from __future__ import annotations

import json
from typing import Any

from modules.breach import solve_for_scenario, solve_spec
from modules.catalog import catalog
from modules.db import client as db
from modules.jobs.queue import JobContext
from modules.storage import paths


def handle_breach(ctx: JobContext) -> dict[str, Any]:
    run_id = ctx.run_id or ctx.params["run_id"]
    run = catalog.run_get(run_id)
    assert run
    scenario = catalog.scenario_get(run["scenario_id"])
    spec = scenario["spec"]
    method = (spec.get("breach") or {}).get("method") or "froehlich2008"
    ctx.progress(26, f"breach: solving ({method})")

    # Persist the solved breach alongside the scenario (idempotent upsert).
    try:
        solve_for_scenario(run["scenario_id"], spec)
    except Exception as exc:  # noqa: BLE001 - breach solve is recoverable
        ctx.progress(27, f"breach: scenario solve degraded ({exc})")

    geom, hg = solve_spec(spec)
    run_dir = paths.run_dir(run_id)
    hg_path = run_dir / "breach_hydrograph.json"
    hg_path.write_text(json.dumps(hg), encoding="utf-8")

    peak = max((q for q in (hg.get("q") or hg.get("q_cms") or []) if isinstance(q, (int, float))),
               default=None)
    db.upsert(
        "breach_solution",
        {
            "scenario_id": run["scenario_id"],
            "method": method,
            "mode": (spec.get("breach") or {}).get("mode") or "overtopping",
            "width_m": float(geom.bottom_width_m),
            "depth_m": float(getattr(geom, "depth_m", 0.0) or 0.0),
            "side_slope": float(getattr(geom, "side_slope", 0.0) or 0.0),
            "t_form_hr": float(getattr(geom, "t_form_hr", 0.0) or 0.0),
            "hydrograph_path": str(hg_path.relative_to(paths.ROOT)),
        },
        conflict="scenario_id",
    )
    try:
        from modules.catalog import catalog as _catalog  # noqa: PLC0415

        _catalog.product_create(
            "breach_hydrograph",
            str(hg_path.relative_to(paths.ROOT)),
            run_id=run_id,
            scenario_id=run["scenario_id"],
            meta={"method": method, "peak_cms": peak, "points": len(hg.get("q") or [])},
        )
    except Exception:  # noqa: BLE001 - catalog write is best-effort
        pass
    ctx.progress(30, f"breach: {method} solved, peak {peak if peak else 'n/a'} m3/s")
    return {
        "run_id": run_id,
        "method": method,
        "width_m": float(geom.bottom_width_m),
        "peak_cms": peak,
        "hydrograph": str(hg_path.relative_to(paths.ROOT)),
    }
