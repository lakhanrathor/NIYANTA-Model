"""D-Flow FM engine runner — locate and execute run_dimr.bat headlessly.

Ported from damatlas pipeline/simulation/engine_runner.py (loguru stripped,
extra candidate layouts for the relocated kernels tree). The engine is
subprocess-isolated: stdout is streamed line-by-line so progress lines reach
the job queue, and a log tail is attached to any failure.
"""

from __future__ import annotations

import os
import re
import subprocess
import time
from pathlib import Path
from typing import Any, Callable


def resolve_run_dimr(engine_root: str | Path | None) -> Path | None:
    """Locate run_dimr.bat under any of the known install layouts."""
    if not engine_root:
        return None
    root = Path(engine_root)
    candidates = [
        root,
        root / "bin",
        root / "kernels" / "x64" / "bin",
        root / "x64" / "bin",
        root / "plugins" / "DeltaShell.Dimr" / "kernels" / "x64" / "bin",
    ]
    for cand in candidates:
        bat = cand / "run_dimr.bat"
        if bat.exists():
            return bat
    return None


def is_available(engine_root: str | Path | None) -> bool:
    return resolve_run_dimr(engine_root) is not None


def run_model(model_dir: Path, *, engine_root: str | Path | None,
              timeout_s: float = 3600.0,
              progress_cb: Callable[[int, str], None] | None = None) -> dict[str, Any]:
    """Execute the model in model_dir; raises RuntimeError on failure."""
    run_dimr = resolve_run_dimr(engine_root)
    if run_dimr is None:
        raise RuntimeError(
            "D-Flow FM engine not found (run_dimr.bat). Install the Delft3D FM "
            "Suite or set NIYANTA_ENGINE_ROOT to a directory containing it."
        )
    cfg = model_dir / "dimr_config.xml"
    if not cfg.exists():
        raise FileNotFoundError(f"dimr_config.xml missing in {model_dir}")

    env = os.environ.copy()
    env["PATH"] = str(run_dimr.parent) + os.pathsep + env.get("PATH", "")

    start = time.time()
    proc = subprocess.Popen(
        ["cmd", "/c", str(run_dimr), "dimr_config.xml"],
        cwd=str(model_dir),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        errors="replace",
        env=env,
    )
    tail: list[str] = []
    assert proc.stdout is not None
    for line in iter(proc.stdout.readline, ""):
        line = line.rstrip("\n")
        if not line:
            continue
        tail.append(line)
        del tail[:-60:]
        matched = _progress_from_line(line)
        if matched is not None and progress_cb:
            progress_cb(matched[0], matched[1])
    try:
        proc.wait(timeout=timeout_s)
    except subprocess.TimeoutExpired:
        proc.kill()
        raise RuntimeError(
            f"D-Flow FM engine timed out after {timeout_s:.0f}s "
            f"(model dir: {model_dir})"
        )
    wall = round(time.time() - start, 2)
    log_tail = "\n".join(tail[-30:])
    if proc.returncode != 0:
        raise RuntimeError(
            f"D-Flow FM engine exited with code {proc.returncode}.\n"
            f"--- engine log tail ---\n{log_tail}"
        )
    return {"returncode": 0, "wall_time_sec": wall, "log_tail": log_tail}


def _progress_from_line(line: str) -> tuple[int, str] | None:
    line = line.strip()
    m = re.search(r"(\d+(?:\.\d+)?)\s*%\s*(?:of|done|completed)", line, re.IGNORECASE)
    if m:
        return int(float(m.group(1))), line[:120]
    m = re.search(r"computed.*?(\d+)\s*/\s*(\d+)", line, re.IGNORECASE)
    if m:
        num, den = int(m.group(1)), int(m.group(2))
        if den > 0:
            return int(num / den * 100), line[:120]
    return None
