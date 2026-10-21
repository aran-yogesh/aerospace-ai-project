"""Generate the synthetic golden STEP set and its expected component graphs.

Run inside the backend container (CadQuery/OCP live there):

    make golden
    # == docker compose run --rm --no-deps lemma-core python /evals/golden/generate.py

Every part is a real hollow solid (inner and outer wall). Pipe-like parts are built from OCP
primitives so their surfaces are analytic: straight runs are CYLINDER faces, bends are true
TOROIDAL faces (BRepPrimAPI_MakeTorus, not a sweep that may come out as a BSpline or a surface of
revolution), reducers are CONICAL frustum shells. Each part is modeled in its own local frame and
placed with an assembly location, so the parser has to compose XCAF instance locations.

Wall thickness: OD = ID + 4 mm for every pipe-like part.

Expected values in NN_name.expected.json are computed from the design parameters below (not
measured from the generated geometry) and are in meters / degrees.
"""

from __future__ import annotations

import json
import math
import sys
from dataclasses import dataclass, field
from pathlib import Path

import cadquery as cq
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
from OCP.BRepPrimAPI import (
    BRepPrimAPI_MakeBox,
    BRepPrimAPI_MakeCone,
    BRepPrimAPI_MakeCylinder,
    BRepPrimAPI_MakeTorus,
)
from OCP.gp import gp_Ax2, gp_Ax3, gp_Dir, gp_Pnt, gp_Trsf
from OCP.TopoDS import TopoDS_Shape

OUT_DIR = Path(__file__).resolve().parent
WALL_MM = 2.0  # OD = ID + 2 * WALL
EPS = 1.0  # mm overshoot for the bore tool so booleans never see coplanar caps
MM = 1e-3

Vec = tuple[float, float, float]


# --------------------------------------------------------------------------- vector helpers
def add(a: Vec, b: Vec) -> Vec:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def sub(a: Vec, b: Vec) -> Vec:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def mul(a: Vec, s: float) -> Vec:
    return (a[0] * s, a[1] * s, a[2] * s)


def dot(a: Vec, b: Vec) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a: Vec, b: Vec) -> Vec:
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def unit(a: Vec) -> Vec:
    n = math.sqrt(dot(a, a))
    return (a[0] / n, a[1] / n, a[2] / n)


def perp(d: Vec) -> Vec:
    """Any unit vector perpendicular to d."""
    ref = (0.0, 0.0, 1.0) if abs(d[2]) < 0.9 else (1.0, 0.0, 0.0)
    return unit(cross(d, ref))


def ax2(p: Vec, z: Vec, x: Vec) -> gp_Ax2:
    return gp_Ax2(gp_Pnt(*p), gp_Dir(*z), gp_Dir(*x))


def cut(a: TopoDS_Shape, b: TopoDS_Shape) -> TopoDS_Shape:
    op = BRepAlgoAPI_Cut(a, b)
    op.Build()
    if not op.IsDone():
        raise RuntimeError("boolean cut failed")
    return op.Shape()


def fuse(a: TopoDS_Shape, b: TopoDS_Shape) -> TopoDS_Shape:
    """Fuse WITHOUT ShapeUpgrade_UnifySameDomain, so split faces stay split."""
    op = BRepAlgoAPI_Fuse(a, b)
    op.Build()
    if not op.IsDone():
        raise RuntimeError("boolean fuse failed")
    return op.Shape()


# --------------------------------------------------------------------------- primitives
def tube(p: Vec, d: Vec, length: float, id_: float) -> TopoDS_Shape:
    """Straight hollow pipe from p along unit d. Inner face = one CYLINDER face."""
    x = perp(d)
    od = id_ + 2 * WALL_MM
    outer = BRepPrimAPI_MakeCylinder(ax2(p, d, x), od / 2, length).Shape()
    bore = BRepPrimAPI_MakeCylinder(
        ax2(sub(p, mul(d, EPS)), d, x), id_ / 2, length + 2 * EPS
    ).Shape()
    return cut(outer, bore)


