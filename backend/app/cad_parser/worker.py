"""Child-process side of parse_file. Kept import-light: OCP is imported after the memory cap."""

from __future__ import annotations

import resource
import time
import traceback
from multiprocessing.connection import Connection
from pathlib import Path


def run_pipeline(path: Path) -> tuple[dict, dict, float]:
    """Parse + tessellate in the current process. Raises ParserFailure on known failures."""
    from .analyze import analyze
    from .reader import read_step
    from .tessellate import tessellate

    t0 = time.perf_counter()
    model = read_step(path)
    result = analyze(model.solids, model.file_length_units)
    mesh = tessellate(result.display_faces, [c.id for c in result.graph.components])
    seconds = time.perf_counter() - t0
    return result.graph.model_dump(mode="json"), mesh, seconds


def child_main(path: str, memory_mb: int, conn: Connection) -> None:
    try:
        limit = int(memory_mb) * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (limit, limit))
    except (ValueError, OSError):  # pragma: no cover - platform without RLIMIT_AS
        pass
    try:
        from .reader import ParserFailure

        try:
            graph, mesh, seconds = run_pipeline(Path(path))
            conn.send(("ok", graph, mesh, seconds))
        except ParserFailure as e:
            conn.send(("error", e.code, e.detail))
    except MemoryError:
        conn.send(("error", "out_of_memory", "parser exceeded its memory limit"))
    except ImportError as e:
        # Under a tight RLIMIT_AS the OCCT shared libraries cannot even be mapped.
        if "map segment" in str(e) or "allocate memory" in str(e):
            conn.send(("error", "out_of_memory", "parser exceeded its memory limit at startup"))
        else:
            conn.send(("error", "parser_crashed", f"ImportError: {e}"[:500]))
    except Exception as e:
        tb = traceback.format_exc(limit=3).strip().splitlines()[-1]
        conn.send(("error", "parser_crashed", f"{type(e).__name__}: {e} ({tb})"[:500]))
    finally:
        conn.close()
