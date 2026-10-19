"""CAD parser: STEP -> SystemGraph (component graph) + tessellated mesh for the viewer.

Public interface (used by the API layer):

    from app.cad_parser import parse_file, ParseOutput
    out = parse_file(Path("line.step"))          # never raises
    out.result   # SystemGraph | ParseError
    out.mesh     # three-cad-viewer Shapes dict (root "/system", leaves "/system/comp_N") or None
    out.seconds  # parse + tessellate time

Parsing runs in a spawned child process with a wall-clock timeout and an RLIMIT_AS memory cap.
See docs/decisions/0004-cad-parser.md.
"""

from __future__ import annotations

import multiprocessing as mp
import signal
import time
from dataclasses import dataclass
from pathlib import Path

from app.schema.geometry import ParseError, SystemGraph

__all__ = ["ParseOutput", "parse_file"]


@dataclass
class ParseOutput:
    result: SystemGraph | ParseError
    mesh: dict | None  # three-cad-viewer "Shapes" dict, None on error
    seconds: float  # parse + tessellate (child-measured on success, wall time on failure)


def _fail(code: str, detail: str | None, t0: float) -> ParseOutput:
    return ParseOutput(ParseError(error=code, detail=detail), None, time.perf_counter() - t0)


def parse_file(path: Path, *, timeout_s: float = 60, memory_mb: int = 2048) -> ParseOutput:
    """Parse a STEP file in a separate process. NEVER raises.

    Errors: unreadable_step, no_solids, timeout, out_of_memory, parser_crashed.
    """
    t0 = time.perf_counter()
    proc = None
    try:
        from .worker import child_main

        ctx = mp.get_context("spawn")
        recv, send = ctx.Pipe(duplex=False)
        proc = ctx.Process(
            target=child_main, args=(str(path), memory_mb, send), daemon=True, name="cad-parser"
        )
        proc.start()
        send.close()
        try:
            if not recv.poll(max(0.0, timeout_s - (time.perf_counter() - t0))):
                return _fail("timeout", f"parsing took longer than {timeout_s:g} s", t0)
            msg = recv.recv()
        except (EOFError, OSError):
            proc.join(5)
            code = proc.exitcode
            if code == -signal.SIGKILL:
                return _fail(
                    "out_of_memory", "parser process was killed (likely out of memory)", t0
                )
            return _fail("parser_crashed", f"parser process exited with code {code}", t0)
        finally:
            recv.close()

        if msg[0] == "ok":
            _, graph, mesh, seconds = msg
            return ParseOutput(SystemGraph.model_validate(graph), mesh, float(seconds))
        _, code, detail = msg
        return _fail(code, detail, t0)
    except Exception as e:  # never raise to the caller
        return _fail("parser_crashed", f"{type(e).__name__}: {e}", t0)
    finally:
        if proc is not None:
            if proc.is_alive():
                proc.kill()
            proc.join(5)
