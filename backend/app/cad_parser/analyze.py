"""Turn located part solids into a component graph.

Pipeline (see docs/decisions/0004-cad-parser.md):
1. Per part: analyze every face; classify the part (valve by name, pipe-like by geometry,
   otherwise unclassified with a reason).
2. Pipe-like parts: keep only wetted faces (analytic faces whose normal points toward the axis or
   tube centerline). Merge split faces lying on the same analytic surface that share an edge into
   one segment. Each segment is one component (cylinder -> pipe, torus -> bend, cone -> transition).
3. Connectivity: segments sharing an edge; free segment ends whose centers coincide (0.1 mm);
   valves/unclassified parts touching a free pipe end (0.1 mm); non-pipe parts touching each other.
4. Topology, inlet/outlet, ordered path, transition direction, ids.
"""

from __future__ import annotations

import itertools
import math
import re
from dataclasses import dataclass, field
from typing import cast

import numpy as np
from OCP.Bnd import Bnd_Box
from OCP.BRep import BRep_Builder
from OCP.BRepAdaptor import BRepAdaptor_Curve
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepExtrema import BRepExtrema_DistShapeShape
from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE
from OCP.TopExp import TopExp
from OCP.TopoDS import TopoDS, TopoDS_Compound, TopoDS_Edge, TopoDS_Face, TopoDS_Shape
from OCP.TopTools import TopTools_IndexedDataMapOfShapeListOfShape, TopTools_IndexedMapOfShape

from app.schema.geometry import (
    Bend,
    Pipe,
    SystemGraph,
    Transition,
    Unclassified,
    Valve,
)

from .reader import PartSolid
from .surfaces import Cone, Cyl, FaceGeom, Torus, analyze_face, vec

TOUCH_TOL = 1e-4  # 0.1 mm: parts touching / pipe ends coinciding
PIPE_AREA_FRACTION = 0.5  # pipe-like if cylinder/torus/cone faces cover at least this share

W_FLOW = "flow direction assumed"
W_NETWORK = "network topology: single-path solve not available"

VALVE_NAME_RE = re.compile(
    r"^(?P<vendor>[A-Za-z0-9]+)[_\-\s](?P<type>[A-Za-z0-9\-]+)[_\-\s]Cv[_\-\s]?(?P<cv>\d+(?:\.\d+)?)$",
    re.IGNORECASE,
)
VALVE_KEYWORDS = ("valve", "orifice")


# --------------------------------------------------------------------------- data
@dataclass
class FaceRec:
    gid: int  # global face index (face_ids in the schema)
    face: TopoDS_Face
    geom: FaceGeom


@dataclass
class Segment:
    """Merged run of wetted faces lying on one analytic surface."""

    kind: str  # cylinder | torus | cone
    part: int
    faces: list[FaceRec]
    # computed by measure()
    ends: list[np.ndarray] = field(default_factory=list)  # end centers [start, end]
    end_dirs: list[np.ndarray] = field(default_factory=list)  # outward unit directions
    end_diameters: list[float] = field(default_factory=list)
    length: float = 0.0  # pipe/transition: axial length
    angle_deg: float = 0.0  # bend
    bend_radius: float = 0.0
    inner_diameter: float = 0.0
    half_angle_deg: float = 0.0
    warnings: list[str] = field(default_factory=list)
    # parametrisation for "which end is this point near"
    _axis_origin: np.ndarray = field(default_factory=lambda: np.zeros(3))
    _axis: np.ndarray = field(default_factory=lambda: np.array([0.0, 0.0, 1.0]))
    _t: tuple[float, float] = (0.0, 0.0)
    _torus: Torus | None = None
    _theta0: float = 0.0
    _sweep: float = 0.0

    def param(self, p: np.ndarray) -> float:
        """0 at the start end, 1 at the far end (may fall outside for off-segment points)."""
        if self._torus is not None:
            t = self._torus
            w = p - t.center
            ang = math.atan2(float(np.dot(w, t.ydir)), float(np.dot(w, t.xdir)))
            rel = (ang - self._theta0) % (2 * math.pi)
            if rel > self._sweep + (2 * math.pi - self._sweep) / 2:
                rel -= 2 * math.pi
            return rel / self._sweep if self._sweep > 0 else 0.0
        t = float(np.dot(p - self._axis_origin, self._axis))
        span = self._t[1] - self._t[0]
        return (t - self._t[0]) / span if span > 0 else 0.0

    def scale(self) -> float:
        """Length of the segment's centerline, used to turn param() into a distance."""
        if self._torus is not None:
            return self._torus.major * self._sweep
        return self._t[1] - self._t[0]

    def centerline(self, n: int = 9) -> list[np.ndarray]:
        if self._torus is not None:
            t = self._torus
            return [
                t.center + t.major * (math.cos(a) * t.xdir + math.sin(a) * t.ydir)
                for a in np.linspace(self._theta0, self._theta0 + self._sweep, n)
            ]
        return [self._axis_origin + s * self._axis for s in np.linspace(*self._t, n)]


