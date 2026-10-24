"""solve_forward / solve_inverse: no silent zeros, warnings, determinism, round trips."""

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from app.schema.solve import FluidProps, Provenanced, SegmentInput
from app.solver import solve_forward, solve_inverse
from app.solver.solve import ELEVATION_WARNING

E = 1.524e-6
WATER = FluidProps(
    name="Water",
    density_kg_m3=Provenanced(value=998.2, unit="kg/m^3", source="test"),
    viscosity_pa_s=Provenanced(value=1.0016e-3, unit="Pa*s", source="test"),
)


def line(valve_k: float | None = 3.9, match: str = "computed") -> list[SegmentInput]:
    return [
        SegmentInput(component_id="comp_0", type="pipe", d_m=0.016, length_m=0.15),
        SegmentInput(
            component_id="comp_1", type="bend", d_m=0.016, length_m=0.05, k=0.2, k_ref_d_m=0.016
        ),
        SegmentInput(
            component_id="comp_2",
            type="valve",
            d_m=0.016,
            length_m=0.0,
            k=valve_k,
            k_ref_d_m=0.016,
            k_match=match if valve_k is not None else "missing",
        ),
        SegmentInput(component_id="comp_3", type="pipe", d_m=0.01, length_m=0.2),
    ]


def test_forward_complete_cumulative_pressure_and_x():
    r = solve_forward(line(), WATER, E, 0.2)
    assert r.status == "complete" and r.missing == []
    dps = [s.dp_pa for s in r.segments]
    assert r.total_dp_pa == pytest.approx(sum(dps))
    p = 0.0
    for s, dp in zip(r.segments, dps, strict=True):
        p -= dp
        assert s.p_after_pa == pytest.approx(p) and s.p_after_pa < 0
    assert [s.x_end_m for s in r.segments] == pytest.approx([0.15, 0.2, 0.2, 0.4])
    assert r.segments[0].f is not None and r.segments[0].k is None
    assert r.segments[1].f is not None  # bend reports f_T
    assert ELEVATION_WARNING in r.warnings


def test_incomplete_has_no_total_and_lists_missing():
    r = solve_forward(line(valve_k=None), WATER, E, 0.2)
    assert r.status == "incomplete" and r.total_dp_pa is None and r.missing == ["comp_2"]
    assert r.segments[2].dp_pa is None and r.segments[3].p_after_pa is None
    assert r.segments[3].dp_pa is not None  # known segments still shown
    inv = solve_inverse(line(valve_k=None), WATER, E, 1e5)
    assert inv.status == "incomplete" and inv.total_dp_pa is None and inv.mdot_kg_s is None


@given(st.lists(st.booleans(), min_size=1, max_size=6), st.floats(1e-4, 5.0))
def test_incomplete_never_has_total(has_k, mdot):
    segs = [
        SegmentInput(
            component_id=f"comp_{i}", type="valve", d_m=0.012, length_m=0, k=1.0 if ok else None
        )
        for i, ok in enumerate(has_k)
    ]
    r = solve_forward(segs, WATER, E, mdot)
    assert (r.status == "complete") == all(has_k)
    if r.status == "incomplete":
        assert r.total_dp_pa is None and r.missing


def test_warnings():
    fam = solve_forward(line(match="family"), WATER, E, 0.2)
    assert any("approximate K" in w for w in fam.segments[2].warnings)
    # mdot giving Re ~3000 in the 16 mm pipe: transitional.
    trans = solve_forward(line(), WATER, E, 3000 * 3.14159 * 0.016 * 1.0016e-3 / 4)
    assert any("transitional" in w for w in trans.segments[0].warnings)
    slow = solve_forward(line(), WATER, E, 1e-6)
    assert any("very low Reynolds" in w for w in slow.segments[0].warnings)
    assert any("laminar flow: K" in w for w in slow.segments[1].warnings)
    fast = solve_forward(line(), WATER, E, 3.0)
    assert any("high velocity" in w for w in fast.segments[3].warnings)


def test_bad_inputs_raise():
    with pytest.raises(ValueError):
        solve_forward(line(), WATER, E, 0.0)
    with pytest.raises(ValueError):
        solve_inverse(line(), WATER, E, 0.0)
    with pytest.raises(ValueError):
        solve_inverse(line(), WATER, E, -5.0)


def test_deterministic_bit_identical():
    a = solve_forward(line(), WATER, E, 0.2).model_dump_json()
    assert all(solve_forward(line(), WATER, E, 0.2).model_dump_json() == a for _ in range(5))
    b = solve_inverse(line(), WATER, E, 12345.0).model_dump_json()
    assert solve_inverse(line(), WATER, E, 12345.0).model_dump_json() == b


@given(st.floats(1e-5, 5.0), st.floats(1.0001, 3.0))
def test_dp_strictly_increases_with_mdot(m, factor):
    lo = solve_forward(line(), WATER, E, m).total_dp_pa
    hi = solve_forward(line(), WATER, E, m * factor).total_dp_pa
    assert hi > lo


@settings(max_examples=50, deadline=None)
@given(st.floats(1e-5, 5.0))
def test_inverse_recovers_forward(m):
    total = solve_forward(line(), WATER, E, m).total_dp_pa
    inv = solve_inverse(line(), WATER, E, total)
    assert inv.mode == "flow" and inv.status == "complete"
    assert inv.mdot_kg_s == pytest.approx(m, rel=1e-6)
