"""Generate TypeScript types from the Pydantic geometry schema.

Usage: python -m scripts.gen_ts_types [OUT_PATH] [--check]
With --check, exit 1 if OUT_PATH is out of date (used by tests/CI).
"""

import sys
from pathlib import Path
from typing import Any

from pydantic import TypeAdapter

from app.schema.geometry import ParseError, SystemGraph

DEFAULT_OUT = Path(__file__).resolve().parents[2] / "desktop/src/renderer/src/types/geometry.ts"
HEADER = (
    "// GENERATED FILE: do not edit. Source: backend/app/schema/geometry.py\n"
    "// Regenerate with `make types`."
)


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
    if kind == "array":
        if "prefixItems" in schema:
            return "[" + ", ".join(_ts(s) for s in schema["prefixItems"]) + "]"
        inner = _ts(schema.get("items", {}))
        return f"({inner})[]" if "|" in inner else f"{inner}[]"
    return "unknown"


def _literal(value: Any) -> str:
    return f'"{value}"' if isinstance(value, str) else str(value).lower()


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


def render() -> str:
    full = TypeAdapter(SystemGraph | ParseError).json_schema(
        mode="serialization", ref_template="#/$defs/{model}"
    )
    defs = full.get("$defs", {})
    blocks = [HEADER]
    for name in sorted(defs):
        blocks.append(_interface(name, defs[name]))
    blocks.append("export type Component = Pipe | Bend | Transition | Valve | Unclassified")
    blocks.append('export type ComponentType = Component["type"]')
    return "\n\n".join(blocks) + "\n"


def main(argv: list[str]) -> int:
    args = [a for a in argv if not a.startswith("--")]
    out = Path(args[0]) if args else DEFAULT_OUT
    text = render()
    if "--check" in argv:
        if not out.exists() or out.read_text() != text:
            print(f"{out} is out of date; run `make types`.", file=sys.stderr)
            return 1
        return 0
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text)
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
