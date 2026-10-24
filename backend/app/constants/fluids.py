"""Fluid properties: CoolProp (liquid only), interpolated tables, or user-entered custom.

fluid_props() never raises for a bad state point; it returns a PropsError
(not_liquid | out_of_range | unknown_fluid | invalid_input) so the API can show it inline.
"""

from bisect import bisect_right
from functools import lru_cache

import CoolProp
import CoolProp.CoolProp as CP

from app.constants import Constants
from app.schema.solve import FluidIn, FluidInfo, FluidProps, PropsError, Provenanced

# CoolProp phases that are liquid: below Tc, at or above saturation pressure.
LIQUID_PHASES = frozenset({"liquid", "supercritical_liquid"})


@lru_cache
def coolprop_range(name: str) -> tuple[float, float]:
    """Valid liquid temperatures: triple point to critical point."""
    return round(CP.PropsSI("Ttriple", name), 3), round(CP.PropsSI("Tcrit", name), 3)


def list_fluids(constants: Constants) -> list[FluidInfo]:
    src = f"CoolProp {CoolProp.__version__} (HEOS)"
    items = [
        FluidInfo(
            name=name,
            kind="coolprop",
            group=group,
            t_min_k=coolprop_range(name)[0],
            t_max_k=coolprop_range(name)[1],
            source=src,
        )
        for name, group in constants.fluids.coolprop.items()
    ]
    items += [
        FluidInfo(
            name=name,
            kind="table",
            group=t.group,
            t_min_k=t.points[0].t_k,
            t_max_k=t.points[-1].t_k,
            source=t.source,
        )
        for name, t in constants.fluids.tables.items()
    ]
    items.append(
        FluidInfo(
            name="Custom", kind="custom", group="CUSTOM", t_min_k=None, t_max_k=None, source="user"
        )
    )
    return items


def _props(name: str, rho: float, mu: float, source: str) -> FluidProps:
    return FluidProps(
        name=name,
        density_kg_m3=Provenanced(value=rho, unit="kg/m^3", source=source),
        viscosity_pa_s=Provenanced(value=mu, unit="Pa*s", source=source),
    )


def fluid_props(fluid: FluidIn, constants: Constants) -> FluidProps | PropsError:
    if fluid.kind == "custom":
        if fluid.density_kg_m3 is None or fluid.viscosity_pa_s is None:
            detail = "Custom fluid needs density and viscosity."
            return PropsError(error="invalid_input", detail=detail)
        return _props(fluid.name, fluid.density_kg_m3, fluid.viscosity_pa_s, "user")

    t = fluid.temperature_k
    if t is None:
        return PropsError(error="invalid_input", detail="Temperature is required.")

    if fluid.kind == "table":
        table = constants.fluids.tables.get(fluid.name)
        if table is None:
            return PropsError(error="unknown_fluid", detail=f"No table fluid named {fluid.name!r}.")
        pts = table.points
        if not pts[0].t_k <= t <= pts[-1].t_k:
            return PropsError(
                error="out_of_range",
                detail=f"{fluid.name} table covers {pts[0].t_k} to {pts[-1].t_k} K; got {t} K.",
            )
        i = min(bisect_right([p.t_k for p in pts], t), len(pts) - 1)
        a, b = pts[i - 1], pts[i]
        w = (t - a.t_k) / (b.t_k - a.t_k)
        src = f"{table.source}; linear interpolation at {t} K (fluids {constants.fluids.version})"
        return _props(
            fluid.name,
            a.density_kg_m3 + w * (b.density_kg_m3 - a.density_kg_m3),
            a.viscosity_pa_s + w * (b.viscosity_pa_s - a.viscosity_pa_s),
            src,
        )

    if fluid.name not in constants.fluids.coolprop:
        return PropsError(error="unknown_fluid", detail=f"No CoolProp fluid named {fluid.name!r}.")
    p = fluid.pressure_pa
    if p is None:
        return PropsError(error="invalid_input", detail="Pressure is required.")
    t_min, t_max = coolprop_range(fluid.name)
    if not t_min <= t <= t_max:
        return PropsError(
            error="out_of_range",
            detail=f"{fluid.name} liquid exists from {t_min} K (triple) to {t_max} K "
            f"(critical); got {t} K.",
        )
    p_max = CP.PropsSI("pmax", fluid.name)
    if p > p_max:
        return PropsError(
            error="out_of_range", detail=f"{fluid.name}: CoolProp is valid up to {p_max} Pa."
        )
    try:
        phase = CP.PhaseSI("T", t, "P", p, fluid.name)
        if phase not in LIQUID_PHASES:
            return PropsError(
                error="not_liquid", detail=f"{fluid.name} at {t} K, {p} Pa is {phase}, not liquid."
            )
        rho = CP.PropsSI("D", "T", t, "P", p, fluid.name)
        mu = CP.PropsSI("V", "T", t, "P", p, fluid.name)
    except ValueError as exc:
        return PropsError(error="out_of_range", detail=f"CoolProp: {exc}")
    src = f"CoolProp {CoolProp.__version__} (HEOS) at {t} K, {p} Pa"
    return _props(fluid.name, rho, mu, src)