@dataclass
class PartRec:
    solid: PartSolid
    faces: list[FaceRec]
    role: str  # pipe | valve | unclassified
    reason: str = ""
    valve_match: dict | None = None
    warnings: list[str] = field(default_factory=list)
    edge_faces: TopTools_IndexedDataMapOfShapeListOfShape | None = None


@dataclass
class Node:
    """A component before ids are assigned."""

    kind: str  # pipe | bend | transition | valve | unclassified
    part: int
    segment: Segment | None = None
    face_gids: list[int] = field(default_factory=list)


@dataclass
class Link:
    a: int
    b: int
    end_a: int | None  # which end of a's segment (0/1), None for non-pipe nodes
    end_b: int | None


@dataclass
class AnalysisResult:
    graph: SystemGraph
    # component id -> faces to display in its mesh leaf
    display_faces: dict[str, list[TopoDS_Shape]]
    file_length_units: list[str]


# --------------------------------------------------------------------------- helpers
def _faces_of(shape: TopoDS_Shape) -> list[TopoDS_Face]:
    m = TopTools_IndexedMapOfShape()
    TopExp.MapShapes_s(shape, TopAbs_FACE, m)
    return [TopoDS.Face_s(m.FindKey(i)) for i in range(1, m.Extent() + 1)]


def _list(shapes) -> list[TopoDS_Shape]:
    return list(shapes)


def _edge_mid(edge: TopoDS_Edge) -> np.ndarray:
    c = BRepAdaptor_Curve(edge)
    return vec(c.Value(0.5 * (c.FirstParameter() + c.LastParameter())))


def _compound(shapes: list[TopoDS_Shape]) -> TopoDS_Compound:
    comp = TopoDS_Compound()
    b = BRep_Builder()
    b.MakeCompound(comp)
    for s in shapes:
        b.Add(comp, s)
    return comp


def _bbox(shape: TopoDS_Shape) -> Bnd_Box:
    box = Bnd_Box()
    BRepBndLib.Add_s(shape, box, False)
    box.Enlarge(TOUCH_TOL)
    return box


def _distance(a: TopoDS_Shape, b: TopoDS_Shape) -> float:
    d = BRepExtrema_DistShapeShape(a, b)
    if not d.IsDone() or d.NbSolution() == 0:
        return math.inf
    return d.Value()


def match_valve_name(name: str) -> dict | None:
    m = VALVE_NAME_RE.match(name.strip())
    if m:
        return {
            "vendor": m.group("vendor"),
            "valve_type": m.group("type"),
            "cv": float(m.group("cv")),
            "confidence": 0.9,
        }
    low = name.lower()
    if any(k in low for k in VALVE_KEYWORDS):
        return {"vendor": None, "valve_type": None, "cv": None, "confidence": 0.6}
    return None


