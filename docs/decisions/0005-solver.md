# 0005. Solver

- Status: accepted (numbers pending review by Rohith)
- Date: 2026-10-23

## Context

Phase 2 turns a confirmed dataset (ordered segments, fluid properties, roughness, resolved K
values) into a pressure drop for a given flow, or a flow for a given pressure drop. Every number
must trace to a formula, a table entry with a source, or a user input. The solver must be easy to
check by hand and must never invent a value.

## Decision

### A pure package

`app.solver` is pure functions over the `app.schema.solve` models. It imports only the standard
library, scipy, `app.schema` and itself. It never imports the DB, the API, the constants loader,
`app.core` or LLM code; `tests/solver/test_imports.py` checks this both from the source (AST) and
at runtime (`sys.modules` after `import app.solver`). Fluid properties, roughness and the resolved
K values all come in as arguments. All units are SI.

Public API (`app.solver`): `SOLVER_VERSION`, `solve_forward`, `solve_inverse`, `KResult`,
`bend_k`, `transition_k`, `valve_k_from_cv`, `valve_k_from_kv`. Internals: `friction.py`
(`churchill_f`, `regime`, `fully_turbulent_f`), `losses.py` (`pipe_dp`, `minor_dp`, `velocity`,
`reynolds`).

### Methods and sources

Crane page numbers refer to Crane TP-410, 1988 edition (25th printing). Later editions renumber the
appendix; Rohith should check the page numbers against his copy.

| Item | Method | Source |
|---|---|---|
| Pipe friction | Darcy-Weisbach, dp = f (L/D) rho v^2/2 | |
| Friction factor | Churchill, one formula for all regimes | Churchill, Chem. Eng. 84(24), 1977 |
| Regime | laminar Re < 2300, transitional 2300 to 4000, turbulent > 4000 | spec |
| Minor loss | dp = K rho v^2/2, v at the diameter K refers to | Crane p. 2-8 |
| f_T | von Karman fully rough, 1/sqrt(f_T) = -2 log10(e/3.7D), for the actual material | Crane p. A-26 (method) |
| 90 deg bend | K = f_T (L/D)eq, r/d table 1..20 | Crane p. A-29 |
| Other bend angles | see below | Crane p. A-29 |
| Contraction/expansion | Crane formulas 1-4, K referenced to the smaller bore | Crane p. A-26 |
| Valve from Cv | K = 891 d^4/Cv^2, d in inches | Crane p. 2-10, constant per spec |
| Valve from Kv | K = 2 dp A^2/(rho Q^2) at 1 bar, rho 1000, Q = Kv/3600 (= 0.0016 d_mm^4/Kv^2) | IEC 60534-1 |

**Churchill accuracy.** It equals 64/Re (Hagen-Poiseuille) to 1e-9 for Re <= 1000, and departs by
about 0.1 % near Re 2000 where the turbulent term blends in. In turbulent flow it is within 1 % of
Colebrook for e/D up to 1e-3 and Re 1e4 to 1e7, but drifts to 1.9 % at e/D 5e-3 and 2.1 % at
e/D 1e-2 near Re 1e4 (commercial steel in a 10 mm bore is e/D 4.6e-3). Both are tested.

**Bends.** (L/D)eq comes from Crane's table (r/d 1 -> 20, 1.5 -> 14, 2 -> 12, 3 -> 12, 4 -> 14,
6 -> 17, 8 -> 24, 10 -> 30, 12 -> 34, 14 -> 38, 16 -> 42, 20 -> 50). Crane gives points only, so we
interpolate linearly in r/d between them; outside 1..20 we clamp to the end value and the method
string says "clamped". f_T is computed for the pipe's own e/D rather than read from Crane's
commercial-steel f_T table, because our tubing is much smoother; this is the f_T the formula
intends (the zone-of-complete-turbulence f for that pipe). For n = angle/90:

- n >= 1: Crane's formula for n 90 deg bends, K = (n - 1)(0.25 pi f_T r/d + 0.5 K90) + K90.
- n < 1: K = n K90 (linear). Crane writes the formula for whole 90 deg bends. Extended below
  n = 1 it does not go to 0 at 0 deg (at r/d 2 it leaves 37 % of K90). Linear scaling is
  continuous at 90 deg and close to Crane's own 45/90 standard-elbow ratio (16 f_T / 30 f_T).