def bend(
    p: Vec, d: Vec, n: Vec, radius: float, angle_deg: float, id_: float
) -> tuple[TopoDS_Shape, Vec, Vec]:
    """Hollow torus segment starting at p heading d, turning toward unit n (n ⟂ d).

    Torus frame: center c = p + R n, X = -n (center -> start), Z = d x n, so Y = Z x X = d and
    the U parameter (major sweep) runs from 0 to the bend angle. Returns (shape, end, end_dir).
    """
    a = math.radians(angle_deg)
    c = add(p, mul(n, radius))
    xd = mul(n, -1.0)
    zd = unit(cross(d, n))
    yd = d
    od = id_ + 2 * WALL_MM
    outer = BRepPrimAPI_MakeTorus(ax2(c, zd, xd), radius, od / 2, a).Shape()
    # Bore tool overshoots both end planes by a small angle.
    e = math.radians(2.0)
    x_e = add(mul(xd, math.cos(-e)), mul(yd, math.sin(-e)))
    bore = BRepPrimAPI_MakeTorus(ax2(c, zd, x_e), radius, id_ / 2, a + 2 * e).Shape()
    shape = cut(outer, bore)
    end = add(c, add(mul(xd, radius * math.cos(a)), mul(yd, radius * math.sin(a))))
    end_dir = unit(add(mul(xd, -math.sin(a)), mul(yd, math.cos(a))))
    return shape, end, end_dir


def reducer(p: Vec, d: Vec, length: float, id_in: float, id_out: float) -> TopoDS_Shape:
    """Conical frustum shell; inner face = one CONE face."""
    x = perp(d)
    outer = BRepPrimAPI_MakeCone(
        ax2(p, d, x), id_in / 2 + WALL_MM, id_out / 2 + WALL_MM, length
    ).Shape()
    slope = (id_out - id_in) / 2 / length
    r0 = id_in / 2 - slope * EPS
    r1 = id_out / 2 + slope * EPS
    bore = BRepPrimAPI_MakeCone(ax2(sub(p, mul(d, EPS)), d, x), r0, r1, length + 2 * EPS).Shape()
    return cut(outer, bore)


def valve_body(p: Vec, d: Vec, length: float, width: float, bore_id: float) -> TopoDS_Shape:
    """Square block with a straight through-bore. Mostly planar faces on purpose."""
    x = perp(d)
    y = cross(d, x)
    corner = sub(sub(p, mul(x, width / 2)), mul(y, width / 2))
    block = BRepPrimAPI_MakeBox(ax2(corner, d, x), width, width, length).Shape()
    bore = BRepPrimAPI_MakeCylinder(
        ax2(sub(p, mul(d, EPS)), d, x), bore_id / 2, length + 2 * EPS
    ).Shape()
    return cut(block, bore)


def tee_body(center: Vec, run_d: Vec, branch_d: Vec, run_len: float, branch_len: float, id_: float):
    """Equal tee: run along run_d centered at center, branch from center along branch_d."""
    od = id_ + 2 * WALL_MM
    start = sub(center, mul(run_d, run_len / 2))
    xr = perp(run_d)
    xb = perp(branch_d)
    outer = fuse(
        BRepPrimAPI_MakeCylinder(ax2(start, run_d, xr), od / 2, run_len).Shape(),
        BRepPrimAPI_MakeCylinder(ax2(center, branch_d, xb), od / 2, branch_len).Shape(),
    )
    bore = fuse(
        BRepPrimAPI_MakeCylinder(
            ax2(sub(start, mul(run_d, EPS)), run_d, xr), id_ / 2, run_len + 2 * EPS
        ).Shape(),
        BRepPrimAPI_MakeCylinder(ax2(center, branch_d, xb), id_ / 2, branch_len + EPS).Shape(),
    )
    return cut(outer, bore)


# --------------------------------------------------------------------------- assembly
@dataclass
class Part:
    name: str
    shape: TopoDS_Shape
    origin: Vec  # local frame used for the assembly location
    z: Vec
    x: Vec


@dataclass
class Group:
    name: str
    items: list[Part | Group] = field(default_factory=list)
    origin: Vec = (0.0, 0.0, 0.0)  # sub-assembly placement (translation only)


def frame_trsf(origin: Vec, z: Vec, x: Vec) -> gp_Trsf:
    """Transform mapping local coordinates of the frame to global."""
    t = gp_Trsf()
    t.SetTransformation(gp_Ax3(gp_Pnt(*origin), gp_Dir(*z), gp_Dir(*x)))
    return t.Inverted()


