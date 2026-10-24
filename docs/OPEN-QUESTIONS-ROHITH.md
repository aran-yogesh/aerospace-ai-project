# Open questions for Rohith (Phase 2)

These are the defaults Phase 2 ships with. Each needs an engineering decision or a check
against your copy of Crane TP-410. Changing any solver default means bumping `SOLVER_VERSION`
(`backend/app/solver/__init__.py`). Changing a constants file means bumping its `version`.
Either change makes new datasets hash differently.

## The four the spec called out

1. **Elevation is ignored.** There is no hydrostatic term, and every result carries the warning
   "elevation ignored". For scale: the 07 feed line's riser rises about 182 mm, which is about
   1.8 kPa of head that is not counted.
   *Change it in:* `backend/app/solver/solve.py` (`ELEVATION_WARNING`; a hydrostatic term per segment would go in `solve_forward`).

2. **Bend K uses Crane TP-410.** K90 = f_T·(L/D)eq from the r/d table (p. A-29), interpolated
   linearly between table points and clamped outside r/d 1–20. Angles above 90° use Crane's
   n·90° formula.
   *Change it in:* `backend/app/solver/k_methods.py` (`bend_k`, `BEND_R_OVER_D`, `BEND_L_OVER_D`).

3. **Valve Cv is converted with the upstream pipe ID.** K = 891·d⁴/Cv² (d in inches), with d taken
   from the nearest upstream component, or the downstream one if nothing is upstream. K is
   referenced to that same diameter.
   *Change it in:* `backend/app/api/resolve.py` (`_upstream_d`); the constant is `CV_CONSTANT` in `backend/app/solver/k_methods.py`.

4. **All seeded K values are unverified.** The 21 entries in the table cite Crane TP-410, and their
   values are evaluated at f_T = 0.023. Until you flip an entry to `status: verified`, any match on
   it is reported as **family (approximate)**, never exact.
   *Change it in:* `data/constants/k_values.yaml` (set `status: verified`, bump `version`).

## Raised during implementation

5. **Bends below 90°** use K = (angle/90)·K90, which is linear. Crane's n·90° formula doesn't reach 0
   at 0°: at r/d 2 it leaves 37% of K90. Linear scaling is continuous at 90° and close to Crane's
   45°/90° standard-elbow ratio. → `bend_k` in `k_methods.py`.
6. **f_T comes from the material's own e/D** (von Kármán fully rough), not Crane's commercial-steel
   f_T table. For drawn tubing this gives a lower bend K than the table would. → `fully_turbulent_f` in `backend/app/solver/friction.py`.
7. **The Cv constant is 891** per the spec. Crane's 29.9² gives 894, and the exact value for water
   at 60 °F is 890.4. → `CV_CONSTANT`.
8. **Crane page numbers** are cited from the 1988 edition: A-23 roughness, A-26 formulas and f_T,
   A-27 to A-30 fittings and valves, A-29 bends, 2-8 K, 2-10 Cv. Please check them against your
   edition. They are in the docstrings and in `data/constants/k_values.yaml`.
9. **Churchill accuracy:** it is up to about 2% off Colebrook for very rough small bores (e/D around
   5e-3, for example commercial steel in a 10 mm bore, near Re 1e4). It is within 1% for
   e/D ≤ 1e-3, which the tests check. → `churchill_f` in `friction.py`.
10. **Laminar flow with K components:** a "laminar flow: K values assume turbulent flow" warning is
    added. The spec didn't list it. → `backend/app/solver/solve.py`.
11. **The RP-1 property table is approximate,** written loosely after Huber et al. (2009), and marked
    unverified. It needs real data before anyone relies on RP-1 results.
    → `data/constants/fluids.yaml`.
12. **Material roughness** values come from Crane A-23. PTFE-lined is assumed hydraulically smooth
    (1.524e-6 m, the same as drawn tubing) and is unverified. → `data/constants/materials.yaml`.
13. **Golden solve worksheets** in `evals/golden/solve/*.worksheet.md` are marked "pending review by
    Rohith". CI holds the solver to them within 1%.
