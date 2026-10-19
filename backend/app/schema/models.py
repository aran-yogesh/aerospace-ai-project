from enum import StrEnum
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class KValueMatch(StrEnum):
    exact = "exact"
    family = "family"


class KValue(Model):
    """A loss coefficient and where it came from."""

    value: float = Field(ge=0)
    source: str = Field(min_length=1, description="Constants key or citation.")
    match: KValueMatch


class ComponentKind(StrEnum):
    pipe = "pipe"
    elbow = "elbow"
    tee = "tee"
    valve = "valve"
    reducer = "reducer"
    expander = "expander"
    entrance = "entrance"
    exit = "exit"
    other = "other"


class Component(Model):
    id: UUID = Field(default_factory=uuid4)
    kind: ComponentKind
    label: str
    diameter_m: float | None = Field(default=None, gt=0)
    length_m: float | None = Field(default=None, ge=0)
    k_value: KValue | None = None


class FlowPath(Model):
    id: UUID = Field(default_factory=uuid4)
    name: str
    component_ids: list[UUID] = Field(min_length=1, description="Ordered upstream to downstream.")


class Fluid(Model):
    key: str
    name: str
    density_kg_m3: float = Field(gt=0)
    dynamic_viscosity_pa_s: float = Field(gt=0)
    temperature_c: float | None = None


class SolveStatus(StrEnum):
    ok = "ok"
    approximate = "approximate"
    failed = "failed"


class SolveResult(Model):
    flow_path_id: UUID
    fluid_key: str
    status: SolveStatus
    flow_rate_m3_s: float
    total_pressure_drop_pa: float
    per_component_pressure_drop_pa: dict[UUID, float] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)
    constants_version: str
