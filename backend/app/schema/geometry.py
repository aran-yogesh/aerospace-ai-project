"""Component graph produced by the CAD parser.

This module is the single source of truth for geometry types. The desktop types in
desktop/src/renderer/src/types/geometry.ts are generated from it (`make types`).
All lengths are meters, all angles degrees.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

PARSER_VERSION = "1.0.0"

ComponentId = Annotated[str, Field(pattern=r"^comp_\d+$", examples=["comp_7"])]


class _Base(BaseModel):
    model_config = ConfigDict(extra="forbid", json_schema_serialization_defaults_required=True)

    id: ComponentId
    confidence: float = Field(ge=0, le=1)
    warnings: list[str] = Field(default_factory=list)
    face_ids: list[int] = Field(default_factory=list, description="Indices of wetted B-rep faces.")


class Pipe(_Base):
    type: Literal["pipe"] = "pipe"
    inner_diameter_m: float = Field(gt=0)
    length_m: float = Field(gt=0)


class Bend(_Base):
    type: Literal["bend"] = "bend"
    inner_diameter_m: float = Field(gt=0)
    angle_deg: float = Field(gt=0, le=360)
    bend_radius_m: float = Field(gt=0, description="Centerline radius (torus major radius).")
    r_over_d: float = Field(gt=0, description="bend_radius_m / inner_diameter_m.")


class Transition(_Base):
    type: Literal["transition"] = "transition"
    d_in_m: float = Field(gt=0)
    d_out_m: float = Field(gt=0)
    length_m: float = Field(gt=0, description="Axial length, not slant length.")
    half_angle_deg: float = Field(ge=0, lt=90)
    kind: Literal["contraction", "expansion", "unknown"]


class Valve(_Base):
    type: Literal["valve"] = "valve"
    name: str
    vendor: str | None = None
    valve_type: str | None = None
    cv: float | None = Field(default=None, gt=0)
    part_path: str = Field(description="Assembly path of the part, e.g. /feed_line/valve.")


class Unclassified(_Base):
    type: Literal["unclassified"] = "unclassified"
    name: str
    reason: str
    part_path: str


Component = Annotated[
    Pipe | Bend | Transition | Valve | Unclassified,
    Field(discriminator="type"),
]


class SystemGraph(BaseModel):
    model_config = ConfigDict(extra="forbid", json_schema_serialization_defaults_required=True)

    units: Literal["m"] = "m"
    components: list[Component]
    edges: list[tuple[ComponentId, ComponentId]] = Field(default_factory=list)
    inlet_id: ComponentId | None = None
    outlet_id: ComponentId | None = None
    ordered_path: list[ComponentId] | None = None
    topology: Literal["line", "network", "disconnected"]
    warnings: list[str] = Field(default_factory=list)
    parser_version: str = PARSER_VERSION


class ParseError(BaseModel):
    """Returned by the parser instead of raising. Same shape as API errors."""

    model_config = ConfigDict(extra="forbid", json_schema_serialization_defaults_required=True)

    error: str = Field(examples=["unreadable_step", "timeout", "out_of_memory", "no_solids"])
    detail: str | None = None
