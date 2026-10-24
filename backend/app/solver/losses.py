"""Pressure loss of one segment, SI units.

- Pipe: Darcy-Weisbach, dp = f (L/D) rho v^2 / 2, with f from Churchill (1977).
- Minor loss: dp = K rho v^2 / 2, v taken at the diameter K is referenced to
  (Crane TP-410, Chapter 2, "Resistance coefficient K", p. 2-8 of the 1988 ed.).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from app.schema.solve import Regime
from app.solver.friction import churchill_f, regime


@dataclass(frozen=True)
class PipeLoss:
    velocity_m_s: float
    re: float
    regime: Regime
    f: float
    dp_pa: float


@dataclass(frozen=True)
class MinorLoss:
    velocity_m_s: float
    dp_pa: float


def velocity(d_m: float, rho: float, mdot: float) -> float:
    """Mean velocity v = mdot / (rho * pi D^2 / 4)."""
    return mdot / (rho * math.pi * d_m * d_m / 4.0)


def reynolds(d_m: float, mu: float, mdot: float) -> float:
    """Re = rho v D / mu = 4 mdot / (pi D mu)."""
    return 4.0 * mdot / (math.pi * d_m * mu)


def pipe_dp(
    length_m: float, d_m: float, roughness_m: float, rho: float, mu: float, mdot: float
) -> PipeLoss:
    """Straight pipe friction loss, Darcy-Weisbach with the Churchill (1977) friction factor."""
    v = velocity(d_m, rho, mdot)
    re = reynolds(d_m, mu, mdot)
    f = churchill_f(re, roughness_m / d_m)
    return PipeLoss(v, re, regime(re), f, f * (length_m / d_m) * rho * v * v / 2.0)


def minor_dp(k: float, d_ref_m: float, rho: float, mdot: float) -> MinorLoss:
    """Minor loss dp = K rho v^2 / 2 with v at the reference diameter (Crane TP-410 p. 2-8)."""
    v = velocity(d_ref_m, rho, mdot)
    return MinorLoss(v, k * rho * v * v / 2.0)
