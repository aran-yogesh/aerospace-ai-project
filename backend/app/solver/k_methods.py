"""Loss coefficients K computed from geometry, each with its method and source.

Page numbers refer to Crane Technical Paper No. 410, "Flow of Fluids Through Valves, Fittings,
and Pipe", 1988 edition (25th printing). Later editions renumber the appendix; the formulas and
tables are unchanged.
"""

from __future__ import annotations

import bisect
import math
from dataclasses import dataclass
from typing import Literal

from app.solver.friction import fully_turbulent_f

CRANE = "Crane TP-410 (1988)"

# Crane TP-410 p. A-29, "Pipe bends and flanged or butt-welding 90 deg elbows": K = f_T (L/D)eq.
BEND_R_OVER_D = (1.0, 1.5, 2.0, 3.0, 4.0, 6.0, 8.0, 10.0, 12.0, 14.0, 16.0, 20.0)
BEND_L_OVER_D = (20.0, 14.0, 12.0, 12.0, 14.0, 17.0, 24.0, 30.0, 34.0, 38.0, 42.0, 50.0)

M_PER_INCH = 0.0254
# K = 891 d^4 / Cv^2 (d in inches, Cv in US gpm/psi^0.5). Crane TP-410 p. 2-10 writes
# Cv = 29.9 d^2 / sqrt(K), i.e. 894; the spec's 891 matches the exact water-at-60F value (890.4).
CV_CONSTANT = 891.0
# Kv (m^3/h at 1 bar dp, water rho = 1000 kg/m^3): K = 2 dp A^2 / (rho Q^2), exact SI form.
KV_DP_PA = 1.0e5
KV_RHO = 1000.0


@dataclass(frozen=True)
class KResult:
    value: float
    method: str
    source: str


def _bend_l_over_d(r_over_d: float) -> tuple[float, str]:
    """(L/D)eq for a 90 deg bend, linear interpolation in r/d between Crane's table points."""
    if r_over_d <= BEND_R_OVER_D[0] or r_over_d >= BEND_R_OVER_D[-1]:
        clamped = min(max(r_over_d, BEND_R_OVER_D[0]), BEND_R_OVER_D[-1])
        ld = BEND_L_OVER_D[BEND_R_OVER_D.index(clamped)]
        note = "table" if clamped == r_over_d else f"r/d clamped to table end {clamped:g}"
        return ld, note
    i = bisect.bisect_right(BEND_R_OVER_D, r_over_d)
    x0, x1 = BEND_R_OVER_D[i - 1], BEND_R_OVER_D[i]
    y0, y1 = BEND_L_OVER_D[i - 1], BEND_L_OVER_D[i]
    if r_over_d == x0:
        return y0, "table"
    return y0 + (y1 - y0) * (r_over_d - x0) / (x1 - x0), f"interpolated r/d {x0:g}-{x1:g}"


def bend_k(angle_deg: float, r_over_d: float, d_m: float, roughness_m: float) -> KResult:
    """Pipe bend K, Crane TP-410 method (p. A-29, with f_T from p. A-26).

    90 deg: K90 = f_T (L/D)eq, (L/D)eq from Crane's r/d table, linearly interpolated between
    table points (Crane gives only the points). r/d outside 1..20 is clamped to the end value
    and the method string says so.

    Other angles, n = angle / 90:
    - n >= 1: Crane's formula for n 90 deg bends (p. A-29),
      K = (n - 1)(0.25 pi f_T r/d + 0.5 K90) + K90.
    - n < 1: K = n K90. Crane's formula is written for whole 90 deg bends; extended below
      n = 1 it does not reach 0 at 0 deg (at r/d 2 it leaves 37 % of K90 at 0 deg), so we
      scale linearly. That is continuous at 90 deg and close to Crane's own 45/90 elbow ratio
      (16 f_T / 30 f_T = 0.53, p. A-29).

    f_T is the fully turbulent (von Karman) f for this pipe's e/D, so the bend's friction is
    already inside K: the solver must not add Darcy friction over the bend's arc length.
    """
    if not angle_deg > 0:
        raise ValueError(f"bend angle must be > 0, got {angle_deg}")
    if not r_over_d > 0:
        raise ValueError(f"bend r/d must be > 0, got {r_over_d}")
    if not d_m > 0:
        raise ValueError(f"bend diameter must be > 0, got {d_m}")
    f_t = fully_turbulent_f(roughness_m / d_m)
    ld, note = _bend_l_over_d(r_over_d)
    k90 = f_t * ld
    n = angle_deg / 90.0
    if n >= 1.0:
        k = (n - 1.0) * (0.25 * math.pi * f_t * r_over_d + 0.5 * k90) + k90
        angle_rule = "n*90 formula" if n > 1.0 else "K = K90"
    else:
        k = n * k90
        angle_rule = f"scaled n={n:.4g} x K90"
    method = (
        f"Crane bend: f_T={f_t:.5f} x (L/D)eq={ld:.4g} ({note}, r/d={r_over_d:.4g}); "
        f"{angle_deg:g} deg, {angle_rule}"
    )
    return KResult(k, method, f"{CRANE} p. A-29 (bends), p. A-26 (f_T)")


