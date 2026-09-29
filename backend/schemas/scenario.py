from __future__ import annotations

from typing import Any, Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, Field


class AOI(BaseModel):
    type: Literal["bbox", "polygon"] = "bbox"
    crs: str = "EPSG:4326"
    coords: list[Any] = Field(default_factory=list)

    def bbox_4326(self) -> tuple[float, float, float, float] | None:
        """Return (minx, miny, maxx, maxy) if derivable."""
        c = self.coords
        if not c:
            return None
        if self.type == "bbox" and len(c) == 4:
            return (float(c[0]), float(c[1]), float(c[2]), float(c[3]))
        if self.type == "polygon":
            xs: list[float] = []
            ys: list[float] = []
            ring = c[0] if c and isinstance(c[0][0], (list, tuple)) else c
            for pt in ring:
                xs.append(float(pt[0]))
                ys.append(float(pt[1]))
            if xs:
                return (min(xs), min(ys), max(xs), max(ys))
        return None


class BreachTiming(BaseModel):
    start_iso: str | None = None
    instantaneous: bool = False


class BreachSpec(BaseModel):
    mode: Literal["piping", "overtopping", "attack", "blockage_breach"] = "overtopping"
    chainage_m: float = 0.0
    width_m: float = 0.0
    depth_m: float = 0.0
    side_slope: float = 0.7
    formation_time_hr: float = 0.0
    method: Literal[
        "froehlich2008", "froehlich1995", "vonthun", "xuzhang", "macdonald", "manual"
    ] = "froehlich2008"
    timing: BreachTiming = Field(default_factory=BreachTiming)


class ReservoirSpec(BaseModel):
    initial_level_m: float = 0.0
    crest_level_m: float | None = None
    bed_level_m: float | None = None
    dam_height_m: float | None = None
    storage_mcm: float = 0.0
    area_km2: float = 0.0
    inflow_hydrograph_ref: str | None = None
    inflow_cms: float = 0.0


class BoundarySpec(BaseModel):
    upstream: dict[str, Any] = Field(default_factory=dict)
    downstream: dict[str, Any] = Field(default_factory=lambda: {"type": "normal_depth", "slope": 0.0004})


class HorizonSpec(BaseModel):
    dt_s: float = 0.0
    duration_hr: float = 24.0


class ImpactSpec(BaseModel):
    """Impact numbers the Build page records. source='manual' means the run
    reports these instead of the modelled totals (see modules.run.work_impact)."""

    source: Literal["worldpop", "manual"] = "worldpop"
    population: int | None = None
    houses: int | None = None
    assets_million: float | None = None


class Provenance(BaseModel):
    producer: str = "scenario"
    trigger: Literal["manual", "f1", "f2", "f3", "auto"] = "manual"
    inputs: list[str] = Field(default_factory=list)


class ScenarioSpec(BaseModel):
    """The single convergence contract: all 3 cases produce exactly this."""

    schema_version: str = "1.0"
    scenario_id: UUID = Field(default_factory=uuid4)
    case: Literal["1", "2", "3"]
    name: str | None = None
    aoi: AOI = Field(default_factory=AOI)
    terrain_ref: str | None = None
    dam_type: Literal["corewall", "concrete_faced", "homogeneous"] = "homogeneous"
    erodibility: Literal["high", "medium", "low"] = "medium"
    breach: BreachSpec = Field(default_factory=BreachSpec)
    reservoir: ReservoirSpec = Field(default_factory=ReservoirSpec)
    boundary: BoundarySpec = Field(default_factory=BoundarySpec)
    engine: Literal["fast", "delft3d", "sph", "hecras"] = "fast"
    horizon: HorizonSpec = Field(default_factory=HorizonSpec)
    impact: ImpactSpec = Field(default_factory=ImpactSpec)
    provenance: Provenance = Field(default_factory=Provenance)
    dam_id: UUID | None = None
    stations_km: list[float] = Field(default_factory=lambda: [0.0, 5.0, 10.0, 15.0, 20.0])
    benchmark: str | None = None