# --------------------------------------------------------------------------- classification
def classify_part(solid: PartSolid, first_gid: int) -> PartRec:
    faces = [
        FaceRec(first_gid + i, f, analyze_face(f)) for i, f in enumerate(_faces_of(solid.solid))
    ]
    rec = PartRec(solid=solid, faces=faces, role="unclassified")
    valve = match_valve_name(solid.name)
    if valve is not None:
        rec.role = "valve"
        rec.valve_match = valve
        return rec

    total = sum(f.geom.area for f in faces) or 1.0
    analytic = sum(f.geom.area for f in faces if f.geom.surface is not None)
    frac = analytic / total
    wetted = [f for f in faces if f.geom.surface is not None and f.geom.inward]
    base = f"name {solid.name!r} matches no valve pattern and the geometry is not pipe-like"
    if frac < PIPE_AREA_FRACTION:
        rec.reason = (
            f"{base}: cylinder/torus/cone faces cover {frac:.0%} of the surface area "
            f"(pipe-like needs {PIPE_AREA_FRACTION:.0%})"
        )
        return rec
    if not wetted:
        rec.reason = f"{base}: no inward-facing cylinder/torus/cone faces (no flow passage)"
        return rec
    rec.role = "pipe"
    others = sum(1 for f in faces if f.geom.kind == "other")
    if others:
        rec.warnings.append(f"{others} non-analytic face(s) ignored in part {solid.name!r}")
    return rec


# --------------------------------------------------------------------------- segments
def _union_find(n: int):
    parent = list(range(n))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i: int, j: int) -> None:
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[max(ri, rj)] = min(ri, rj)

    return find, union


def build_segments(part: PartRec) -> list[Segment]:
    wet = [f for f in part.faces if f.geom.surface is not None and f.geom.inward]
    edge_map = TopTools_IndexedDataMapOfShapeListOfShape()
    TopExp.MapShapesAndAncestors_s(part.solid.solid, TopAbs_EDGE, TopAbs_FACE, edge_map)
    part.edge_faces = edge_map

    find, union = _union_find(len(wet))
    index_of: dict[int, int] = {}
    face_map = TopTools_IndexedMapOfShape()
    for i, f in enumerate(wet):
        face_map.Add(f.face)
        index_of[face_map.FindIndex(f.face)] = i
    for k in range(1, edge_map.Extent() + 1):
        anc = _list(edge_map.FindFromIndex(k))
        idx = sorted({index_of[j] for s in anc if (j := face_map.FindIndex(s)) and j in index_of})
        for x in range(len(idx)):
            for y in range(x + 1, len(idx)):
                a, b = wet[idx[x]], wet[idx[y]]
                if a.geom.kind == b.geom.kind and a.geom.surface.same_surface(b.geom.surface):  # type: ignore[union-attr,arg-type]
                    union(idx[x], idx[y])

    groups: dict[int, list[FaceRec]] = {}
    for i, f in enumerate(wet):
        groups.setdefault(find(i), []).append(f)
    segments = [
        Segment(kind=fs[0].geom.kind, part=part.solid.index, faces=fs) for fs in groups.values()
    ]
    for s in segments:
        measure(s)
    return segments


def _merge_intervals(iv: list[tuple[float, float]]) -> tuple[float, float, bool]:
    iv = sorted(iv)
    lo, hi = iv[0]
    contiguous = True
    for a, b in iv[1:]:
        if a > hi + 1e-9:
            contiguous = False
        hi = max(hi, b)
    return lo, hi, contiguous


