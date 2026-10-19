"""Analytic surface descriptors for B-rep faces (all coordinates in meters).

Each wetted-candidate face is reduced to one of three descriptors:
- Cyl:   axis line, radius, and the axial interval it covers (from the V parameter range).
- Torus: center, axis, frame, major radius R, minor radius r, and the U interval (major sweep).
         Surfaces of revolution whose basis curve is a circle are converted to a Torus.
- Cone:  axis line, semi-angle, and the axial interval it covers (slant V range x cos(angle)).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepGProp import BRepGProp
from OCP.BRepTools import BRepTools
from OCP.GeomAbs import (
    GeomAbs_Circle,
    GeomAbs_Cone,
    GeomAbs_Cylinder,
    GeomAbs_Plane,
    GeomAbs_SurfaceOfRevolution,
    GeomAbs_Torus,
)
from OCP.GProp import GProp_GProps
from OCP.TopAbs import TopAbs_REVERSED
from OCP.TopoDS import TopoDS_Face

LEN_TOL = 1e-5  # 10 um: same-surface test for merging split faces
DIR_TOL = 1e-4  # radians-ish: parallel axes


def vec(p) -> np.ndarray:
    return np.array([p.X(), p.Y(), p.Z()], dtype=float)


def unit(v: np.ndarray) -> np.ndarray:
    n = float(np.linalg.norm(v))
    return v / n if n > 0 else v


def parallel(a: np.ndarray, b: np.ndarray) -> bool:
    return float(np.linalg.norm(np.cross(a, b))) < DIR_TOL


def point_line_distance(p: np.ndarray, origin: np.ndarray, d: np.ndarray) -> float:
    w = p - origin
    return float(np.linalg.norm(w - np.dot(w, d) * d))


@dataclass
class Cyl:
    origin: np.ndarray
    axis: np.ndarray
    radius: float
    t0: float  # axial interval in the face's own frame: origin + t * axis
    t1: float

    def same_surface(self, o: Cyl) -> bool:
        return (
            abs(self.radius - o.radius) < LEN_TOL
            and parallel(self.axis, o.axis)
            and point_line_distance(o.origin, self.origin, self.axis) < LEN_TOL
        )


@dataclass
class Cone:
    origin: np.ndarray
    axis: np.ndarray
    ref_radius: float
    semi_angle: float  # signed, OCCT convention
    v0: float
    v1: float
    apex: np.ndarray

    def t_of_v(self, v: float) -> float:
        return v * math.cos(self.semi_angle)

    def radius_of_v(self, v: float) -> float:
        return self.ref_radius + v * math.sin(self.semi_angle)

    def same_surface(self, o: Cone) -> bool:
        return (
            float(np.linalg.norm(self.apex - o.apex)) < LEN_TOL
            and parallel(self.axis, o.axis)
            and abs(abs(self.semi_angle) - abs(o.semi_angle)) < DIR_TOL
        )


@dataclass
class Torus:
    center: np.ndarray
    axis: np.ndarray
    xdir: np.ndarray
    ydir: np.ndarray
    major: float
    minor: float
    u0: float
    u1: float

    def tube_center(self, u: float) -> np.ndarray:
        return self.center + self.major * (math.cos(u) * self.xdir + math.sin(u) * self.ydir)

    def same_surface(self, o: Torus) -> bool:
        return (
            abs(self.major - o.major) < LEN_TOL
            and abs(self.minor - o.minor) < LEN_TOL
            and float(np.linalg.norm(self.center - o.center)) < LEN_TOL
            and parallel(self.axis, o.axis)
        )


Surface = Cyl | Cone | Torus


@dataclass
class FaceGeom:
    kind: str  # cylinder | cone | torus | plane | other
    area: float
    surface: Surface | None
    inward: bool  # normal points toward the axis / tube centerline (= inner wall of a tube)
    centroid: np.ndarray


def _uv_bounds(face: TopoDS_Face) -> tuple[float, float, float, float]:
    return BRepTools.UVBounds_s(face)


def _normal(adaptor: BRepAdaptor_Surface, face: TopoDS_Face, u: float, v: float):
    from OCP.gp import gp_Pnt, gp_Vec

    p, du, dv = gp_Pnt(), gp_Vec(), gp_Vec()
    adaptor.D1(u, v, p, du, dv)
    n = np.cross(vec(du), vec(dv))
    if face.Orientation() == TopAbs_REVERSED:
        n = -n
    return vec(p), unit(n)


def _torus_from_revolution(adaptor: BRepAdaptor_Surface, u0: float, u1: float) -> Torus | None:
    basis = adaptor.BasisCurve()
    if basis.GetType() != GeomAbs_Circle:
        return None
    circ = basis.Circle()
    ax1 = adaptor.AxeOfRevolution()
    a = unit(vec(ax1.Direction()))
    o = vec(ax1.Location())
    cc = vec(circ.Location())
    cn = unit(vec(circ.Axis().Direction()))
    # The circle's plane must contain the revolution axis for this to be a torus.
    if abs(float(np.dot(cn, a))) > DIR_TOL or abs(float(np.dot(o - cc, cn))) > LEN_TOL:
        return None
    foot = o + np.dot(cc - o, a) * a
    radial = cc - foot
    big_r = float(np.linalg.norm(radial))
    if big_r <= circ.Radius():
        return None
    x = radial / big_r
    y = np.cross(a, x)
    return Torus(foot, a, x, y, big_r, circ.Radius(), u0, u1)


def analyze_face(face: TopoDS_Face) -> FaceGeom:
    props = GProp_GProps()
    BRepGProp.SurfaceProperties_s(face, props)
    area = props.Mass()
    centroid = vec(props.CentreOfMass())

    adaptor = BRepAdaptor_Surface(face, True)
    st = adaptor.GetType()
    u0, u1, v0, v1 = _uv_bounds(face)
    um, vm = 0.5 * (u0 + u1), 0.5 * (v0 + v1)

    if st == GeomAbs_Plane:
        return FaceGeom("plane", area, None, False, centroid)

    surface: Surface | None = None
    kind = "other"
    if st == GeomAbs_Cylinder:
        c = adaptor.Cylinder()
        pos = c.Position()
        origin, axis = vec(pos.Location()), unit(vec(pos.Direction()))
        surface = Cyl(origin, axis, c.Radius(), v0, v1)
        kind = "cylinder"
    elif st == GeomAbs_Cone:
        c = adaptor.Cone()
        pos = c.Position()
        surface = Cone(
            vec(pos.Location()),
            unit(vec(pos.Direction())),
            c.RefRadius(),
            c.SemiAngle(),
            v0,
            v1,
            vec(c.Apex()),
        )
        kind = "cone"
    elif st == GeomAbs_Torus:
        t = adaptor.Torus()
        pos = t.Position()
        surface = Torus(
            vec(pos.Location()),
            unit(vec(pos.Direction())),
            unit(vec(pos.XDirection())),
            unit(vec(pos.YDirection())),
            t.MajorRadius(),
            t.MinorRadius(),
            u0,
            u1,
        )
        kind = "torus"
    elif st == GeomAbs_SurfaceOfRevolution:
        surface = _torus_from_revolution(adaptor, u0, u1)
        kind = "torus" if surface is not None else "other"

    if surface is None:
        return FaceGeom(kind, area, None, False, centroid)

    p, n = _normal(adaptor, face, um, vm)
    if isinstance(surface, Torus):
        w = p - surface.center
        w = w - np.dot(w, surface.axis) * surface.axis
        toward = surface.center + surface.major * unit(w) - p
    else:
        w = p - surface.origin
        toward = surface.origin + np.dot(w, surface.axis) * surface.axis - p
    inward = float(np.dot(n, toward)) > 0
    return FaceGeom(kind, area, surface, inward, centroid)
