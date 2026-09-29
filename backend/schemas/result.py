from __future__ import annotations

from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


class RunMetrics(BaseModel):
    peak_discharge_cms: float = 0.0
    peak_at_hr: float = 0.0
    max_depth_m: float = 0.0
    inundation_km2: float = 0.0
    volume_hm3: float = 0.0
    mass_balance_error_pct: float = 0.0
    duration_hr: float = 0.0


class StationResult(BaseModel):
    km: float
    name: str | None = None
    lon: float | None = None
    lat: float | None = None
    in_domain: bool = True
    peak_cms: float = 0.0
    arrival_hr: float | None = None
    max_stage_m: float = 0.0
    max_depth_m: float = 0.0


class ImpactResult(BaseModel):
    population_exposed: int = 0
    villages_affected: int = 0
    infra: dict[str, float] = Field(default_factory=lambda: {"roads_km": 0.0, "bridges": 0, "hospitals": 0})
    by_village: list[dict[str, Any]] = Field(default_factory=list)


class HazardResult(BaseModel):
    layer_id: str | None = None
    classes: list[str] = Field(default_factory=lambda: ["high", "medium", "low"])


class ExportsResult(BaseModel):
    shp: str | None = None
    kml: str | None = None
    geojson: str | None = None
    geotiff: str | None = None
    csv: str | None = None
    report: str | None = None


class ValidationResult(BaseModel):
    benchmark: str | None = None
    error_peak_pct: float | None = None
    extent_iou: float | None = None
    grade: str | None = None


class RunResult(BaseModel):
    schema_version: str = "1.0"
    run_id: UUID
    scenario_id: UUID
    engine: str
    solver_version: str = "0"
    metrics: RunMetrics = Field(default_factory=RunMetrics)
    rasters: dict[str, str] = Field(default_factory=dict)
    stations: list[StationResult] = Field(default_factory=list)
    series: dict[str, Any] = Field(default_factory=dict)
    impact: ImpactResult = Field(default_factory=ImpactResult)
    hazard: HazardResult = Field(default_factory=HazardResult)
    exports: ExportsResult = Field(default_factory=ExportsResult)
    validation: ValidationResult = Field(default_factory=ValidationResult)
