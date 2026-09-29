"""Re-run selected pipeline stages for runs whose inputs changed.

    python scripts/rerun_stage.py post impact validate <run_id> [<run_id> ...]
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Callable

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from modules.jobs.queue import JobContext  # noqa: E402
from modules.run.work_impact import handle_impact  # noqa: E402
from modules.run.work_post import handle_post  # noqa: E402
from modules.run.work_validate import handle_validate  # noqa: E402

STAGES: dict[str, Callable[[JobContext], dict[str, Any]]] = {
    "post": handle_post,
    "impact": handle_impact,
    "validate": handle_validate,
}


def main(argv: list[str]) -> int:
    stage_names = [a for a in argv if a in STAGES]
    run_ids = [a for a in argv if a not in STAGES]
    if not stage_names or not run_ids:
        print(__doc__)
        return 2
    for run_id in run_ids:
        for name in stage_names:
            ctx = JobContext({
                "id": "00000000-0000-4000-8000-000000000001",
                "type": f"stage.{name}",
                "params": {"run_id": run_id},
                "run_id": run_id,
            })
            print(f"{run_id[:8]} {name}:", STAGES[name](ctx), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
