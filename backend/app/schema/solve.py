"""Solver input/output models shared by the solver, the API and (generated) the desktop.

All values are SI: meters, kg/s, Pa, kg/m^3, Pa*s. The solver (app.solver) takes these
models as arguments and never touches the DB, API or constants loader.
"""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.schema.geometry import ComponentId

KMatch = Literal["exact", "family", "computed", "user", "missing"]
Regime = Literal["laminar", "transitional", "turbulent"]
SegmentType = Literal["pipe", "bend", "transition", "valve", "unclassified"]


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", json_schema_serialization_defaults_required=True)


class Provenanced(_Model):
    """A number with where it came from: a formula, a table entry, or a user input."""

    value: float
    unit: str
    source: str


class FluidProps(_Model):
    name: str
    density_kg_m3: Provenanced
    viscosity_pa_s: Provenanced


class SegmentInput(_Model):
    """One item of ordered_path, ready to solve. Pipes need length; everything else needs a K."""

    component_id: ComponentId
    type: SegmentType
    d_m: float | None = Field(description="Flow diameter for velocity and Re.")
    length_m: float = Field(ge=0, description="Path length along the centerline (plot x).")
    k: float | None = Field(default=None, ge=0, description="Resolved loss coefficient.")
    k_ref_d_m: float | None = Field(default=None, description="Diameter K is referenced to.")
    k_source: str | None = None
    k_match: KMatch | None = None


class SegmentResult(_Model):
    component_id: ComponentId
    type: SegmentType
    d_m: float | None
    velocity_m_s: float | None
    re: float | None
    regime: Regime | None
    f: float | None = Field(description="Darcy friction factor (pipes and bends).")
    k: float | None
    k_source: str | None
    k_match: KMatch | None
    dp_pa: float | None
    p_after_pa: float | None = Field(description="Gauge pressure after this segment, inlet = 0.")
    x_start_m: float
    x_end_m: float
    warnings: list[str] = Field(default_factory=list)


class SolveResult(_Model):
    status: Literal["complete", "incomplete"]
    mode: Literal["dp", "flow"]
    mdot_kg_s: float | None = Field(description="Input in dp mode, solved in flow mode.")
    total_dp_pa: float | None = Field(description="Only present when status is complete.")
    segments: list[SegmentResult]
    missing: list[ComponentId] = Field(default_factory=list, description="Why it's incomplete.")
    warnings: list[str] = Field(default_factory=list)
    solver_version: str


# ---------------------------------------------------------------------------------------
# REST models for setup, resolve, datasets and solve runs (owned by the API).
# ---------------------------------------------------------------------------------------

FluidKind = Literal["coolprop", "table", "custom"]
FluidGroup = Literal["CRYOGENIC", "PROPELLANT", "REFERENCE", "CUSTOM"]
SolveMode = Literal["dp", "flow"]
PositiveFloat = Annotated[float, Field(gt=0, allow_inf_nan=False)]


class _Api(BaseModel):
    model_config = ConfigDict(
        from_attributes=True, json_schema_serialization_defaults_required=True
    )


class FluidInfo(_Api):
    name: str
    kind: FluidKind
    group: FluidGroup
    t_min_k: float | None
    t_max_k: float | None
    source: str


class FluidList(_Api):
    items: list[FluidInfo]


class MaterialInfo(_Api):
    key: str
    label: str
    roughness_m: float
    source: str


class MaterialList(_Api):
    version: str
    items: list[MaterialInfo]


class FluidIn(_Model):
    kind: FluidKind
    name: str = Field(min_length=1, max_length=100)
    temperature_k: PositiveFloat | None = None
    pressure_pa: PositiveFloat | None = None
    density_kg_m3: PositiveFloat | None = Field(default=None, description="Custom fluid only.")
    viscosity_pa_s: PositiveFloat | None = Field(default=None, description="Custom fluid only.")


class KOverride(_Model):
    value: Annotated[float, Field(ge=0, allow_inf_nan=False)]
    note: str | None = Field(default=None, max_length=500)


class SetupIn(_Model):
    fluid: FluidIn
    material_key: str
    k_overrides: dict[ComponentId, KOverride | Literal["no_loss"]] = Field(default_factory=dict)


class PropsError(_Api):
    error: Literal["not_liquid", "out_of_range", "unknown_fluid", "invalid_input"]
    detail: str


class DatasetRef(_Api):
    id: UUID
    short_hash: str
    content_hash: str
    created_at: datetime
    stale: bool


class SetupView(SetupIn):
    updated_at: datetime | None = Field(description="Null until the setup is first saved.")
    props: FluidProps | None
    roughness: Provenanced | None
    props_error: PropsError | None
    latest_dataset: DatasetRef | None


class KRow(_Model):
    component_id: ComponentId
    type: SegmentType
    label: str
    k: float | None
    k_ref_d_m: float | None
    method: str | None
    source: str | None
    match: KMatch
    verified: bool | None = Field(description="Table entries only: has Rohith verified it?")
    note: str | None


class KCounts(_Api):
    computed: int
    exact: int
    family: int
    user: int
    missing: int


class ResolveResult(_Api):
    rows: list[KRow] = Field(description="Path order.")
    counts: KCounts


class ConstantsVersions(_Model):
    k_values: str
    materials: str
    fluids: str


class Dataset(_Api):
    id: UUID
    file_id: UUID
    content_hash: str
    short_hash: str = Field(description="First 4 hex digits of content_hash, upper case.")
    created_at: datetime
    stale: bool
    graph_hash: str
    setup: SetupIn
    resolved_k: list[KRow]
    segments: list[SegmentInput]
    fluid_props: FluidProps
    roughness: Provenanced
    constants_versions: ConstantsVersions
    solver_version: str


class SolveIn(_Model):
    mode: SolveMode = Field(description="dp: input is mdot in kg/s. flow: input is dP in Pa.")
    value: PositiveFloat


class SolveRun(_Api):
    id: UUID
    dataset_id: UUID
    mode: SolveMode
    input_value: float
    status: Literal["complete", "incomplete"]
    result: SolveResult
    runtime_ms: float
    created_at: datetime


SOLVE_API_MODELS: tuple[type[BaseModel], ...] = (
    FluidList,
    MaterialList,
    SetupIn,
    SetupView,
    ResolveResult,
    Dataset,
    SolveIn,
    SolveRun,
)
