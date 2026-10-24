"""Churchill friction factor against Hagen-Poiseuille and Colebrook; regime thresholds."""

import math

import pytest

from app.solver.friction import churchill_f, fully_turbulent_f, regime
from app.solver.losses import pipe_dp

RHO, MU = 998.2, 1.0016e-3


@pytest.mark.parametrize("re", [1.0, 10.0, 100.0, 500.0, 1000.0])
def test_laminar_pipe_equals_hagen_poiseuille(re):
    d, length = 0.01, 2.0
    mdot = re * math.pi * d * MU / 4.0
    q = mdot / RHO
    hagen_poiseuille = 128.0 * MU * length * q / (math.pi * d**4)
    got = pipe_dp(length, d, 1.524e-6, RHO, MU, mdot)
    assert got.re == pytest.approx(re, rel=1e-12)
    assert got.dp_pa == pytest.approx(hagen_poiseuille, rel=1e-9)


def colebrook(re: float, rr: float) -> float:
    x = 0.02
    for _ in range(200):
        x = (-2.0 * math.log10(rr / 3.7 + 2.51 / (re * math.sqrt(x)))) ** -2
    return x


RE_GRID = [10 ** (4 + i / 20) for i in range(61)]  # 1e4 .. 1e7


@pytest.mark.parametrize("rr", [1e-6, 1e-4, 1e-3])
def test_turbulent_within_1pct_of_colebrook(rr):
    for re in RE_GRID:
        assert churchill_f(re, rr) == pytest.approx(colebrook(re, rr), rel=0.01), re


def test_rough_small_bore_within_2_5pct_of_colebrook():
    # Churchill drifts from Colebrook for very rough pipe near Re 1e4 (1.9 % at e/D 5e-3,
    # e.g. commercial steel in a 10 mm bore; 2.1 % at e/D 1e-2). Documented in ADR 0005.
    for re in RE_GRID:
        assert churchill_f(re, 1e-2) == pytest.approx(colebrook(re, 1e-2), rel=0.025), re


def test_regime_thresholds():
    assert regime(2299.9) == "laminar"
    assert regime(2300) == "transitional"
    assert regime(4000) == "transitional"
    assert regime(4000.1) == "turbulent"


def test_fully_turbulent_f_is_colebrook_limit():
    assert fully_turbulent_f(1e-3) == pytest.approx(colebrook(1e12, 1e-3), rel=1e-6)
    with pytest.raises(ValueError):
        fully_turbulent_f(0.0)
    with pytest.raises(ValueError):
        churchill_f(0.0, 1e-4)
