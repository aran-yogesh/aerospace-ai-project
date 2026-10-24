"""Line solver: pressure drop from flow (forward) and flow from pressure drop (inverse).

Pure functions over app.schema.solve models, SI units, no I/O. Segment semantics:
- pipe: Darcy-Weisbach with Churchill f over length_m at d_m; any k is ignored.
- bend: its resolved K only (Crane f_T (L/D)eq already includes the bend's friction);
  f reports f_T for the pipe's e/D.
- transition, valve, unclassified: K only, v at k_ref_d_m (falls back to d_m).
No silent zeros: a segment without a diameter, or a non-pipe without K, makes the result
"incomplete" with those ids in `missing` and no total.
Pressure: p_after_pa is gauge relative to the inlet (inlet = 0 Pa), so it is negative and
falls along the path: p_after = -(sum of dp up to and including this segment). It is None from
the first segment whose dp is unknown onward.
"""

from __future__ import annotations

import math

from scipy.optimize import brentq

from app.schema.solve import FluidProps, SegmentInput, SegmentResult, SolveResult
from app.solver.friction import fully_turbulent_f, regime
from app.solver.losses import minor_dp, pipe_dp, reynolds, velocity

SOLVER_VERSION = "1.0.0"

ELEVATION_WARNING = "elevation ignored: hydrostatic head is not included in this phase"
V_HIGH_M_S = 30.0
RE_LOW = 100.0
INVERSE_MAXITER = 100
_BRACKET_STEPS = 40


def _check(fluid: FluidProps, roughness_m: float) -> tuple[float, float]:
    rho, mu = fluid.density_kg_m3.value, fluid.viscosity_pa_s.value
    if not (math.isfinite(rho) and rho > 0 and math.isfinite(mu) and mu > 0):
        raise ValueError(f"fluid density and viscosity must be > 0, got {rho}, {mu}")
    if not (math.isfinite(roughness_m) and roughness_m >= 0):
        raise ValueError(f"roughness must be >= 0, got {roughness_m}")
    return rho, mu


def _lacks(seg: SegmentInput) -> bool:
    return seg.d_m is None or not seg.d_m > 0 or (seg.type != "pipe" and seg.k is None)


def _missing(segments: list[SegmentInput]) -> list[str]:
    return [s.component_id for s in segments if _lacks(s)]


def _warnings(seg: SegmentInput, re: float, v: float) -> list[str]:
    out = []
    reg = regime(re)
    if reg == "transitional":
        out.append(f"transitional flow (Re {re:.0f}): friction factor is uncertain")
    if re < RE_LOW:
        out.append(f"very low Reynolds number (Re {re:.3g})")
    if reg == "laminar" and seg.type != "pipe":
        out.append("laminar flow: K values assume turbulent flow")
    if v > V_HIGH_M_S:
        out.append(f"high velocity {v:.1f} m/s (> {V_HIGH_M_S:g} m/s)")
    if seg.type != "pipe" and seg.k_match == "family":
        out.append("approximate K (family match, unverified)")
    return out


