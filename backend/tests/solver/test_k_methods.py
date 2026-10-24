"""K from geometry: Crane bends and transitions, valve Cv/Kv."""

import math

import pytest

from app.solver.friction import fully_turbulent_f
from app.solver.k_methods import bend_k, transition_k, valve_k_from_cv, valve_k_from_kv

E = 1.524e-6


def test_cv_to_k_hand_worked():
    # Cv 6 on a 16 mm bore: d = 16 / 25.4 = 0.629921 in, d^4 = 0.157451,
    # K = 891 * 0.157451 / 6^2 = 140.289 / 36 = 3.8969.
    k = valve_k_from_cv(6.0, 0.016)
    assert k.value == pytest.approx(3.8969, rel=1e-4)
    assert "Crane" in k.source


def test_kv_matches_cv_and_metric_rule():
    # Kv = 0.865 Cv, and K = 0.0016 d_mm^4 / Kv^2 is the usual metric rule.
    assert valve_k_from_kv(0.865 * 6.0, 0.016).value == pytest.approx(
        valve_k_from_cv(6.0, 0.016).value, rel=0.01
    )
    assert valve_k_from_kv(4.0, 0.02).value == pytest.approx(0.0016 * 20**4 / 16, rel=0.002)


@pytest.mark.parametrize(("rd", "ld"), [(1, 20), (1.5, 14), (2, 12), (3, 12), (6, 17), (20, 50)])
def test_bend_90_table_points(rd, ld):
    f_t = fully_turbulent_f(E / 0.012)
    assert bend_k(90, rd, 0.012, E).value == pytest.approx(f_t * ld, rel=1e-12)


def test_bend_interpolation_clamp_and_angles():
    f_t = fully_turbulent_f(E / 0.012)
    assert bend_k(90, 5, 0.012, E).value == pytest.approx(f_t * 15.5, rel=1e-12)  # 4->14, 6->17
    k = bend_k(90, 0.5, 0.012, E)
    assert k.value == pytest.approx(f_t * 20) and "clamped" in k.method
    k90 = f_t * 12
    assert bend_k(45, 2, 0.012, E).value == pytest.approx(0.5 * k90, rel=1e-12)
    # Crane n*90 formula, n = 2: K = (0.25 pi f_T r/d + 0.5 K90) + K90.
    assert bend_k(180, 2, 0.012, E).value == pytest.approx(
        0.25 * math.pi * f_t * 2 + 1.5 * k90, rel=1e-12
    )
    with pytest.raises(ValueError):
        bend_k(0, 2, 0.012, E)


def test_transition_sudden_and_formula_switch():
    beta2 = (0.01 / 0.016) ** 2
    assert transition_k(0.016, 0.01, 90, "contraction").value == pytest.approx(0.5 * (1 - beta2))
    assert transition_k(0.01, 0.016, 90, "expansion").value == pytest.approx((1 - beta2) ** 2)
    s = math.sin(math.radians(20))
    assert transition_k(0.016, 0.01, 20, "contraction").value == pytest.approx(
        0.8 * s * (1 - beta2)
    )
    assert transition_k(0.01, 0.016, 20, "expansion").value == pytest.approx(
        2.6 * s * (1 - beta2) ** 2
    )
    # theta = 60 deg > 45: formula 2 and formula 4.
    s30 = math.sin(math.radians(30))
    k = transition_k(0.016, 0.01, 30, "contraction")
    assert k.value == pytest.approx(0.5 * math.sqrt(s30) * (1 - beta2)) and "formula 2" in k.method
    assert transition_k(0.01, 0.016, 30, "expansion").value == pytest.approx((1 - beta2) ** 2)
    with pytest.raises(ValueError):
        transition_k(0.01, 0.016, 10, "contraction")