def measure(seg: Segment) -> None:
    first = seg.faces[0].geom.surface
    if isinstance(first, Cyl):
        o, ax = first.origin, first.axis
        iv = []
        for f in seg.faces:
            c = cast(Cyl, f.geom.surface)
            sign = 1.0 if np.dot(c.axis, ax) > 0 else -1.0
            base = float(np.dot(c.origin - o, ax))
            ts = (base + sign * c.t0, base + sign * c.t1)
            iv.append((min(ts), max(ts)))
        t0, t1, ok = _merge_intervals(iv)
        seg._axis_origin, seg._axis, seg._t = o, ax, (t0, t1)
        seg.length = t1 - t0
        seg.inner_diameter = 2 * first.radius
        seg.end_diameters = [seg.inner_diameter, seg.inner_diameter]
        seg.ends = [o + t0 * ax, o + t1 * ax]
        seg.end_dirs = [-ax, ax]
    elif isinstance(first, Cone):
        o, ax = first.origin, first.axis
        iv = []
        radius_at: dict[float, float] = {}
        for f in seg.faces:
            c = cast(Cone, f.geom.surface)
            sign = 1.0 if np.dot(c.axis, ax) > 0 else -1.0
            base = float(np.dot(c.origin - o, ax))
            ts = []
            for v in (c.v0, c.v1):
                t = base + sign * c.t_of_v(v)  # axial = slant (v) x cos(semi-angle)
                ts.append(t)
                radius_at[t] = c.radius_of_v(v)
            iv.append((min(ts), max(ts)))
        t0, t1, ok = _merge_intervals(iv)

        def r_at(t: float) -> float:
            return min(radius_at.items(), key=lambda kv: abs(kv[0] - t))[1]

        seg._axis_origin, seg._axis, seg._t = o, ax, (t0, t1)
        seg.length = t1 - t0
        seg.end_diameters = [2 * r_at(t0), 2 * r_at(t1)]
        seg.inner_diameter = max(seg.end_diameters)
        seg.half_angle_deg = math.degrees(abs(first.semi_angle))
        seg.ends = [o + t0 * ax, o + t1 * ax]
        seg.end_dirs = [-ax, ax]
    else:
        tor = cast(Torus, first)
        iv = []
        for f in seg.faces:
            c = cast(Torus, f.geom.surface)
            sweep = c.u1 - c.u0
            same = np.dot(c.axis, tor.axis) > 0
            start_u = c.u0 if same else c.u1
            w = c.tube_center(start_u) - tor.center
            th = math.atan2(float(np.dot(w, tor.ydir)), float(np.dot(w, tor.xdir)))
            iv.append((th % (2 * math.pi), sweep))
        # Start = an interval start not covered by another interval (the merged arc is contiguous
        # because its faces are edge-connected).
        two_pi = 2 * math.pi

        def covered(theta: float, skip: int) -> bool:
            for k, (s, sw) in enumerate(iv):
                if k != skip and 1e-7 < (theta - s) % two_pi <= sw + 1e-7:
                    return True
            return False

        starts = [k for k, (s, _) in enumerate(iv) if not covered(s, k)] or [0]
        theta0 = iv[starts[0]][0]

        def rel(theta: float) -> float:
            r = (theta - theta0) % two_pi
            return 0.0 if r > two_pi - 1e-7 else r

        end = max(rel(s) + sw for s, sw in iv)
        # faces split along the tube (same U range) share a start; that is not a gap
        ok = all(
            min(abs(iv[k][0] - theta0), two_pi - abs(iv[k][0] - theta0)) < 1e-7 for k in starts
        )
        sweep = min(end, two_pi)
        seg._torus, seg._theta0, seg._sweep = tor, theta0, sweep
        seg.angle_deg = math.degrees(sweep)
        seg.bend_radius = tor.major
        seg.inner_diameter = 2 * tor.minor
        seg.end_diameters = [seg.inner_diameter, seg.inner_diameter]

        def at(a: float) -> tuple[np.ndarray, np.ndarray]:
            p = tor.center + tor.major * (math.cos(a) * tor.xdir + math.sin(a) * tor.ydir)
            tangent = -math.sin(a) * tor.xdir + math.cos(a) * tor.ydir
            return p, tangent

        p0, d0 = at(theta0)
        p1, d1 = at(theta0 + sweep)
        seg.ends = [p0, p1]
        seg.end_dirs = [-d0, d1]
    if not ok:
        seg.warnings.append("merged faces leave a gap; extent measured end to end")


