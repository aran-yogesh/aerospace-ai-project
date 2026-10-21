# Golden cases

Reference problems with known answers that check the solver, parser and agent end to end.
Each case is a folder with the input (CAD file or component list + fluid + flow), the expected
`SolveResult` and the tolerance, and the citation for the expected answer.

- **CI only, never shipped.** This folder is not in the Docker image (the build context is
  `backend/`) and must never be packaged with the desktop app.
- An expected value changes only with a cited reason, in a PR of its own.
- When `data/constants` versions change, re-run the goldens and note any drift in the PR.

## Parser goldens (Phase 1): SYNTHETIC

The `NN_name.step` files in this folder are **synthetic**. `generate.py` builds them with
CadQuery/OCP as `cq.Assembly` STEP files with named parts. They are not real customer CAD.
Real files (e.g. from Rohith) go in `evals/golden/real/`, each with its own `.expected.json`.

| file | content | expected |
|------|---------|----------|
| 01_straight | one pipe ID 12, 500 mm | line: pipe |
| 02_bend_90 | pipe 200, 90° bend R 24, pipe 200 (ID 12) | line: pipe, bend, pipe |
| 03_bend_45 | same with a 45° bend | line: pipe, bend, pipe |
| 04_reducer | pipe ID 16, cone 16 to 10 over 30 mm, pipe ID 10 | line: pipe, transition (contraction), pipe |
| 05_valve | pipe, block `Swagelok_BallValve_Cv12` with a 12 mm bore, pipe | line: pipe, valve, pipe |
| 06_unnamed_part | same block named `Part1` | line: pipe, unclassified (with reason), pipe |
| 07_feed_line | 3D: riser ID 16 x 150 (+Z), 90° bend R 32, valve Cv 6, reducer 16 to 10, 45° bend R 20 in the horizontal plane, outlet ID 10 x 200 | line of 6 |
| 08_tee | equal tee ID 12 (run 60, branch 30 from the run axis) + three 100 mm pipes | network |

Construction rules:

- Every pipe-like part is a hollow solid with **OD = ID + 4 mm** (2 mm wall).
- Straight runs are analytic CYLINDER faces. Bends are true TOROIDAL faces (`BRepPrimAPI_MakeTorus`
  minus a bore torus). Reducers are CONICAL frustum shells. The parser's torus rule (angle =
  U range, R = major radius, ID = 2 x minor radius) and cone rule (axial = slant x cos) are both
  exercised.
- Valve/unnamed bodies are square blocks with a through-bore that touch the pipe ends. The bore
  is part of the valve and adds nothing to pipe length.
- 07 tests merging and assembly handling: riser + 90° bend are one fused solid, and the bend is
  two 45° tori, so its torus faces are split. The 45° bend + outlet are one fused solid, and the
  outlet is two cylinders (80 + 120 mm), so its cylinder faces are split. Valve and reducer sit
  in a nested sub-assembly with its own location.
- Every part is stored in a local frame and placed with an assembly location.

`NN_name.expected.json` holds values computed by hand from the design parameters, in meters and
degrees. It lists component types in flow order with ID, length, bend angle, bend radius, R/D,
transition diameters, half-angle and kind, valve/unclassified names and part paths, plus the
edges (component index pairs), the topology, the total straight-pipe length, the total
centerline (flow) length and the required warnings.

Regenerate and test (from the repo root):

```sh
make golden        # rewrite the .step + .expected.json files
make test-golden   # parser tests; prints the results table and writes RESULTS.md
```