def transition_k(
    d_in_m: float,
    d_out_m: float,
    half_angle_deg: float,
    kind: Literal["contraction", "expansion"],
) -> KResult:
    """Gradual or sudden contraction/expansion K, referenced to the SMALLER diameter.

    Crane TP-410 p. A-26, formulas 1-4, with beta = d_small / d_large and theta the total
    included angle = 2 x half angle. Crane writes K2 (large-pipe velocity) = K1 / beta^4
    (formula 5); we return K1, the small-pipe form:
      contraction, theta <= 45:        K1 = 0.8 sin(theta/2) (1 - beta^2)          (formula 1)
      contraction, 45 < theta <= 180:  K1 = 0.5 sqrt(sin(theta/2)) (1 - beta^2)    (formula 2)
      expansion,   theta <= 45:        K1 = 2.6 sin(theta/2) (1 - beta^2)^2        (formula 3)
      expansion,   45 < theta <= 180:  K1 = (1 - beta^2)^2                         (formula 4)
    Half angle >= 90 deg is a sudden change: theta = 180, which gives 0.5 (1 - beta^2) and the
    Borda-Carnot (1 - beta^2)^2.
    """
    if not (d_in_m > 0 and d_out_m > 0):
        raise ValueError(f"transition diameters must be > 0, got {d_in_m}, {d_out_m}")
    if not half_angle_deg > 0:
        raise ValueError(f"transition half angle must be > 0, got {half_angle_deg}")
    if kind not in ("contraction", "expansion"):
        raise ValueError(f"unknown transition kind {kind!r}")
    if (kind == "contraction") != (d_out_m <= d_in_m) and d_in_m != d_out_m:
        raise ValueError(f"{kind} does not match d_in {d_in_m} -> d_out {d_out_m}")
    beta = min(d_in_m, d_out_m) / max(d_in_m, d_out_m)
    b2 = 1.0 - beta * beta
    sudden = half_angle_deg >= 90.0
    theta = 180.0 if sudden else 2.0 * half_angle_deg
    s = math.sin(math.radians(theta / 2.0))
    if kind == "contraction":
        if theta <= 45.0:
            k, formula = 0.8 * s * b2, "formula 1"
        else:
            k, formula = 0.5 * math.sqrt(s) * b2, "formula 2"
    elif theta <= 45.0:
        k, formula = 2.6 * s * b2 * b2, "formula 3"
    else:
        k, formula = b2 * b2, "formula 4"
    shape = "sudden" if sudden else "gradual"
    method = (
        f"Crane {shape} {kind} {formula}: beta={beta:.4f}, theta={theta:.4g} deg, "
        f"K ref. smaller d={min(d_in_m, d_out_m):.4g} m"
    )
    return KResult(k, method, f"{CRANE} p. A-26 (formulas 1-5)")


def valve_k_from_cv(cv: float, d_m: float) -> KResult:
    """K = 891 d^4 / Cv^2, d in inches (the pipe ID K is referenced to), Cv in US gpm/psi^0.5.

    Crane TP-410 p. 2-10 (flow coefficient, Cv = 29.9 d^2 / sqrt(K)).
    """
    if not (cv > 0 and d_m > 0):
        raise ValueError(f"Cv and diameter must be > 0, got {cv}, {d_m}")
    d_in = d_m / M_PER_INCH
    return KResult(
        CV_CONSTANT * d_in**4 / cv**2,
        f"K = 891 d^4/Cv^2: Cv={cv:g}, d={d_in:.4f} in",
        f"{CRANE} p. 2-10 (Cv)",
    )


def valve_k_from_kv(kv: float, d_m: float) -> KResult:
    """K from metric Kv (m^3/h of water, rho 1000 kg/m^3, at 1 bar dp), exact SI derivation.

    K = 2 dp A^2 / (rho Q^2), Q = Kv / 3600, A = pi d^2 / 4; this is the familiar
    K = 0.0016 d_mm^4 / Kv^2. Same definition basis as Crane TP-410 p. 2-10 (Cv), with
    Kv = 0.865 Cv (IEC 60534-1).
    """
    if not (kv > 0 and d_m > 0):
        raise ValueError(f"Kv and diameter must be > 0, got {kv}, {d_m}")
    area = math.pi * d_m * d_m / 4.0
    q = kv / 3600.0
    return KResult(
        2.0 * KV_DP_PA * area * area / (KV_RHO * q * q),
        f"K = 2 dp A^2/(rho Q^2): Kv={kv:g}, d={d_m * 1000:.4g} mm",
        "IEC 60534-1 Kv definition; Crane TP-410 (1988) p. 2-10",
    )