def to_assembly(group: Group, parent_origin: Vec = (0.0, 0.0, 0.0)) -> cq.Assembly:
    """Build a cq.Assembly where every part is stored in its local frame plus a location.

    Shapes are built in global coordinates; each part is moved into its local frame and the
    assembly location moves it back, composed with the (translated) parent sub-assemblies.
    """
    assy = cq.Assembly(name=group.name)
    for item in group.items:
        if isinstance(item, Group):
            sub_origin = item.origin
            child = to_assembly(item, add(parent_origin, sub_origin))
            assy.add(child, name=item.name, loc=cq.Location(cq.Vector(*sub_origin)))
        else:
            # global -> local of the part frame, expressed relative to parent origin
            local_origin = sub(item.origin, parent_origin)
            to_global = frame_trsf(local_origin, item.z, item.x)
            back = gp_Trsf()
            back.SetTranslation(gp_Pnt(*parent_origin), gp_Pnt(0, 0, 0))
            shape = cq.Shape.cast(item.shape).transformShape(cq.Matrix(back))
            shape = shape.transformShape(cq.Matrix(to_global.Inverted()))
            assy.add(shape, name=item.name, loc=cq.Location(to_global))
    return assy


# --------------------------------------------------------------------------- expected values
def e_pipe(part: str, id_mm: float, length_mm: float) -> dict:
    return {
        "type": "pipe",
        "part": part,
        "inner_diameter_m": id_mm * MM,
        "length_m": length_mm * MM,
    }


def e_bend(part: str, id_mm: float, angle: float, r_mm: float) -> dict:
    return {
        "type": "bend",
        "part": part,
        "inner_diameter_m": id_mm * MM,
        "angle_deg": angle,
        "bend_radius_m": r_mm * MM,
        "r_over_d": r_mm / id_mm,
        "centerline_length_m": r_mm * MM * math.radians(angle),
    }


def e_transition(part: str, d_in: float, d_out: float, length_mm: float, kind: str) -> dict:
    return {
        "type": "transition",
        "part": part,
        "d_in_m": d_in * MM,
        "d_out_m": d_out * MM,
        "length_m": length_mm * MM,
        "half_angle_deg": math.degrees(math.atan(abs(d_in - d_out) / 2 / length_mm)),
        "kind": kind,
    }


def e_valve(name: str, path: str, vendor: str | None, vtype: str | None, cv: float | None):
    return {
        "type": "valve",
        "name": name,
        "part_path": path,
        "vendor": vendor,
        "valve_type": vtype,
        "cv": cv,
    }


def e_unclassified(name: str, path: str, reason_contains: str) -> dict:
    return {
        "type": "unclassified",
        "name": name,
        "part_path": path,
        "reason_contains": reason_contains,
    }


def flow_length(c: dict) -> float:
    if c["type"] == "pipe" or c["type"] == "transition":
        return c["length_m"]
    if c["type"] == "bend":
        return c["centerline_length_m"]
    return 0.0


def expected_doc(
    file: str, description: str, topology: str, comps: list[dict], edges: list[tuple[int, int]]
) -> dict:
    warnings = []
    if topology == "line":
        warnings.append("flow direction assumed")
    if topology == "network":
        warnings.append("network topology: single-path solve not available")
    n_unc = sum(c["type"] == "unclassified" for c in comps)
    if n_unc:
        warnings.append(f"{n_unc} part{'s' if n_unc > 1 else ''} unclassified")
    return {
        "file": file,
        "synthetic": True,
        "description": description,
        "length_unit_in_file": "mm",
        "topology": topology,
        "component_count": len(comps),
        "ordered": topology == "line",
        "components": comps,
        "edges": [list(e) for e in edges],
        "total_pipe_length_m": sum(c["length_m"] for c in comps if c["type"] == "pipe"),
        "total_flow_length_m": sum(flow_length(c) for c in comps),
        "warnings_contain": warnings,
    }


# --------------------------------------------------------------------------- cases
X: Vec = (1.0, 0.0, 0.0)
Y: Vec = (0.0, 1.0, 0.0)
Z: Vec = (0.0, 0.0, 1.0)
ORIGIN: Vec = (0.0, 0.0, 0.0)


def case_01():
    pipe = Part("pipe", tube(ORIGIN, X, 500, 12), ORIGIN, X, Y)
    assy = Group("01_straight", [pipe])
    exp = expected_doc(
        "01_straight.step",
        "One straight pipe, ID 12 mm, OD 16 mm, 500 mm long.",
        "line",
        [e_pipe("pipe", 12, 500)],
        [],
    )
    return assy, exp


