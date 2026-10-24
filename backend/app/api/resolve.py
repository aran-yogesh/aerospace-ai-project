"""K resolution, segment building and content hashing for datasets (spec B4, C).

Lookup order per component: user override wins; then bends and transitions are computed
from geometry, a valve with Cv is computed from Cv and the upstream pipe ID, a valve
without Cv is looked up in the K table by valve_type, and anything else is missing.
"""

import hashlib
import json
import math
import re
from typing import Any

from app import solver
from app.constants import Constants
from app.schema.geometry import Bend, Component, Pipe, SystemGraph, Transition, Valve
from app.schema.solve import KCounts, KRow, SegmentInput, SetupIn


def canonical_json(data: Any) -> str:
    """Sorted keys, no whitespace; json.dumps writes floats with repr (shortest round trip)."""
    return json.dumps(data, sort_keys=True, separators=(",", ":"), allow_nan=False)


def sha256(data: Any) -> str:
    return hashlib.sha256(canonical_json(data).encode()).hexdigest()


def _snake(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", name).lower()).strip(
        "_"
    )


def _inlet_d(c: Component) -> float | None:
    if isinstance(c, Pipe | Bend):
        return c.inner_diameter_m
    return c.d_in_m if isinstance(c, Transition) else None


def _outlet_d(c: Component) -> float | None:
    if isinstance(c, Pipe | Bend):
        return c.inner_diameter_m
    return c.d_out_m if isinstance(c, Transition) else None


def _upstream_d(path: list[Component], i: int) -> float | None:
    """Flow diameter at a valve or unknown part: nearest upstream outlet, else downstream inlet."""
    for c in reversed(path[:i]):
        if (d := _outlet_d(c)) is not None:
            return d
    for c in path[i + 1 :]:
        if (d := _inlet_d(c)) is not None:
            return d
    return None


def _label(c: Component) -> str:
    return c.name if isinstance(c, Valve) or c.type == "unclassified" else c.type.capitalize()


def _table_lookup(valve_type: str | None, constants: Constants) -> tuple[str, Any] | None:
    """Exact key match on the normalized valve_type, else the first entry of a family whose
    words all appear in it (e.g. "BallValve" -> valve_ball)."""
    if not valve_type:
        return None
    key = _snake(valve_type)
    entries = constants.k_values.entries
    if key in entries:
        return "exact", (key, entries[key])
    words = set(key.split("_"))
    for k, e in entries.items():
        if set(e.family.split("_")) <= words:
            return "family", (k, e)
    return None


def _row(c: Component, **kw: Any) -> KRow:
    base: dict[str, Any] = {
        "component_id": c.id,
        "type": c.type,
        "label": _label(c),
        "k": None,
        "k_ref_d_m": None,
        "method": None,
        "source": None,
        "match": "missing",
        "verified": None,
        "note": None,
    }
    return KRow(**(base | kw))


def _computed(c: Component, fn: Any, ref_d: float, *args: Any) -> KRow:
    try:
        r = fn(*args)
    except ValueError as exc:
        return _row(c, k_ref_d_m=ref_d, note=f"cannot compute K: {exc}")
    return _row(c, k=r.value, k_ref_d_m=ref_d, method=r.method, source=r.source, match="computed")


def resolve_component(
    path: list[Component], i: int, setup: SetupIn, roughness_m: float, constants: Constants
) -> KRow:
    c = path[i]
    if isinstance(c, Pipe):
        return _row(
            c,
            method="Darcy-Weisbach, Churchill (1977) f",
            source="computed from geometry",
            match="computed",
        )

    ref_d = (
        c.inner_diameter_m
        if isinstance(c, Bend)
        else min(c.d_in_m, c.d_out_m)
        if isinstance(c, Transition)
        else _upstream_d(path, i)
    )
    override = setup.k_overrides.get(c.id)
    if override == "no_loss":
        return _row(c, k=0.0, k_ref_d_m=ref_d, source="user: no loss", match="user")
    if override is not None:
        return _row(
            c, k=override.value, k_ref_d_m=ref_d, source="user", match="user", note=override.note
        )

    if isinstance(c, Bend):
        return _computed(c, solver.bend_k, ref_d, c.angle_deg, c.r_over_d, ref_d, roughness_m)
    if isinstance(c, Transition):
        kind = c.kind
        if kind == "unknown":  # infer from the diameters
            kind = "contraction" if c.d_out_m < c.d_in_m else "expansion"
        return _computed(c, solver.transition_k, ref_d, c.d_in_m, c.d_out_m, c.half_angle_deg, kind)
    if isinstance(c, Valve):
        if c.cv is not None:
            if ref_d is None:
                return _row(c, note="Cv given but no upstream pipe diameter to reference K to.")
            return _computed(c, solver.valve_k_from_cv, ref_d, c.cv, ref_d)
        hit = _table_lookup(c.valve_type, constants)
        if hit is None:
            note = f"no K table entry for valve_type {c.valve_type!r}"
            return _row(c, k_ref_d_m=ref_d, note=note)
        match, (key, e) = hit
        verified = e.status == "verified"
        return _row(
            c,
            k=e.value,
            k_ref_d_m=ref_d,
            method=f"K table entry {key}",
            source=f"{e.source} (k_values {constants.k_values.version})",
            match=match if verified else "family",
            verified=verified,
            note=None if verified else "unverified table value, treated as approximate",
        )
    return _row(c, k_ref_d_m=ref_d, note="unclassified part: enter a K or mark it no loss")


def path_components(graph: SystemGraph) -> list[Component]:
    by_id = {c.id: c for c in graph.components}
    return [by_id[cid] for cid in graph.ordered_path or []]


def resolve(
    graph: SystemGraph, setup: SetupIn, roughness_m: float, constants: Constants
) -> list[KRow]:
    path = path_components(graph)
    return [resolve_component(path, i, setup, roughness_m, constants) for i in range(len(path))]


def counts(rows: list[KRow]) -> KCounts:
    n = {m: 0 for m in ("computed", "exact", "family", "user", "missing")}
    for r in rows:
        n[r.match] += 1
    return KCounts(**n)


def segments(graph: SystemGraph, rows: list[KRow]) -> list[SegmentInput]:
    """Contract segment semantics: pipe = ID x length (friction only); bend = ID x arc length
    with K; transition = smaller D x axial length with K; valve/unclassified = upstream ID, 0 m."""
    out = []
    for c, r in zip(path_components(graph), rows, strict=True):
        if isinstance(c, Pipe):
            out.append(
                SegmentInput(
                    component_id=c.id, type="pipe", d_m=c.inner_diameter_m, length_m=c.length_m
                )
            )
            continue
        length = (
            math.radians(c.angle_deg) * c.bend_radius_m
            if isinstance(c, Bend)
            else c.length_m
            if isinstance(c, Transition)
            else 0.0
        )
        out.append(
            SegmentInput(
                component_id=c.id,
                type=c.type,
                d_m=r.k_ref_d_m,
                length_m=length,
                k=r.k,
                k_ref_d_m=r.k_ref_d_m,
                k_source=r.source,
                k_match=r.match,
            )
        )
    return out