# --------------------------------------------------------------------------- connectivity
def _segment_end_edges(seg: Segment, part: PartRec) -> list[list[TopoDS_Edge]]:
    """Edges of the segment's faces lying on each end (by edge midpoint)."""
    out: list[list[TopoDS_Edge]] = [[], []]
    tol = TOUCH_TOL / max(seg.scale(), 1e-9)
    for f in seg.faces:
        m = TopTools_IndexedMapOfShape()
        TopExp.MapShapes_s(f.face, TopAbs_EDGE, m)
        for i in range(1, m.Extent() + 1):
            e = TopoDS.Edge_s(m.FindKey(i))
            p = seg.param(_edge_mid(e))
            if abs(p) < tol:
                out[0].append(e)
            elif abs(p - 1) < tol:
                out[1].append(e)
    return out


def build_graph(parts: list[PartRec], file_units: list[str]) -> AnalysisResult:
    nodes: list[Node] = []
    seg_node: dict[int, int] = {}  # id(segment) -> node index
    part_segments: dict[int, list[Segment]] = {}
    graph_warnings: list[str] = []

    for part in parts:
        graph_warnings.extend(part.warnings)
        if part.role == "pipe":
            segs = build_segments(part)
            part_segments[part.solid.index] = segs
            for s in segs:
                kind = {"cylinder": "pipe", "torus": "bend", "cone": "transition"}[s.kind]
                seg_node[id(s)] = len(nodes)
                nodes.append(Node(kind, part.solid.index, s, sorted(f.gid for f in s.faces)))
        else:
            bore = [f.gid for f in part.faces if f.geom.surface is not None and f.geom.inward]
            nodes.append(Node(part.role, part.solid.index, None, bore))

    links: list[Link] = []
    linked: set[tuple[int, int]] = set()

    def link(a: int, b: int, ea: int | None, eb: int | None) -> None:
        key = (min(a, b), max(a, b))
        if a == b or key in linked:
            return
        linked.add(key)
        links.append(Link(a, b, ea, eb))

    # (1) segments of one part sharing an edge
    end_used: set[tuple[int, int]] = set()
    for part in parts:
        if part.role != "pipe":
            continue
        segs = part_segments[part.solid.index]
        face_seg: dict[int, Segment] = {}
        fmap = TopTools_IndexedMapOfShape()
        for s in segs:
            for f in s.faces:
                fmap.Add(f.face)
                face_seg[fmap.FindIndex(f.face)] = s
        em = part.edge_faces
        if em is None:
            continue
        for k in range(1, em.Extent() + 1):
            touching = {
                id(face_seg[j]): face_seg[j]
                for s in _list(em.FindFromIndex(k))
                if (j := fmap.FindIndex(s)) and j in face_seg
            }
            if len(touching) < 2:
                continue
            mid = _edge_mid(TopoDS.Edge_s(em.FindKey(k)))
            ss = list(touching.values())
            for x in range(len(ss)):
                for y in range(x + 1, len(ss)):
                    a, b = ss[x], ss[y]
                    ea = 0 if abs(a.param(mid)) < abs(a.param(mid) - 1) else 1
                    eb = 0 if abs(b.param(mid)) < abs(b.param(mid) - 1) else 1
                    na, nb = seg_node[id(a)], seg_node[id(b)]
                    link(na, nb, ea, eb)
                    # An edge shared mid-segment (tee branch entering the run bore) does not
                    # consume that segment's end.
                    for node_i, seg, e in ((na, a, ea), (nb, b, eb)):
                        if abs(seg.param(mid) - e) < 1e-3:
                            end_used.add((node_i, e))

    # free ends of all segments
    free_ends: list[tuple[int, int]] = [
        (seg_node[id(s)], e)
        for segs in part_segments.values()
        for s in segs
        for e in (0, 1)
        if (seg_node[id(s)], e) not in end_used
    ]

    # (2) free pipe ends coinciding (butt joints between parts), outward directions opposing
    for i in range(len(free_ends)):
        for j in range(i + 1, len(free_ends)):
            (na, ea), (nb, eb) = free_ends[i], free_ends[j]
            if na == nb:
                continue
            sa, sb = nodes[na].segment, nodes[nb].segment
            if sa is None or sb is None:
                continue
            if np.linalg.norm(sa.ends[ea] - sb.ends[eb]) > TOUCH_TOL:
                continue
            if float(np.dot(sa.end_dirs[ea], sb.end_dirs[eb])) > 0:
                continue
            link(na, nb, ea, eb)
            end_used.add((na, ea))
            end_used.add((nb, eb))
            if abs(sa.end_diameters[ea] - sb.end_diameters[eb]) > TOUCH_TOL:
                sa.warnings.append("sudden diameter change at a joint")

    # (3) valves / unclassified touching free pipe ends
    solid_nodes = [i for i, n in enumerate(nodes) if n.segment is None]
    part_by_index = {p.solid.index: p for p in parts}
    boxes = {i: _bbox(part_by_index[nodes[i].part].solid.solid) for i in solid_nodes}
    for na, ea in free_ends:
        if (na, ea) in end_used:
            continue
        seg = nodes[na].segment
        if seg is None:
            continue
        part = part_by_index[seg.part]
        end_edges = _segment_end_edges(seg, part)[ea]
        probe_shapes: list[TopoDS_Shape] = list(end_edges)
        em = part.edge_faces
        if em is None:
            continue
        wet = TopTools_IndexedMapOfShape()
        for f in seg.faces:
            wet.Add(f.face)
        for e in end_edges:
            for s in _list(em.FindFromKey(e)):
                if not wet.Contains(s):
                    probe_shapes.append(s)
        if not probe_shapes:
            continue
        probe = _compound(probe_shapes)
        pbox = _bbox(probe)
        best: tuple[float, int] | None = None
        for sn in solid_nodes:
            if pbox.IsOut(boxes[sn]):
                continue
            d = _distance(probe, part_by_index[nodes[sn].part].solid.solid)
            if d <= TOUCH_TOL and (best is None or d < best[0]):
                best = (d, sn)
        if best is not None:
            link(na, best[1], ea, None)
            end_used.add((na, ea))

    # (4) non-pipe parts touching each other
    for x in range(len(solid_nodes)):
        for y in range(x + 1, len(solid_nodes)):
            a, b = solid_nodes[x], solid_nodes[y]
            if boxes[a].IsOut(boxes[b]):
                continue
            pa = part_by_index[nodes[a].part].solid.solid
            pb = part_by_index[nodes[b].part].solid.solid
            if _distance(pa, pb) <= TOUCH_TOL:
                link(a, b, None, None)

    return _assemble(nodes, links, parts, part_segments, graph_warnings, file_units)


