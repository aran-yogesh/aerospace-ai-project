# cad_parser

The CAD parser goes here. It reads STEP files with CadQuery (OCP), extracts the flow path and
components into `app.schema` models, and tessellates with `ocp-tessellate` for the desktop
3D viewer.

CadQuery is installed through the `cad` extra (always present in the Docker image). Import it
lazily inside functions so the rest of the app runs without it.
