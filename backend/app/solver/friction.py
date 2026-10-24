"""Darcy friction factor and flow regime.

Pure functions, SI units. Sources:
- S. W. Churchill, "Friction-factor equation spans all fluid-flow regimes",
  Chemical Engineering 84(24), 91-92 (1977).
- T. von Karman (1930) fully rough law, as used for Crane TP-410's f_T
  (Crane TP-410, "friction factor for clean commercial steel pipe with flow in the zone of
  complete turbulence", p. A-26 of the 1988 edition).
"""

from __future__ import annotations

import math

from app.schema.solve import Regime

RE_LAMINAR_MAX = 2300.0
RE_TURBULENT_MIN = 4000.0


def regime(re: float) -> Regime:
    """Laminar below Re 2300, transitional 2300 to 4000 inclusive, turbulent above 4000."""
    if re < RE_LAMINAR_MAX:
        return "laminar"
    if re <= RE_TURBULENT_MIN:
        return "transitional"
    return "turbulent"


def churchill_f(re: float, rel_roughness: float) -> float:
    """Darcy friction factor from Churchill (1977), one formula for every regime.

    f = 8 [ (8/Re)^12 + (A + B)^-1.5 ]^(1/12)
    A = [ 2.457 ln( 1 / ((7/Re)^0.9 + 0.27 e/D) ) ]^16
    B = (37530 / Re)^16

    In the laminar limit it tends to 64/Re (Hagen-Poiseuille); it matches 64/Re to 1e-9 for
    Re <= 1000 and departs by ~0.1 % at Re 2000, where the turbulent term starts to blend in.
    In the turbulent limit it follows Colebrook within ~1 %.
    """
    if not re > 0:
        raise ValueError(f"Reynolds number must be > 0, got {re}")
    if rel_roughness < 0:
        raise ValueError(f"relative roughness must be >= 0, got {rel_roughness}")
    a = (2.457 * math.log(1.0 / ((7.0 / re) ** 0.9 + 0.27 * rel_roughness))) ** 16
    b = (37530.0 / re) ** 16
    return 8.0 * ((8.0 / re) ** 12 + (a + b) ** -1.5) ** (1.0 / 12.0)


def fully_turbulent_f(rel_roughness: float) -> float:
    """Fully rough (zone of complete turbulence) Darcy f, von Karman: 1/sqrt(f) = -2 log10(e/3.7D).

    This is Crane TP-410's f_T (p. A-26, 1988 ed.), computed for the actual pipe material
    instead of read from Crane's commercial-steel table. Needs e/D > 0: a perfectly smooth
    pipe has no fully rough zone and the law would return 0 (a silent zero), so it raises.
    """
    if not rel_roughness > 0:
        raise ValueError(f"relative roughness must be > 0 for f_T, got {rel_roughness}")
    return 0.25 / math.log10(rel_roughness / 3.7) ** 2