# --------------------------------------------------------------------------- topology + output
def _components_of(n: int, adj: list[set[int]]) -> list[list[int]]:
    seen = [False] * n
    groups = []
    for s in range(n):
        if seen[s]:
            continue
        stack, g = [s], []
        seen[s] = True
        while stack:
            v = stack.pop()
            g.append(v)
            for w in sorted(adj[v]):
                if not seen[w]:
                    seen[w] = True
                    stack.append(w)
        groups.append(sorted(g))
    return groups


def _node_key(nodes: list[Node], i: int) -> tuple[int, int]:
    return (nodes[i].part, min(nodes[i].face_gids) if nodes[i].face_gids else -1)


def _r(x: float, nd: int = 9) -> float:
    return round(float(x), nd)


def _assemble(
    nodes: list[Node],
    links: list[Link],
    parts: list[PartRec],
    part_segments: dict[int, list[Segment]],
    graph_warnings: list[str],
    file_units: list[str],
) -> AnalysisResult:
    n = len(nodes)
    adj: list[set[int]] = [set() for _ in range(n)]
    link_end: dict[tuple[int, int], int | None] = {}  # (node, neighbor) -> node's end used
    for lk in links:
        adj[lk.a].add(lk.b)
        adj[lk.b].add(lk.a)
        link_end[(lk.a, lk.b)] = lk.end_a
        link_end[(lk.b, lk.a)] = lk.end_b

    groups = _components_of(n, adj)
    ordered: list[int] | None = None
    if len(groups) > 1:
        topology = "disconnected"
        graph_warnings.append(f"disconnected topology: {len(groups)} separate groups")
    elif n == 1:
        topology = "line"
        ordered = [0]
    else:
        ends = [i for i in range(n) if len(adj[i]) == 1]
        if all(len(adj[i]) <= 2 for i in range(n)) and len(ends) == 2:
            topology = "line"
            start = min(ends, key=lambda i: _node_key(nodes, i))
            ordered = [start]
            prev = -1
            while len(ordered) < n:
                cur = ordered[-1]
                nxt = [w for w in adj[cur] if w != prev]
                prev = cur
                ordered.append(nxt[0])
        else:
            topology = "network"
            if not ends:
                graph_warnings.append("closed loop: no open ends")

    order = ordered if ordered is not None else sorted(range(n), key=lambda i: _node_key(nodes, i))
    ids = {node: f"comp_{k + 1}" for k, node in enumerate(order)}
    pos = {node: k for k, node in enumerate(order)}

    unclassified = 0
    components = []
    for node_i in order:
        node = nodes[node_i]
        cid = ids[node_i]
        part = next(p for p in parts if p.solid.index == node.part)
        seg = node.segment
        if seg is not None:
            warnings = list(seg.warnings)
            conf = 0.95 if not warnings and not part.warnings else 0.8
            if node.kind == "pipe":
                components.append(
                    Pipe(
                        id=cid,
                        confidence=conf,
                        warnings=warnings,
                        face_ids=node.face_gids,
                        inner_diameter_m=_r(seg.inner_diameter),
                        length_m=_r(seg.length),
                    )
                )
            elif node.kind == "bend":
                components.append(
                    Bend(
                        id=cid,
                        confidence=conf,
                        warnings=warnings,
                        face_ids=node.face_gids,
                        inner_diameter_m=_r(seg.inner_diameter),
                        angle_deg=_r(seg.angle_deg, 6),
                        bend_radius_m=_r(seg.bend_radius),
                        r_over_d=_r(seg.bend_radius / seg.inner_diameter, 6),
                    )
                )
            else:
                d_in, d_out = seg.end_diameters
                kind = "unknown"
                if ordered is not None:
                    # the end facing the previous component on the path is the inlet
                    prev = [w for w in adj[node_i] if pos[w] < pos[node_i]]
                    nxt = [w for w in adj[node_i] if pos[w] > pos[node_i]]
                    e_in = link_end.get((node_i, prev[0])) if prev else None
                    if e_in is None and nxt:
                        e_out = link_end.get((node_i, nxt[0]))
                        e_in = None if e_out is None else 1 - e_out
                    if e_in is not None:
                        d_in, d_out = seg.end_diameters[e_in], seg.end_diameters[1 - e_in]
                        if abs(d_in - d_out) < 1e-9:
                            kind = "unknown"
                        else:
                            kind = "contraction" if d_out < d_in else "expansion"
                components.append(
                    Transition(
                        id=cid,
                        confidence=conf,
                        warnings=warnings,
                        face_ids=node.face_gids,
                        d_in_m=_r(d_in),
                        d_out_m=_r(d_out),
                        length_m=_r(seg.length),
                        half_angle_deg=_r(seg.half_angle_deg, 6),
                        kind=kind,
                    )
                )
        elif node.kind == "valve":
            vm = part.valve_match or {}
            components.append(
                Valve(
                    id=cid,
                    confidence=vm.get("confidence", 0.6),
                    face_ids=node.face_gids,
                    name=part.solid.name,
                    vendor=vm.get("vendor"),
                    valve_type=vm.get("valve_type"),
                    cv=vm.get("cv"),
                    part_path=part.solid.path,
                )
            )
        else:
            unclassified += 1
            components.append(
                Unclassified(
                    id=cid,
                    confidence=0.2,
                    face_ids=node.face_gids,
                    name=part.solid.name,
                    reason=part.reason,
                    part_path=part.solid.path,
                )
            )

    if topology == "line" and n > 0:
        graph_warnings.insert(0, W_FLOW)
    if topology == "network":
        graph_warnings.insert(0, W_NETWORK)
    if unclassified:
        graph_warnings.append(f"{unclassified} part{'s' if unclassified > 1 else ''} unclassified")

    edges = sorted(
        (
            (ids[lk.a], ids[lk.b]) if pos[lk.a] < pos[lk.b] else (ids[lk.b], ids[lk.a])
            for lk in links
        ),
        key=lambda e: (int(e[0][5:]), int(e[1][5:])),
    )
    graph = SystemGraph(
        components=components,
        edges=edges,
        inlet_id=ids[ordered[0]] if ordered else None,
        outlet_id=ids[ordered[-1]] if ordered else None,
        ordered_path=[ids[i] for i in ordered] if ordered else None,
        topology=topology,
        warnings=list(dict.fromkeys(graph_warnings)),
    )

    display = _display_faces(nodes, ids, parts, part_segments)
    return AnalysisResult(graph=graph, display_faces=display, file_length_units=file_units)


