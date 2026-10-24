"""app.solver stays pure: it never imports the DB, API, constants loader or LLM code."""

import ast
import subprocess
import sys
from pathlib import Path

import app.solver

SOLVER_DIR = Path(app.solver.__file__).parent
ALLOWED = {"__future__", "bisect", "dataclasses", "math", "typing", "scipy", "app"}
ALLOWED_APP = ("app.schema", "app.solver")
FORBIDDEN = ("app.db", "app.api", "app.constants", "app.llm", "app.harness", "app.core")


def imported_modules(path: Path) -> list[str]:
    names = []
    for node in ast.walk(ast.parse(path.read_text())):
        if isinstance(node, ast.Import):
            names += [a.name for a in node.names]
        elif isinstance(node, ast.ImportFrom):
            names.append(node.module or "")
    return names


def test_solver_imports_only_allowed_modules():
    for path in SOLVER_DIR.glob("*.py"):
        for mod in imported_modules(path):
            assert mod.split(".")[0] in ALLOWED, f"{path.name} imports {mod}"
            if mod.startswith("app"):
                assert mod.startswith(ALLOWED_APP), f"{path.name} imports {mod}"


def test_importing_solver_loads_no_forbidden_package():
    code = (
        "import sys, app.solver; "
        f"bad = [m for m in sys.modules if m.startswith({FORBIDDEN!r})]; "
        "print(bad); sys.exit(1 if bad else 0)"
    )
    out = subprocess.run(  # noqa: S603
        [sys.executable, "-c", code], capture_output=True, text=True, check=False
    )
    assert out.returncode == 0, out.stdout + out.stderr
