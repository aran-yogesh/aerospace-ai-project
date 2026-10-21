"""Tessellate components into the three-cad-viewer "Shapes" tree (protocol version 3).

Output layout (JSON-serializable, no numpy):

    {"version": 3, "name": "system", "id": "/system", "loc": None, "bb": {...}, "normal_len": 0,
     "parts": [
        {"id": "/system/comp_1", "name": "comp_1", "type": "shapes", "subtype": "solid",
         "state": [1, 1], "color": "#d0d0d0", "alpha": 1.0, "renderback": False, "loc": [...],
         "shape": {"vertices": EncodedBuffer, "normals": ..., "triangles": ..., "edges": ...,
                   "obj_vertices": ..., "face_types": ..., "edge_types": ...,
                   "triangles_per_face": ..., "segments_per_edge": ...}},
        ...]}

EncodedBuffer = {"shape": [n], "dtype": "float32" | "int32", "buffer": <base64>, "codec": "b64"}.
three-cad-viewer's Viewer.render() decodes these inline buffers itself (decodeInlineBuffers);
the flat arrays plus triangles_per_face / segments_per_edge are its "binary" Shape format.
Coordinates are meters.
"""

from __future__ import annotations

import base64

import numpy as np
from OCP.BRep import BRep_Builder
from OCP.TopoDS import TopoDS_Compound, TopoDS_Shape

# Relative tessellation tolerances (ocp-tessellate scales deviation by each part's bounding box).
DEVIATION = 0.3
ANGULAR_TOLERANCE = 0.3  # radians
DISPLAY_COLOR = "#d0d0d0"


def _encode(arr) -> dict:
    a = np.ascontiguousarray(arr).ravel()
    if a.dtype.kind == "f":
        a = a.astype(np.float32, copy=False)
        dtype = "float32"
    else:
        a = a.astype(np.int32, copy=False)
        dtype = "int32"
    return {
        "shape": [int(a.shape[0])],
        "dtype": dtype,
        "buffer": base64.b64encode(a.tobytes()).decode("ascii"),
        "codec": "b64",
    }


def _compound(shapes: list[TopoDS_Shape]) -> TopoDS_Compound:
    comp = TopoDS_Compound()
    b = BRep_Builder()
    b.MakeCompound(comp)
    for s in shapes:
        b.Add(comp, s)
    return comp


def _plain(o):
    if isinstance(o, dict):
        return {k: _plain(v) for k, v in o.items()}
    if isinstance(o, list | tuple):
        return [_plain(v) for v in o]
    if isinstance(o, np.generic):
        return o.item()
    return o


def tessellate(components: dict[str, list[TopoDS_Shape]], order: list[str]) -> dict:
    """components: component id -> faces/solids (global placement). Returns a Shapes dict."""
    from ocp_tessellate.convert import tessellate_group, to_ocpgroup

    ids = [cid for cid in order if components.get(cid)]
    compounds = [_compound(components[cid]) for cid in ids]
    group, instances = to_ocpgroup(*compounds, names=ids)
    meshed, shapes, _mapping = tessellate_group(
        group,
        instances,
        {
            "deviation": DEVIATION,
            "angular_tolerance": ANGULAR_TOLERANCE,
            "render_edges": True,
            "render_normals": False,
        },
    )

    parts = []
    for part in _leaves(shapes):
        cid = part["name"]
        ref = part["shape"]["ref"]
        mesh = meshed[ref]
        parts.append(
            {
                "version": 3,
                "id": f"/system/{cid}",
                "name": cid,
                "type": "shapes",
                # "solid" makes three-cad-viewer resolve picks to this leaf (the component)
                "subtype": "solid",
                "state": [1, 1],
                "color": DISPLAY_COLOR,
                "alpha": 1.0,
                "renderback": False,
                "texture": None,
                "accuracy": part.get("accuracy"),
                "bb": None,
                "loc": _plain(part.get("loc")) or [[0.0, 0.0, 0.0], [0.0, 0.0, 0.0, 1.0]],
                "shape": {
                    k: _encode(mesh[k])
                    for k in (
                        "vertices",
                        "normals",
                        "triangles",
                        "edges",
                        "obj_vertices",
                        "face_types",
                        "edge_types",
                        "triangles_per_face",
                        "segments_per_edge",
                    )
                },
            }
        )
    order_index = {cid: i for i, cid in enumerate(ids)}
    parts.sort(key=lambda p: order_index.get(p["name"], len(order_index)))
    return {
        "version": 3,
        "name": "system",
        "id": "/system",
        "loc": None,
        "normal_len": 0,
        "bb": _plain(shapes.get("bb")),
        "parts": parts,
    }


def _leaves(node: dict) -> list[dict]:
    out = []
    for p in node.get("parts", []):
        if "parts" in p:
            out.extend(_leaves(p))
        elif p.get("type") == "shapes":
            out.append(p)
    return out