def case_bend(angle: float, file: str):
    r = 24.0
    p1 = Part("inlet_pipe", tube(ORIGIN, X, 200, 12), ORIGIN, X, Y)
    start = (200.0, 0.0, 0.0)
    shape, end, end_dir = bend(start, X, Y, r, angle, 12)
    b = Part(f"bend_{int(angle)}", shape, start, X, Y)
    p2 = Part("outlet_pipe", tube(end, end_dir, 200, 12), end, end_dir, perp(end_dir))
    assy = Group(Path(file).stem, [p1, b, p2])
    exp = expected_doc(
        file,
        f"Pipe 200 mm, {int(angle)} deg bend R=24 mm, pipe 200 mm; ID 12 mm, OD 16 mm.",
        "line",
        [
            e_pipe("inlet_pipe", 12, 200),
            e_bend(b.name, 12, angle, r),
            e_pipe("outlet_pipe", 12, 200),
        ],
        [(0, 1), (1, 2)],
    )
    return assy, exp


def case_04():
    p1 = Part("pipe_16", tube(ORIGIN, X, 200, 16), ORIGIN, X, Y)
    s = (200.0, 0.0, 0.0)
    red = Part("reducer_16x10", reducer(s, X, 30, 16, 10), s, X, Y)
    s2 = (230.0, 0.0, 0.0)
    p2 = Part("pipe_10", tube(s2, X, 200, 10), s2, X, Y)
    assy = Group("04_reducer", [p1, red, p2])
    exp = expected_doc(
        "04_reducer.step",
        "Pipe ID 16 (OD 20) 200 mm, conical reducer ID 16 -> 10 over 30 mm axial, pipe ID 10 "
        "(OD 14) 200 mm.",
        "line",
        [
            e_pipe("pipe_16", 16, 200),
            e_transition("reducer_16x10", 16, 10, 30, "contraction"),
            e_pipe("pipe_10", 10, 200),
        ],
        [(0, 1), (1, 2)],
    )
    return assy, exp


def case_valve(valve_name: str, file: str):
    p1 = Part("inlet_pipe", tube(ORIGIN, X, 200, 12), ORIGIN, X, Y)
    s = (200.0, 0.0, 0.0)
    v = Part(valve_name, valve_body(s, X, 60, 30, 12), s, X, Y)
    s2 = (260.0, 0.0, 0.0)
    p2 = Part("outlet_pipe", tube(s2, X, 200, 12), s2, X, Y)
    root = Path(file).stem
    assy = Group(root, [p1, v, p2])
    path = f"/{root}/{valve_name}"
    if valve_name == "Part1":
        mid = e_unclassified(valve_name, path, "not pipe-like")
    else:
        mid = e_valve(valve_name, path, "Swagelok", "BallValve", 12.0)
    exp = expected_doc(
        file,
        f"Pipe 200 mm, a 30x30x60 mm block with a 12 mm through-bore named {valve_name!r} "
        "touching both pipe ends, pipe 200 mm; ID 12 mm, OD 16 mm.",
        "line",
        [e_pipe("inlet_pipe", 12, 200), mid, e_pipe("outlet_pipe", 12, 200)],
        [(0, 1), (1, 2)],
    )
    return assy, exp


def case_07():
    """Small 3D feed line.

    inlet_spool (one fused solid): vertical riser ID 16 x 150 mm up +Z, then a 90 deg bend R=32
        (R/D 2) turning toward +X, modeled as two fused 45 deg torus segments (split torus faces).
    valve_station (sub-assembly, own location):
        Swagelok_BallValve_Cv6: 36x36x60 mm block, 16 mm bore, along +X
        reducer_16x10: cone ID 16 -> 10 over 30 mm
    outlet_spool (one fused solid): 45 deg bend R=20 (R/D 2) in the horizontal plane turning
        toward +Y, then outlet pipe ID 10 x 200 mm along (1,1,0)/sqrt2, modeled as two fused
        cylinders 80 + 120 mm (split cylinder faces).
    """
    riser = tube(ORIGIN, Z, 150, 16)
    b_start = (0.0, 0.0, 150.0)
    b1, mid, mid_dir = bend(b_start, Z, X, 32, 45, 16)
    n2 = unit(cross(cross(mid_dir, X), mid_dir))  # keep turning in the XZ plane toward +X
    b2, b_end, b_dir = bend(mid, mid_dir, n2, 32, 45, 16)
    inlet = Part("inlet_spool", fuse(fuse(riser, b1), b2), ORIGIN, Z, X)

    v_start = b_end  # (32, 0, 182) heading +X
    valve = Part(
        "Swagelok_BallValve_Cv6", valve_body(v_start, b_dir, 60, 36, 16), v_start, b_dir, Y
    )
    r_start = add(v_start, mul(b_dir, 60))
    red = Part("reducer_16x10", reducer(r_start, b_dir, 30, 16, 10), r_start, b_dir, Y)
    station_origin = v_start

    o_start = add(r_start, mul(b_dir, 30))
    b3, o_end, o_dir = bend(o_start, b_dir, Y, 20, 45, 10)
    p_a = tube(o_end, o_dir, 80, 10)
    p_b = tube(add(o_end, mul(o_dir, 80)), o_dir, 120, 10)
    outlet = Part("outlet_spool", fuse(fuse(b3, p_a), p_b), o_start, b_dir, Y)

    station = Group("valve_station", [valve, red], origin=station_origin)
    assy = Group("07_feed_line", [inlet, station, outlet])
    vpath = "/07_feed_line/valve_station/Swagelok_BallValve_Cv6"
    comps = [
        e_pipe("inlet_spool", 16, 150),
        e_bend("inlet_spool", 16, 90, 32),
        e_valve("Swagelok_BallValve_Cv6", vpath, "Swagelok", "BallValve", 6.0),
        e_transition("reducer_16x10", 16, 10, 30, "contraction"),
        e_bend("outlet_spool", 10, 45, 20),
        e_pipe("outlet_spool", 10, 200),
    ]
    exp = expected_doc(
        "07_feed_line.step",
        "3D feed line: riser ID 16 x 150 mm (+Z), 90 deg bend R 32 (split into two torus faces) "
        "turning to +X, Swagelok ball valve block (Cv 6), reducer 16 -> 10 over 30 mm, 45 deg bend "
        "R 20 in the horizontal plane, outlet ID 10 x 200 mm (split into two cylinder faces). "
        "Riser+bend and bend+outlet are fused spools; valve and reducer sit in a sub-assembly.",
        "line",
        comps,
        [(0, 1), (1, 2), (2, 3), (3, 4), (4, 5)],
    )
    return assy, exp