def _evaluate(
    segments: list[SegmentInput],
    rho: float,
    mu: float,
    roughness_m: float,
    mdot: float | None,
    mode: str,
) -> SolveResult:
    missing = _missing(segments)
    results: list[SegmentResult] = []
    x = 0.0
    p: float | None = 0.0
    total = 0.0
    for seg in segments:
        x0, x = x, x + seg.length_m
        is_pipe = seg.type == "pipe"
        row = {
            "component_id": seg.component_id,
            "type": seg.type,
            "d_m": seg.d_m,
            "velocity_m_s": None,
            "re": None,
            "regime": None,
            "f": None,
            "k": None if is_pipe else seg.k,
            "k_source": None if is_pipe else seg.k_source,
            "k_match": None if is_pipe else seg.k_match,
            "dp_pa": None,
            "p_after_pa": None,
            "x_start_m": x0,
            "x_end_m": x,
            "warnings": [],
        }
        if _lacks(seg):
            row["warnings"] = ["missing diameter" if not (seg.d_m or 0) > 0 else "missing K"]
            p = None
        elif mdot is not None:
            d = seg.d_m
            v, re = velocity(d, rho, mdot), reynolds(d, mu, mdot)
            if is_pipe:
                loss = pipe_dp(seg.length_m, d, roughness_m, rho, mu, mdot)
                f, dp = loss.f, loss.dp_pa
            else:
                dp = minor_dp(seg.k, seg.k_ref_d_m or d, rho, mdot).dp_pa
                f = (
                    fully_turbulent_f(roughness_m / d)
                    if seg.type == "bend" and roughness_m > 0
                    else None
                )
            total += dp
            p = None if p is None else p - dp
            row.update(
                velocity_m_s=v,
                re=re,
                regime=regime(re),
                f=f,
                dp_pa=dp,
                p_after_pa=p,
                warnings=_warnings(seg, re, v),
            )
        results.append(SegmentResult(**row))
    complete = not missing and mdot is not None
    return SolveResult(
        status="complete" if complete else "incomplete",
        mode=mode,
        mdot_kg_s=mdot,
        total_dp_pa=total if complete else None,
        segments=results,
        missing=missing,
        warnings=[ELEVATION_WARNING],
        solver_version=SOLVER_VERSION,
    )


def solve_forward(
    segments: list[SegmentInput], fluid: FluidProps, roughness_m: float, mdot_kg_s: float
) -> SolveResult:
    """Pressure drop along the line for a given mass flow (mode "dp").

    Raises ValueError if mdot <= 0 or the fluid/roughness is invalid (the API maps it to 422).
    """
    rho, mu = _check(fluid, roughness_m)
    if not (math.isfinite(mdot_kg_s) and mdot_kg_s > 0):
        raise ValueError(f"mass flow must be > 0, got {mdot_kg_s}")
    return _evaluate(segments, rho, mu, roughness_m, mdot_kg_s, "dp")


def solve_inverse(
    segments: list[SegmentInput], fluid: FluidProps, roughness_m: float, dp_target_pa: float
) -> SolveResult:
    """Mass flow that gives total dp = dp_target (mode "flow").

    Brent's method (scipy.optimize.brentq) on mdot, max 100 iterations, rtol 1e-12. The
    bracket starts at [1, 1] kg/s and expands by decades until it brackets the target (dp is
    strictly increasing in mdot). If a segment is missing, returns "incomplete" with no flow
    and no total, without solving. Raises ValueError if dp_target <= 0 (API: 422), if the line
    has no loss to match, or if no bracket is found.
    """
    rho, mu = _check(fluid, roughness_m)
    if not (math.isfinite(dp_target_pa) and dp_target_pa > 0):
        raise ValueError(f"pressure drop target must be > 0, got {dp_target_pa}")
    if _missing(segments):
        return _evaluate(segments, rho, mu, roughness_m, None, "flow")

    def g(m: float) -> float:
        return _evaluate(segments, rho, mu, roughness_m, m, "flow").total_dp_pa - dp_target_pa

    lo = hi = 1.0
    try:
        for _ in range(_BRACKET_STEPS):
            if g(lo) <= 0:
                break
            lo /= 10.0
        for _ in range(_BRACKET_STEPS):
            if g(hi) >= 0:
                break
            hi *= 10.0
    except OverflowError as e:
        raise ValueError(f"pressure drop target {dp_target_pa} Pa is out of range") from e
    if not (g(lo) <= 0 <= g(hi)):
        raise ValueError(f"could not bracket a flow for {dp_target_pa} Pa (line has no loss?)")
    mdot = brentq(g, lo, hi, xtol=1e-300, rtol=1e-12, maxiter=INVERSE_MAXITER)
    return _evaluate(segments, rho, mu, roughness_m, mdot, "flow")
