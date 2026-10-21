# cad_parser

STEP -> `SystemGraph` + three-cad-viewer mesh. Entry point: `parse_file(path)` in `__init__.py`
(spawned subprocess, timeout + memory cap, never raises).

- `reader.py`: XCAF reading (names, assembly paths, locations), converts units to meters
- `surfaces.py`: analytic face descriptors (cylinder / torus / cone) and the wetted-face test
- `analyze.py`: part classification, merging split faces, connectivity, topology, schema output
- `tessellate.py`: ocp-tessellate output as a Shapes tree with `/system/comp_N` leaves
- `worker.py`: child-process entry

Design and limits: docs/decisions/0004-cad-parser.md.
