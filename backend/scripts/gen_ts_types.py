"""Generate TypeScript types from the Pydantic schemas.

Usage: python -m scripts.gen_ts_types [OUT_PATH] [--check]
Writes OUT_PATH (geometry.ts, from app/schema/geometry.py) and api.ts next to it
(REST/WebSocket models from app/schema/api.py and app/schema/solve.py, importing shared
types from ./geometry).
With --check, exit 1 if either file is out of date (used by tests/CI).
"""

import sys
from pathlib import Path
from typing import Any

from pydantic import TypeAdapter
from pydantic.json_schema import models_json_schema

from app.schema.api import API_MODELS
from app.schema.geometry import ParseError, SystemGraph
from app.schema.solve import SOLVE_API_MODELS

DEFAULT_OUT = Path(__file__).resolve().parents[2] / "desktop/src/renderer/src/types/geometry.ts"
HEADER = (
    "// GENERATED FILE: do not edit. Source: backend/app/schema/geometry.py\n"
    "// Regenerate with `make types`."
)
API_HEADER = (
    "// GENERATED FILE: do not edit. Source: backend/app/schema/api.py, solve.py\n"
    "// Regenerate with `make types`."
)
API_FILENAME = "api.ts"


def _ref_name(ref: str) -> str:
    return ref.rsplit("/", 1)[-1]


def _ts(schema: dict[str, Any]) -> str:
    if "$ref" in schema:
        return _ref_name(schema["$ref"])
    if "const" in schema:
        return _literal(schema["const"])
    if "enum" in schema:
        return " | ".join(_literal(v) for v in schema["enum"])
    for key in ("anyOf", "oneOf"):
        if key in schema:
            return " | ".join(_ts(s) for s in schema[key])
    kind = schema.get("type")
    if kind == "string":
        return "string"
    if kind in ("number", "integer"):
        return "number"
    if kind == "boolean":
        return "boolean"
    if kind == "null":
        return "null"
    if kind == "object":
        values = [*schema.get("patternProperties", {}).values()]
        if isinstance(extra := schema.get("additionalProperties"), dict):
            values.append(extra)
        if values:
            return f"Record<string, {' | '.join(_ts(v) for v in values)}>"
    if kind == "array":
        if "prefixItems" in schema:
            return "[" + ", ".join(_ts(s) for s in schema["prefixItems"]) + "]"
        inner = _ts(schema.get("items", {}))
        return f"({inner})[]" if "|" in inner else f"{inner}[]"
    return "unknown"


def _literal(value: Any) -> str:
    # Single quotes to match the desktop Prettier config, so formatting never causes drift.
    return f"'{value}'" if isinstance(value, str) else str(value).lower()


def _interface(name: str, schema: dict[str, Any]) -> str:
    required = set(schema.get("required", []))
    lines = []
    if doc := schema.get("description"):
        lines.append(f"/** {' '.join(doc.split())} */")
    lines.append(f"export interface {name} {{")
    for prop, sub in schema.get("properties", {}).items():
        if desc := sub.get("description"):
            lines.append(f"  /** {desc} */")
        lines.append(f"  {prop}{'' if prop in required else '?'}: {_ts(sub)}")
    lines.append("}")
    return "\n".join(lines)


def _geometry_defs() -> dict[str, Any]:
    full = TypeAdapter(SystemGraph | ParseError).json_schema(
        mode="serialization", ref_template="#/$defs/{model}"
    )
    return full.get("$defs", {})


def render() -> str:
    defs = _geometry_defs()
    blocks = [HEADER]
    for name in sorted(defs):
        blocks.append(_interface(name, defs[name]))
    blocks.append("export type Component = Pipe | Bend | Transition | Valve | Unclassified")
    blocks.append("export type ComponentType = Component['type']")
    return "\n\n".join(blocks) + "\n"


def render_api() -> str:
    models = [(m, "serialization") for m in (*API_MODELS, *SOLVE_API_MODELS)]
    _, top = models_json_schema(models, ref_template="#/$defs/{model}")
    defs = top.get("$defs", {})
    shared = sorted(name for name in defs if name in _geometry_defs())
    blocks = [API_HEADER]
    if shared:
        blocks.append(f"import type {{ {', '.join(shared)} }} from './geometry'")
    for name in sorted(defs):
        if name not in shared:
            blocks.append(_interface(name, defs[name]))
    blocks.append("export type FileStatus = FileInfo['status']")
    blocks.append("export type KMatch = KRow['match']")
    blocks.append("export type SolveMode = SolveIn['mode']")
    return "\n\n".join(blocks) + "\n"


def outputs(out: Path) -> dict[Path, str]:
    return {out: render(), out.with_name(API_FILENAME): render_api()}


def main(argv: list[str]) -> int:
    args = [a for a in argv if not a.startswith("--")]
    out = Path(args[0]) if args else DEFAULT_OUT
    files = outputs(out)
    if "--check" in argv:
        stale = [p for p, text in files.items() if not p.exists() or p.read_text() != text]
        for p in stale:
            print(f"{p} is out of date; run `make types`.", file=sys.stderr)
        return 1 if stale else 0
    out.parent.mkdir(parents=True, exist_ok=True)
    for path, text in files.items():
        path.write_text(text)
        print(f"wrote {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