The bend's K already includes its wall friction (f_T (L/D)eq), so the solver adds no Darcy
friction over the bend's arc length; the arc length only advances the plot's x axis. `f` on a
bend row reports f_T.

**Transitions.** beta = d_small/d_large, theta = total included angle = 2 x half angle. Crane
formulas give K2 (large-bore velocity) = K1/beta^4 (formula 5); we return K1 (small-bore form):

- contraction, theta <= 45: 0.8 sin(theta/2)(1 - beta^2) (formula 1)
- contraction, 45 < theta <= 180: 0.5 sqrt(sin(theta/2))(1 - beta^2) (formula 2)
- expansion, theta <= 45: 2.6 sin(theta/2)(1 - beta^2)^2 (formula 3)
- expansion, 45 < theta <= 180: (1 - beta^2)^2 (formula 4)

So the formula switches at theta = 45 (half angle 22.5), not at half angle 45. Half angle >= 90 is
a sudden change (theta = 180): 0.5 (1 - beta^2) and Borda-Carnot (1 - beta^2)^2.

### Segment semantics

- pipe: Darcy-Weisbach over `length_m` at `d_m`; any `k` is ignored and reported as None.
- bend, transition, valve, unclassified: K only, with v at `k_ref_d_m` (falls back to `d_m`).
- Velocity and Re are reported at `d_m` for every row.

### No silent zeros

A segment without a positive `d_m`, or a non-pipe without `k`, is missing. The result is then
`status: "incomplete"`, `missing` lists the ids, and `total_dp_pa` is None. Known segments still
show their dp, but `p_after_pa` is None from the first missing segment on. The inverse solve does
not run at all when anything is missing (`mdot_kg_s` None). A zero only appears when it is
computed (e.g. K = 0 from a user "no loss" choice, or beta = 1). `fully_turbulent_f` refuses
e/D = 0 for the same reason (a smooth pipe has no fully rough zone); with roughness 0 the bend
row reports `f` None but its K still applies.

### Sign convention and plot axis

`p_after_pa` is gauge pressure relative to the inlet (inlet = 0 Pa): p_after = -(sum of dp up to
and including the segment), so it is negative and falls along the path. `x_start_m`/`x_end_m` are
cumulative centerline length (bends add their arc, valves 0).

### Warnings

Per segment: transitional regime; Re < 100; laminar flow through a K component (Crane K values
assume turbulent flow); velocity > 30 m/s; approximate K (`k_match` "family"). Per result, always:
elevation ignored (no hydrostatic head this phase).

### Inverse

`solve_inverse` finds mdot with `scipy.optimize.brentq` (rtol 1e-12, max 100 iterations). The
bracket starts at [1, 1] kg/s and moves by decades (up to 40 each way) until dp(lo) <= target <=
dp(hi); dp is strictly increasing in mdot (property-tested). It raises `ValueError` when the target
is <= 0 or not finite, when no bracket exists (a line with no loss), or when the target is out of
float range; `solve_forward` raises `ValueError` for mdot <= 0 and for non-positive density or
viscosity. The API maps `ValueError` to 422.

### Determinism and version

No randomness, no state, no I/O: the same inputs give bit-identical `SolveResult` JSON (tested,
including the inverse). `SOLVER_VERSION` (now "1.0.0") is stamped on every result and on each
dataset; bump it on any change that can move a number.

### Golden cases

`evals/golden/solve/` holds 01, 02 and 07 with hand worksheets (Water 293.15 K, 1 bar from
CoolProp 8.0.0: rho 998.2065434976523 kg/m^3, mu 1.0015965513039892e-3 Pa s; stainless drawn
e 1.524e-6 m). `tests/test_golden_solve.py` computes the K values from the case geometry, solves,
checks every K, every segment dp and the total within 1 %, runs the 07 inverse case, and writes
`evals/golden/solve/RESULTS.md`.

## Consequences

- Swapping a method (e.g. Hooper or Darby 3-K for fittings) is local to `k_methods.py` and is a
  version bump.
- Elevation, compressibility and cavitation checks are out of scope and flagged, not hidden.
- The bend rule below 90 deg, the Cv constant and the Crane page numbers are open for Rohith.