def _display_faces(
    nodes: list[Node],
    ids: dict[int, str],
    parts: list[PartRec],
    part_segments: dict[int, list[Segment]],
) -> dict[str, list[TopoDS_Shape]]:
    """Faces for each component's mesh leaf: full wall for pipe-like, whole part otherwise."""
    out: dict[str, list[TopoDS_Shape]] = {}
    seg_to_id: dict[int, str] = {}
    for i, node in enumerate(nodes):
        if node.segment is not None:
            seg_to_id[id(node.segment)] = ids[i]
        else:
            part = next(p for p in parts if p.solid.index == node.part)
            out[ids[i]] = [part.solid.solid]
    for part in parts:
        if part.role != "pipe":
            continue
        segs = part_segments[part.solid.index]
        lines = [(s, s.centerline()) for s in segs]
        wet = {f.gid: s for s in segs for f in s.faces}
        for f in part.faces:
            if f.gid in wet:
                target = wet[f.gid]
            else:
                target = min(lines, key=lambda sl: _polyline_distance(f.geom.centroid, sl[1]))[0]
            out.setdefault(seg_to_id[id(target)], []).append(f.face)
    return out


def _polyline_distance(p: np.ndarray, pts: list[np.ndarray]) -> float:
    best = math.inf
    for a, b in itertools.pairwise(pts):
        ab = b - a
        denom = float(np.dot(ab, ab))
        t = 0.0 if denom == 0 else min(1.0, max(0.0, float(np.dot(p - a, ab)) / denom))
        best = min(best, float(np.linalg.norm(p - (a + t * ab))))
    return best


def analyze(solids: list[PartSolid], file_units: list[str]) -> AnalysisResult:
    parts: list[PartRec] = []
    gid = 0
    for s in solids:
        rec = classify_part(s, gid)
        gid += len(rec.faces)
        parts.append(rec)
    return build_graph(parts, file_units)
