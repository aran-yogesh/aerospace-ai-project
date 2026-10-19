# 0004. CAD parser

- Status: accepted
- Date: 2026-10-18

## Context

Phase 1 turns an uploaded STEP file into a component graph (`app.schema.geometry.SystemGraph`)
and a mesh for the viewer. Later phases compute pressure drop from that graph, so lengths,
diameters, bend angles and the flow order must be right. Wrong geometry would give confidently
wrong physics. The parser runs on untrusted files, so it must never take the API down with it.

## Decision

### Reading: OCP XCAF, not `cq.importers.importStep`

`STEPCAFControl_Reader` reads into an XCAF document (`XCAFDoc_ShapeTool`), which keeps the
assembly tree, product names and instance locations. `importStep` flattens the file and drops
names, and we need names to recognise valves. We walk the free shapes recursively and compose the
instance locations. Each solid becomes a *part* with:

- `name`: the product name (e.g. `Swagelok_BallValve_Cv12`). Instance names such as `Part1-1`, or
  the bare numbers some exporters write, are ignored when a product name exists.
- `part_path`: the product names from the root down, e.g.
  `/07_feed_line/valve_station/Swagelok_BallValve_Cv6`. Repeated siblings get `[2]`, `[3]`, ...
  A part with several solids gets `#1`, `#2`, ...

### Units: converted to meters by the reader

Before the transfer, the document length unit is set to meters
(`XCAFDoc_DocumentTool.SetLengthUnit(doc, 1.0, UnitsMethods_LengthUnit_Meter)`). The reader then
scales whatever the file declares (`SI_UNIT(.MILLI.,.METRE.)`, `CONVERSION_BASED_UNIT('INCH')`,
...) into meters. All later geometry is in meters, and mm is never assumed. The declared unit is
read with `ChangeReader().FileUnits()` for diagnostics. A test exports the same feed line in mm,
m and inch, and checks that the three files parse to the same numbers in meters.

### Classifying parts

1. **Valve** if the name matches `Vendor_Type_Cv<number>` (case-insensitive; `_`, `-` or a space
   as separator). This gives `vendor`, `valve_type` and `cv`, with confidence 0.9. A name that
   only contains `valve` or `orifice` is also a valve (confidence 0.6, no vendor/Cv).
2. **Pipe-like** if cylinder/torus/cone faces cover at least 50 % of the part's surface area *and*
   at least one of them faces inward (see below).
3. Otherwise **unclassified**, with a reason that names the measured share, e.g. `name 'Part1'
   matches no valve pattern and the geometry is not pipe-like: cylinder/torus/cone faces cover 20%
   of the surface area (pipe-like needs 50%)`.

Faces of valve and unclassified parts are never pipe faces. A valve's own bore, which is a
cylinder, is part of the valve and adds nothing to pipe length. The check is per part, so a
valve body never becomes a pipe segment. The valve's `face_ids` list its inward-facing bore faces,
and its mesh leaf is the whole part.

### Wetted faces only

For a pipe-like part we keep only faces whose oriented normal points *toward* the axis (cylinder,
cone) or toward the tube centerline (torus). On a hollow solid that is the inner wall. The outer
wall points away, and planar end annuli are never wetted. This test uses the face orientation, so
it needs no inner/outer pairing and also works on parts without a matching outer face.

### Measuring and merging split faces

Within one part, wetted faces that lie on the *same analytic surface* (same axis line and radius
for a cylinder; same center, axis, R and r for a torus; same apex, axis and half-angle for a cone)
and share an edge are merged into one **segment**. CAD exporters often split a periodic face
into halves, or split a run where features meet. Each segment is one component:

| surface  | component  | measurement |
|----------|------------|-------------|
| cylinder | pipe       | ID = 2r. Length = union of the faces' axial extents (from the V range, which runs along the axis) |
| torus    | bend       | angle = union of the **U** ranges (the major sweep, not V), bend radius = major R, ID = 2 x minor r, R/D = R / ID |
| cone     | transition | axial length = slant (V) range x cos(half-angle). Diameters are the radii at the two ends |

`SURFACE_OF_REVOLUTION` faces with a circular profile whose plane contains the axis are converted
to tori, because some exporters write bends that way. BSpline faces are not recognised. They count
against the pipe-like area share, and a pipe-like part that has any gets a warning.

### Graph

Nodes are segments (pipe, bend, transition) plus one node per valve or unclassified part.
Edges:

