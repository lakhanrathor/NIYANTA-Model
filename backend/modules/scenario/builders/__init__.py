"""scenario builders: case1 (risk) and case2 (change event) → shared ScenarioSpec."""

from modules.scenario.builders.case1 import from_risk
from modules.scenario.builders.case2 import from_event

__all__ = ["from_risk", "from_event"]