def case_08():
    """Equal tee (one part) with three 100 mm pipes, ID 12. Expected: network."""
    tee = Part("tee_12", tee_body(ORIGIN, X, Y, 60, 30, 12), ORIGIN, X, Y)
    pa = Part("pipe_west", tube((-130.0, 0.0, 0.0), X, 100, 12), (-130.0, 0.0, 0.0), X, Y)
    pb = Part("pipe_east", tube((30.0, 0.0, 0.0), X, 100, 12), (30.0, 0.0, 0.0), X, Y)
    pc = Part("pipe_north", tube((0.0, 30.0, 0.0), Y, 100, 12), (0.0, 30.0, 0.0), Y, X)
    assy = Group("08_tee", [pa, tee, pb, pc])
    comps = [
        e_pipe("pipe_west", 12, 100),
        e_pipe("tee_12", 12, 60),  # tee run bore
        e_pipe("pipe_east", 12, 100),
        e_pipe("tee_12", 12, 30),  # tee branch bore, measured from the run axis
        e_pipe("pipe_north", 12, 100),
    ]
    exp = expected_doc(
        "08_tee.step",
        "Equal tee ID 12 (run 60 mm, branch 30 mm from the run axis) with three 100 mm pipes "
        "(west, east, north). Three open ends: network, no single ordered path.",
        "network",
        comps,
        [(0, 1), (1, 2), (1, 3), (3, 4)],
    )
    return assy, exp


CASES = {
    "01_straight": case_01,
    "02_bend_90": lambda: case_bend(90, "02_bend_90.step"),
    "03_bend_45": lambda: case_bend(45, "03_bend_45.step"),
    "04_reducer": case_04,
    "05_valve": lambda: case_valve("Swagelok_BallValve_Cv12", "05_valve.step"),
    "06_unnamed_part": lambda: case_valve("Part1", "06_unnamed_part.step"),
    "07_feed_line": case_07,
    "08_tee": case_08,
}


def build(case: str) -> tuple[cq.Assembly, dict]:
    group, exp = CASES[case]()
    return to_assembly(group), exp


def export(assy: cq.Assembly, path: Path, unit: str = "MM") -> None:
    """Write STEP. `unit` is the length unit declared in the file (geometry is scaled to it)."""
    if unit == "MM":
        assy.export(str(path), "STEP")
    else:
        assy.export(str(path), "STEP", unit="MM", outputUnit=unit)


def main(argv: list[str]) -> None:
    only = set(argv)
    for case in CASES:
        if only and case not in only:
            continue
        assy, exp = build(case)
        step = OUT_DIR / f"{case}.step"
        export(assy, step)
        (OUT_DIR / f"{case}.expected.json").write_text(json.dumps(exp, indent=2) + "\n")
        print(f"wrote {step.name} ({step.stat().st_size // 1024} KiB) + {case}.expected.json")


if __name__ == "__main__":
    main(sys.argv[1:])