1. Segments of one part that share a B-rep edge (`TopExp.MapShapesAndAncestors`, edge to face).
   The shared edge's position tells which end of each segment is joined. An edge shared in the
   middle of a segment, such as a tee branch entering the run bore, joins the two segments but
   leaves both run ends free.
2. Free segment ends in different parts whose end centers coincide within 0.1 mm and whose
   outward directions oppose (butt joints between separate parts). A diameter mismatch at such a
   joint adds a warning.
3. A valve or unclassified part touching a free pipe end, measured from the end's boundary edges
   plus the adjacent end faces to the part solid (`BRepExtrema_DistShapeShape` ≤ 0.1 mm, after a
   bounding-box check).
4. Valve or unclassified parts touching each other (solid-to-solid ≤ 0.1 mm).

Topology:

- **line**: connected, no node with more than two neighbors, and exactly two ends (or one single
  component). The inlet is the end whose part comes first in the assembly tree.
  `ordered_path` runs from inlet to outlet. Ids `comp_1..N` follow that order.
- **network**: more than two ends, a node with three or more neighbors, or a closed loop.
  `ordered_path`, `inlet_id` and `outlet_id` are `None`, and the warning `network topology:
  single-path solve not available` is added. Ids follow assembly order.
- **disconnected**: more than one connected group, with a warning that gives the count.

A transition's `kind` comes from the path order: `d_out < d_in` is a contraction. Without a
path it is `unknown`. Graph-level warnings use fixed strings so the UI can match on them:
`flow direction assumed` (every line), `network topology: single-path solve not available`,
`N part(s) unclassified`, `disconnected topology: N separate groups`, `closed loop: no open ends`.

`face_ids` are global face indices: faces are counted per solid (`TopExp.MapShapes` order),
solids in assembly order.

Confidence: 0.95 for a cleanly measured segment, and 0.8 if the segment or its part has a warning.
Valves get 0.9 from the name pattern and 0.6 from a keyword. Unclassified parts get 0.2.

### Mesh

`ocp-tessellate` (`to_ocpgroup` + `tessellate_group`) tessellates one compound per component,
with relative deviation 0.3 and angular tolerance 0.3 rad. The result is re-emitted as a
three-cad-viewer Shapes tree (protocol 3). The root is `/system`, there is one leaf per component
`/system/comp_N` with `name` = component id and `subtype: "solid"`, and every geometry array is an
inline base64 buffer (`{shape, dtype, buffer, codec: "b64"}`). three-cad-viewer's `render()`
decodes these itself. A pipe-like component's leaf shows its full wall: wetted faces, plus every
other face of the part assigned to the segment whose centerline is nearest the face centroid
(outer wall, end annuli). Valve and unclassified leaves show the whole part. No B-rep leaves the
server.

### Isolation

`parse_file()` runs read + analyze + tessellate in a **spawned** child process (never fork: OCCT
is not fork-safe in a threaded server). The child sets `RLIMIT_AS` (default 2048 MB) and the parent
waits on a pipe with a wall-clock timeout (default 60 s) and kills the child when it expires.
`parse_file` never raises. It returns `ParseError` codes:

| code | when |
|------|------|
| `unreadable_step` | missing file, STEP syntax error, transfer failure |
| `no_solids` | the file has only surfaces/wires |
| `timeout` | the child did not answer in time (it is killed) |
| `out_of_memory` | `MemoryError` / shared libraries cannot be mapped under the cap / child SIGKILLed |
| `parser_crashed` | any other exception or abnormal child exit |

Measured in the container on 07_feed_line: parse + tessellate about 0.12 s in the child, about
0.75 s wall including the process spawn and the OCP import.

## Known limits

- **STEP only.** No IGES, STL or native CAD formats.
- **Single-line solve.** Tees and other branches give `network` with no ordered path. Phase 2
  solves lines only.
- **Assumed flow direction.** Inlet means "first in the assembly tree", which is a guess. Every
  line carries `flow direction assumed`, and the UI must let the user flip it later.
- Only analytic cylinder/torus/cone surfaces (plus circular surfaces of revolution) are measured.
  BSpline-approximated bends are not recognised yet.
- Tolerances are absolute (10 µm same-surface, 0.1 mm contact). They suit models from a few mm up
  to tens of meters.
- Tee bores are split into a run pipe and a branch pipe. The branch length is measured from the
  run axis. There is no `tee` component type yet.
- Valves are recognised only by name. A valve body named `Part1` stays unclassified and is never
  guessed from its shape.
