"""Versioned constants from data/constants/*.yaml (K values, materials, fluids).

Every file is validated with Pydantic on load; get_constants() is called from create_app(),
so an invalid file stops the app from starting instead of producing wrong numbers later.
"""

from functools import lru_cache
from itertools import pairwise
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from app.core.config import get_settings
from app.schema.solve import FluidGroup

KFamily = Literal[
    "valve_ball",
    "valve_globe",
    "valve_gate",
    "valve_check_swing",
    "valve_butterfly",
    "elbow_90",
    "elbow_45",
    "tee_run",
    "tee_branch",
    "entrance",
    "exit",
    "orifice",
]
CoolPropFluid = Literal["Water", "Oxygen", "Nitrogen", "Hydrogen", "Methane"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class KEntry(_Strict):
    value: float = Field(ge=0)
    family: KFamily
    source: str = Field(min_length=1)
    status: Literal["verified", "unverified"]
    notes: str | None = None


class KTable(_Strict):
    version: str = Field(min_length=1)
    entries: dict[str, KEntry] = Field(min_length=1)


class Material(_Strict):
    label: str = Field(min_length=1)
    roughness_m: float = Field(ge=0, lt=0.01)
    source: str = Field(min_length=1)


class Materials(_Strict):
    version: str = Field(min_length=1)
    entries: dict[str, Material] = Field(min_length=1)


class TablePoint(_Strict):
    t_k: float = Field(gt=0)
    density_kg_m3: float = Field(gt=0)
    viscosity_pa_s: float = Field(gt=0)


class TableFluid(_Strict):
    group: FluidGroup
    status: Literal["verified", "unverified"]
    source: str = Field(min_length=1)
    points: list[TablePoint] = Field(min_length=2)

    @model_validator(mode="after")
    def _increasing(self) -> "TableFluid":
        ts = [p.t_k for p in self.points]
        if any(b <= a for a, b in pairwise(ts)):
            raise ValueError("points must be strictly increasing in t_k")
        return self


class Fluids(_Strict):
    version: str = Field(min_length=1)
    coolprop: dict[CoolPropFluid, FluidGroup]
    tables: dict[str, TableFluid] = Field(default_factory=dict)


class Constants(_Strict):
    k_values: KTable
    materials: Materials
    fluids: Fluids

    def versions(self) -> dict[str, str]:
        return {
            "k_values": self.k_values.version,
            "materials": self.materials.version,
            "fluids": self.fluids.version,
        }


class ConstantsError(RuntimeError):
    """A constants file is missing or invalid. Raised at startup."""


def _read[M: BaseModel](path: Path, model: type[M]) -> M:
    try:
        return model.model_validate(yaml.safe_load(path.read_text()))
    except (OSError, yaml.YAMLError, ValidationError) as exc:
        raise ConstantsError(f"invalid constants file {path}: {exc}") from exc


def load(directory: Path) -> Constants:
    return Constants(
        k_values=_read(directory / "k_values.yaml", KTable),
        materials=_read(directory / "materials.yaml", Materials),
        fluids=_read(directory / "fluids.yaml", Fluids),
    )


@lru_cache
def get_constants() -> Constants:
    return load(get_settings().data_dir / "constants")
